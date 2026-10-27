#!/usr/bin/env bash
# Restore drill: fetch the newest complete backup, verify and decrypt it,
# restore roles + database into a THROWAWAY Postgres, and check that the data
# matches what was dumped. Storage bytes are verified against the manifest
# and cross-checked with the restored storage.objects table.
#
# Runbook: docs/runbooks/offsite-backup.md. Required environment:
#   DRILL_ENV             staging | production (destination prefix)
#   DRILL_TARGET_URL      superuser URI of a disposable cluster, e.g.
#                         postgres://drill@127.0.0.1:5432/postgres
#   DRILL_AGE_IDENTITY    age secret key text, or DRILL_AGE_IDENTITY_FILE
#   OFFSITE_* source      see lib.sh (read-only credentials are enough)
# Optional:
#   DRILL_EXPECTED_REF    project ref the backup must come from
#   DRILL_BACKUP_KEY      a specific .../meta.json instead of the newest
#   DRILL_MAX_AGE_DAYS    fail when the newest backup is older (default 8, 0=off)
#   DRILL_EXPECT_USERS    1 (default) requires auth.users to be non-empty
#   DRILL_JOBS            pg_restore parallelism (default 4)
#   DRILL_SKIP_EXTENSIONS comma list of extensions to treat as unavailable
set -euo pipefail
umask 077
# shellcheck source=scripts/backup/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_vars DRILL_ENV DRILL_TARGET_URL
dest_init
for tool in psql pg_restore age tar python3; do
  command -v "$tool" >/dev/null || die "$tool not found"
done
case "$DRILL_TARGET_URL" in
  *supabase.co*) die "DRILL_TARGET_URL must be a disposable local cluster, never a Supabase project" ;;
esac

WORK="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/restore-drill.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
IDENTITY="$WORK/identity.txt"
if [ -n "${DRILL_AGE_IDENTITY:-}" ]; then
  printf '%s\n' "$DRILL_AGE_IDENTITY" > "$IDENTITY"
elif [ -n "${DRILL_AGE_IDENTITY_FILE:-}" ]; then
  cp "$DRILL_AGE_IDENTITY_FILE" "$IDENTITY"
else
  die "missing configuration: DRILL_AGE_IDENTITY (see docs/runbooks/offsite-backup.md)"
fi
BUNDLE="$WORK/bundle"
mkdir -p "$BUNDLE"
started=$(date +%s)

# 1. Pick the newest backup that has meta.json (= upload completed).
PREFIX="${DRILL_PREFIX:-$DRILL_ENV}"
META_KEY="${DRILL_BACKUP_KEY:-}"
if [ -z "$META_KEY" ]; then
  META_KEY="$(dest_list_keys "$PREFIX/" | grep '/meta\.json$' | python3 "$BUNDLE_TOOLS" pick-latest)"
fi
dest_get_stream "$META_KEY" > "$WORK/meta.json"
read -r BUNDLE_KEY WANT_SHA WANT_BYTES META_ENV META_REF CREATED < <(python3 - "$WORK/meta.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
print(m["bundle_key"], m["bundle_sha256"], m["bundle_bytes"], m["env"], m["project_ref"], m["created_at"])
PY
)
log "drill $DRILL_ENV: backup $CREATED ($META_KEY)"
[ "$META_ENV" = "$DRILL_ENV" ] || die "backup env $META_ENV does not match DRILL_ENV"
if [ -n "${DRILL_EXPECTED_REF:-}" ] && [ "$META_REF" != "$DRILL_EXPECTED_REF" ]; then
  die "backup comes from a different project than the expected $DRILL_ENV ref"
fi
age_days=$(python3 -c "import datetime,sys; t=datetime.datetime.strptime(sys.argv[1],'%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc); print(int((datetime.datetime.now(datetime.timezone.utc)-t).total_seconds()//86400))" "$CREATED")
max_age="${DRILL_MAX_AGE_DAYS:-8}"
if [ "$max_age" -gt 0 ] && [ "$age_days" -gt "$max_age" ]; then
  die "newest backup is $age_days days old (limit $max_age): the weekly backup is not running"
