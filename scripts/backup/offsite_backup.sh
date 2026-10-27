#!/usr/bin/env bash
# Weekly off-Supabase backup: pg_dump (schema+data) + roles + every Storage
# object, packed into one tar, encrypted with age to public recipients only,
# and streamed to an S3-compatible bucket outside the Supabase account.
#
# Runbook: docs/runbooks/offsite-backup.md. Required environment:
#   BACKUP_ENV                    staging | production (destination prefix)
#   BACKUP_DATABASE_URL           session-pooler URI (port 5432), secret
#   BACKUP_SUPABASE_URL           https://<ref>.supabase.co
#   BACKUP_SUPABASE_SERVICE_KEY   service_role / sb_secret key, secret
#   BACKUP_AGE_RECIPIENTS         age public keys, one per line
#   OFFSITE_* destination         see lib.sh
# Optional:
#   BACKUP_EXPECTED_REF           refuse to run unless both URLs name this project
#   BACKUP_TIER                   weekly | monthly | manual | auto (default auto)
#   BACKUP_PREFIX                 destination prefix (default $BACKUP_ENV)
set -euo pipefail
umask 077
# shellcheck source=scripts/backup/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_vars BACKUP_ENV BACKUP_DATABASE_URL BACKUP_SUPABASE_URL BACKUP_SUPABASE_SERVICE_KEY BACKUP_AGE_RECIPIENTS
case "$BACKUP_ENV" in staging|production|selftest) ;; *) die "BACKUP_ENV must be staging or production" ;; esac
dest_init
for tool in pg_dump pg_dumpall pg_restore age tar python3; do
  command -v "$tool" >/dev/null || die "$tool not found"
done

# A staging job must never read production (its drill key lives in GitHub).
if [ -n "${BACKUP_EXPECTED_REF:-}" ]; then
  [ "${BACKUP_SUPABASE_URL%/}" = "https://$BACKUP_EXPECTED_REF.supabase.co" ] \
    || die "BACKUP_SUPABASE_URL does not point at the expected $BACKUP_ENV project"
  case "$BACKUP_DATABASE_URL" in
    *"$BACKUP_EXPECTED_REF"*) ;;
    *) die "BACKUP_DATABASE_URL does not name the expected $BACKUP_ENV project ref" ;;
  esac
fi

TIER="${BACKUP_TIER:-auto}"
if [ "$TIER" = auto ]; then
  # The first weekly run of a month is kept longer (see retention in the runbook).
  if [ "$(date -u +%d)" -le 7 ]; then TIER=monthly; else TIER=weekly; fi
fi
case "$TIER" in weekly|monthly|manual) ;; *) die "BACKUP_TIER must be weekly, monthly, manual or auto" ;; esac

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${GITHUB_RUN_ID:-local}"
PREFIX="${BACKUP_PREFIX:-$BACKUP_ENV}"
KEY_DIR="$PREFIX/$TIER/$STAMP-$RUN_ID"
export STAMP TIER KEY_DIR

WORK="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/offsite-backup.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
BUNDLE="$WORK/bundle"
mkdir -p "$BUNDLE/db" "$BUNDLE/storage"

RECIPIENTS="$WORK/recipients.txt"
printf '%s\n' "$BACKUP_AGE_RECIPIENTS" | sed 's/[[:space:]]*$//' | grep -v '^$' > "$RECIPIENTS" || true
[ -s "$RECIPIENTS" ] || die "BACKUP_AGE_RECIPIENTS has no keys"
if grep -v -E '^(age1[0-9a-z]+|ssh-(ed25519|rsa) .+)$' "$RECIPIENTS" >/dev/null; then
  die "BACKUP_AGE_RECIPIENTS must contain only age1... or ssh- public keys (never an AGE-SECRET-KEY)"
fi

started=$(date +%s)
log "backup $BACKUP_ENV tier=$TIER -> $KEY_DIR"

# 1. Database. Custom format keeps owners/ACLs and allows selective restore.
log "pg_dump (schema + data)"
pg_dump --dbname="$BACKUP_DATABASE_URL" --no-password --format=custom \
  --lock-wait-timeout=120s --file="$BUNDLE/db/full.dump"
log "pg_dumpall --roles-only"
pg_dumpall --dbname="$BACKUP_DATABASE_URL" --no-password --roles-only --no-role-passwords \
  --file="$BUNDLE/db/roles.sql"
pg_restore --list "$BUNDLE/db/full.dump" > "$BUNDLE/db/toc.txt"
pg_restore --data-only --file=- "$BUNDLE/db/full.dump" \
  | python3 "$BUNDLE_TOOLS" rowcounts --out "$BUNDLE/db/rowcounts.tsv"