fi

# 2. Download, hash, decrypt and unpack in one stream. age authenticates every
# chunk, and the sha256 must match the value recorded at upload time.
log "download + decrypt"
dest_get_stream "$BUNDLE_KEY" \
  | python3 "$BUNDLE_TOOLS" hashpipe --out "$WORK/got.sha.json" \
  | age --decrypt --identity "$IDENTITY" \
  | tar -C "$BUNDLE" -xf -
rm -f "$IDENTITY"
python3 - "$WORK/got.sha.json" "$WANT_SHA" "$WANT_BYTES" <<'PY' || die "bundle checksum does not match meta.json"
import json, sys
got = json.load(open(sys.argv[1]))
sys.exit(0 if got["sha256"] == sys.argv[2] and got["bytes"] == int(sys.argv[3]) else 1)
PY
python3 - "$BUNDLE/manifest.json" "$DRILL_ENV" "$META_REF" <<'PY' || die "manifest does not match meta.json"
import json, sys
m = json.load(open(sys.argv[1]))
sys.exit(0 if m["env"] == sys.argv[2] and m["project_ref"] == sys.argv[3] else 1)
PY
fetched=$(date +%s)

# 3. Storage bytes against the manifest.
log "verify storage objects"
python3 "$BUNDLE_TOOLS" verify-storage --dir "$BUNDLE/storage" > "$WORK/storage-verify.json"

# 4. Roles, then a fresh database restored strictly (--exit-on-error).
DB="${DRILL_DB:-restore_drill}"
TARGET_DB_URL="$(python3 - "$DRILL_TARGET_URL" "$DB" <<'PY'
import sys, urllib.parse
u = urllib.parse.urlsplit(sys.argv[1])
print(urllib.parse.urlunsplit(u._replace(path="/" + sys.argv[2])))
PY
)"
q() { psql -X -q -v ON_ERROR_STOP=1 -At -d "$1" -c "$2"; }
CURRENT_USER="$(q "$DRILL_TARGET_URL" 'SELECT current_user')"
[ "$(q "$DRILL_TARGET_URL" 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user')" = t ] \
  || die "DRILL_TARGET_URL must connect as a superuser of a disposable cluster"
q "$DRILL_TARGET_URL" "SELECT rolname FROM pg_roles" > "$WORK/existing-roles.txt"

log "restore roles"
python3 "$BUNDLE_TOOLS" roles-filter --existing-roles "$WORK/existing-roles.txt" \
  --current-user "$CURRENT_USER" < "$BUNDLE/db/roles.sql" > "$WORK/roles.sql"
psql -X -q -v ON_ERROR_STOP=1 -d "$DRILL_TARGET_URL" -f "$WORK/roles.sql" > /dev/null 2> "$WORK/roles.err" \
  || die "roles restore failed ($(grep -c 'ERROR' "$WORK/roles.err") errors; details kept off the public log)"

q "$DRILL_TARGET_URL" "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)"
q "$DRILL_TARGET_URL" "CREATE DATABASE \"$DB\" TEMPLATE template0"
q "$TARGET_DB_URL" "SELECT name FROM pg_available_extensions" > "$WORK/available-ext.txt"
# The CREATE EXTENSION statements tell toc-filter which schema each extension
# owns, so grants on members of a missing extension can be skipped too.
grep -E '^[0-9]+; [0-9]+ [0-9]+ EXTENSION ' "$BUNDLE/db/toc.txt" > "$WORK/ext.list" || true
pg_restore --file="$WORK/ext.sql" --use-list="$WORK/ext.list" "$BUNDLE/db/full.dump"
toc_filter() {
  python3 "$BUNDLE_TOOLS" toc-filter --available-extensions "$WORK/available-ext.txt" \
    --extension-sql "$WORK/ext.sql" --skip-extensions "${DRILL_SKIP_EXTENSIONS:-}" "$@" < "$BUNDLE/db/toc.txt"
}
toc_filter > "$WORK/toc.pre"