db_done=$(date +%s)

# 2. Storage bytes, listed after the dump (the drill tolerates the small drift).
log "storage export"
SUPABASE_SERVICE_KEY="$BACKUP_SUPABASE_SERVICE_KEY" python3 "$BACKUP_LIB_DIR/storage_tool.py" \
  --workers "${BACKUP_STORAGE_WORKERS:-8}" export \
  --supabase-url "$BACKUP_SUPABASE_URL" --out "$BUNDLE/storage" > "$WORK/storage.json"
storage_done=$(date +%s)

# 3. Manifest inside the encrypted bundle.
python3 - "$BUNDLE" "$WORK/storage.json" <<'PY'
import hashlib, json, os, subprocess, sys
from pathlib import Path
bundle, storage = Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text())
def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
toc = (bundle / "db" / "toc.txt").read_text()
header = {k.strip(): v.strip() for k, v in
          (l[1:].split(":", 1) for l in toc.splitlines()[:20] if l.startswith(";") and ":" in l)}
rows = [l.rsplit("\t", 1) for l in (bundle / "db" / "rowcounts.tsv").read_text().splitlines()]
manifest = {
    "format": 1,
    "env": os.environ["BACKUP_ENV"],
    "project_ref": os.environ["BACKUP_SUPABASE_URL"].split("//")[1].split(".")[0],
    "created_at": os.environ["STAMP"],
    "git_sha": os.environ.get("GITHUB_SHA", ""),
    "run_id": os.environ.get("GITHUB_RUN_ID", "local"),
    "db": {
        "dump": "db/full.dump",
        "dump_sha256": sha(bundle / "db" / "full.dump"),
        "dump_bytes": (bundle / "db" / "full.dump").stat().st_size,
        "roles": "db/roles.sql",
        "server_version": header.get("Dumped from database version", ""),
        "pg_dump_version": header.get("Dumped by pg_dump version", ""),
        "tables_with_data": len(rows),
        "rows": sum(int(n) for _, n in rows),
    },
    "storage": storage,
}
(bundle / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
PY

# 4. tar | age | upload as one stream, so the runner holds the bytes once.
raw_bytes=$(du -sb "$BUNDLE" | cut -f1)
log "encrypt + upload ($raw_bytes raw bytes)"
tar -C "$BUNDLE" -cf - . \
  | age --encrypt --recipients-file "$RECIPIENTS" \
  | python3 "$BUNDLE_TOOLS" hashpipe --out "$WORK/bundle.sha.json" \
  | dest_put_stream "$KEY_DIR/bundle.tar.age" "$((raw_bytes + raw_bytes / 100 + 1048576))"

# 5. meta.json last: its presence marks the backup complete. It holds no data.
python3 - "$WORK/bundle.sha.json" "$BUNDLE/manifest.json" "$RECIPIENTS" > "$WORK/meta.json" <<'PY'
import hashlib, json, os, sys
sha, man = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
recips = [l.strip() for l in open(sys.argv[3]) if l.strip()]
print(json.dumps({
    "format": 1,
    "env": man["env"],
    "project_ref": man["project_ref"],
    "created_at": man["created_at"],
    "tier": os.environ["TIER"],
    "bundle_key": os.environ["KEY_DIR"] + "/bundle.tar.age",
    "bundle_sha256": sha["sha256"],
    "bundle_bytes": sha["bytes"],
    "git_sha": man["git_sha"],
    "run_id": man["run_id"],
    "recipient_fingerprints": [hashlib.sha256(r.encode()).hexdigest()[:16] for r in recips],
}, indent=1))
PY
dest_put_file "$WORK/meta.json" "$KEY_DIR/meta.json"
finished=$(date +%s)

read -r bundle_bytes objects storage_bytes vanished tables < <(python3 - "$WORK/meta.json" "$BUNDLE/manifest.json" <<'PY'
import json, sys
meta, man = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
s = man["storage"]
print(meta["bundle_bytes"], s["objects"], s["bytes"], s["vanished"], man["db"]["tables_with_data"])
PY
)
log "done: $KEY_DIR ($bundle_bytes encrypted bytes)"
summary "### Offsite backup: $BACKUP_ENV ($TIER)"
summary ""
summary "| Item | Value |"
summary "|---|---|"
summary "| Destination key | \`$KEY_DIR/\` |"
summary "| Encrypted bundle | $bundle_bytes bytes |"
summary "| DB tables with data | $tables |"
summary "| Storage objects | $objects ($storage_bytes bytes; $vanished deleted during export) |"
summary "| Time: DB / Storage / encrypt+upload | $((db_done - started))s / $((storage_done - db_done))s / $((finished - storage_done))s |"