JOBS="${DRILL_JOBS:-4}"
run_restore() {
  local section=$1 list=$2
  log "pg_restore --section=$section"
  # stderr can quote row values (e.g. constraint violations): keep it local.
  if ! pg_restore --exit-on-error --no-password --section="$section" --use-list="$list" \
      ${3:+--jobs="$JOBS"} --dbname="$TARGET_DB_URL" "$BUNDLE/db/full.dump" 2> "$WORK/restore-$section.err"; then
    grep -E '^pg_restore: from TOC entry' "$WORK/restore-$section.err" \
      | sed -E 's/^pg_restore: from TOC entry [0-9]+; [0-9]+ [0-9]+ /failed entry: /' | head -5 >&2 || true
    die "pg_restore $section failed"
  fi
}
run_restore pre-data "$WORK/toc.pre"
q "$TARGET_DB_URL" "SELECT n.nspname || ' ' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p')" \
  > "$WORK/tables.txt"
toc_filter --existing-tables "$WORK/tables.txt" --report "$WORK/toc-report.json" > "$WORK/toc.rest"
run_restore data "$WORK/toc.rest" parallel
run_restore post-data "$WORK/toc.rest" parallel
restored=$(date +%s)

# 5. Data checks.
log "verify restored data"
expect=()
[ "${DRILL_EXPECT_USERS:-1}" = 1 ] && expect=(--expect-users)
checks_ok=1
python3 "$BUNDLE_TOOLS" db-checks --target "$TARGET_DB_URL" --bundle "$BUNDLE" \
  --toc-report "$WORK/toc-report.json" "${expect[@]}" > "$WORK/db-checks.json" || checks_ok=0
finished=$(date +%s)

python3 - "$WORK/db-checks.json" "$WORK/storage-verify.json" "$WORK/toc-report.json" <<'PY' > "$WORK/summary.md"
import json, sys
db = json.load(open(sys.argv[1])) if open(sys.argv[1]).read().strip() else {"failures": ["db-checks crashed"]}
st = json.load(open(sys.argv[2]))
toc = json.load(open(sys.argv[3]))
rows = [
    ("Tables with exact row counts", f"{db.get('tables_checked', 0)} checked, {db.get('tables_mismatched', '?')} mismatched"),
    ("Migration ledger", f"{db.get('migrations_applied', '?')} applied, newest `{db.get('latest_migration', '?')}`"),
    ("auth.users present", str(db.get("auth_users_present", "not checked"))),
    ("Storage bytes", f"{st['objects']} objects, all sha256 verified"),
    ("storage.objects vs bytes", f"{db.get('db_rows_without_bytes', '?')} rows without bytes, {db.get('bytes_without_db_row', '?')} bytes without row (tolerance {db.get('drift_tolerance', '?')})"),
    ("Not restorable in plain Postgres", ", ".join(toc["skipped_extensions"] + toc["skipped_data"]) or "none"),
    ("Grants/comments on their member objects skipped", str(len(toc["skipped_member_attributes"]))),
    ("Failures", "; ".join(db.get("failures", [])) or "none"),
]
print("| Check | Result |\n|---|---|")
for k, v in rows:
    print(f"| {k} | {v} |")
PY
summary "### Restore drill: $DRILL_ENV backup $CREATED (${age_days}d old)"
summary ""
summary "$(cat "$WORK/summary.md")"
summary "| Time: fetch+decrypt / restore / checks | $((fetched - started))s / $((restored - fetched))s / $((finished - restored))s |"
cat "$WORK/summary.md" >&2
[ "${DRILL_KEEP_DB:-0}" = 1 ] || q "$DRILL_TARGET_URL" "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)"
[ "$checks_ok" = 1 ] || die "restore drill checks failed"
log "restore drill passed"
