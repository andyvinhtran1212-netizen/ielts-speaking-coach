#!/usr/bin/env bash
# End-to-end self-test of offsite_backup.sh + restore_drill.sh against local
# services only: a Supabase-shaped Postgres source, a mock Storage API, an
# S3-compatible store (moto) or a directory, and a disposable drill cluster.
#
#   SELFTEST_SRC_ADMIN_URL  superuser URI of an EMPTY source cluster (user supabase_admin)
#   SELFTEST_SRC_HOSTPORT   host:port of the same cluster (for the postgres-role URI)
#   SELFTEST_DST_URL        superuser URI of an EMPTY drill cluster
#   SELFTEST_S3_ENDPOINT    optional; S3 endpoint with any credentials (moto)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BK="$(cd "$HERE/.." && pwd)"
: "${SELFTEST_SRC_ADMIN_URL:?}" "${SELFTEST_SRC_HOSTPORT:?}" "${SELFTEST_DST_URL:?}"

T="$(mktemp -d "${RUNNER_TEMP:-/tmp}/offsite-selftest.XXXXXX")"
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT
pass() { printf 'PASS %s\n' "$*"; }
fail() { printf '::error::selftest FAILED: %s\n' "$*"; exit 1; }
# expect_fail "label" "message regex" cmd...
expect_fail() {
  local label=$1 want=$2; shift 2
  if "$@" > "$T/neg.out" 2>&1; then fail "$label: command succeeded"; fi
  grep -Eq "$want" "$T/neg.out" || { cat "$T/neg.out"; fail "$label: wrong failure"; }
  pass "$label"
}

# --- source database + storage ------------------------------------------------
psql -X -q -d "$SELFTEST_SRC_ADMIN_URL" -f "$HERE/seed_source.sql" > /dev/null
MOCK_KEY="sb_secret_selftest_$(date +%s)"
SRC_ROOT="$T/storage-src"
mkdir -p "$SRC_ROOT/audio-responses/0b5c-user/s1" "$SRC_ROOT/vocab-audio/thư mục" "$SRC_ROOT/empty-bucket"
cat > "$SRC_ROOT/_buckets.json" <<'JSON'
[{"id":"audio-responses","name":"audio-responses","public":false,"file_size_limit":null,"allowed_mime_types":null},
 {"id":"vocab-audio","name":"vocab-audio","public":true,"file_size_limit":5242880,"allowed_mime_types":["audio/mpeg"]},
 {"id":"empty-bucket","name":"empty-bucket","public":false}]
JSON
head -c 300000 /dev/urandom > "$SRC_ROOT/audio-responses/0b5c-user/s1/1.webm"
head -c 1000 /dev/urandom > "$SRC_ROOT/audio-responses/0b5c-user/s1/2.webm"
: > "$SRC_ROOT/audio-responses/0b5c-user/.emptyFolderPlaceholder"
for i in 1 2 3 4 5; do head -c $((i * 777)) /dev/urandom > "$SRC_ROOT/vocab-audio/word-$i.mp3"; done
head -c 4096 /dev/urandom > "$SRC_ROOT/vocab-audio/thư mục/tệp 1.mp3"
python3 - "$SRC_ROOT" > "$T/objects.sql" <<'PY'
import os, sys
root = sys.argv[1]
print("INSERT INTO storage.buckets (id, name) VALUES ('audio-responses','audio-responses'),('vocab-audio','vocab-audio'),('empty-bucket','empty-bucket');")
for bucket in ("audio-responses", "vocab-audio"):
    for dp, _, files in os.walk(os.path.join(root, bucket)):
        for f in files:
            name = os.path.relpath(os.path.join(dp, f), os.path.join(root, bucket))
            print("INSERT INTO storage.objects (bucket_id, name) VALUES ('%s', '%s');" % (bucket, name.replace("'", "''")))
# Deleted from Storage after the DB dump: a row without bytes (tolerated drift).
print("INSERT INTO storage.objects (bucket_id, name) VALUES ('vocab-audio', 'gone.mp3');")
PY
psql -X -q -v ON_ERROR_STOP=1 -d "$SELFTEST_SRC_ADMIN_URL" -f "$T/objects.sql" > /dev/null

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }
SRC_PORT=$(free_port)
# --page-cap 2 forces paging; the ghost is listed once and then 404s.
python3 "$HERE/mock_storage.py" --root "$SRC_ROOT" --port "$SRC_PORT" --key "$MOCK_KEY" \
  --page-cap 2 --ghost vocab-audio/gone.mp3 & PIDS+=($!)
DST_ROOT="$T/storage-dst"; mkdir -p "$DST_ROOT"
DST_PORT=$(free_port)
python3 "$HERE/mock_storage.py" --root "$DST_ROOT" --port "$DST_PORT" --key "$MOCK_KEY" & PIDS+=($!)
for port in "$SRC_PORT" "$DST_PORT"; do
  for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$port/" && break; sleep 0.1; done
done

# --- keys and destination -----------------------------------------------------
age-keygen -o "$T/drill.key" 2> /dev/null
age-keygen -o "$T/offline.key" 2> /dev/null
RECIPIENTS="$(age-keygen -y "$T/drill.key")
$(age-keygen -y "$T/offline.key")"

export BACKUP_ENV=selftest DRILL_ENV=selftest
export BACKUP_DATABASE_URL="postgres://postgres:selftest@$SELFTEST_SRC_HOSTPORT/postgres"
export BACKUP_SUPABASE_URL="http://127.0.0.1:$SRC_PORT"
export BACKUP_SUPABASE_SERVICE_KEY="$MOCK_KEY"
export BACKUP_AGE_RECIPIENTS="$RECIPIENTS"
export DRILL_TARGET_URL="$SELFTEST_DST_URL"
if [ -n "${SELFTEST_S3_ENDPOINT:-}" ]; then
  export OFFSITE_DEST_KIND=s3 OFFSITE_S3_ENDPOINT="$SELFTEST_S3_ENDPOINT" OFFSITE_S3_BUCKET="offsite-selftest"
  export OFFSITE_S3_ACCESS_KEY_ID=selftest OFFSITE_S3_SECRET_ACCESS_KEY=selftest OFFSITE_S3_REGION=us-east-1
  AWS_ACCESS_KEY_ID=selftest AWS_SECRET_ACCESS_KEY=selftest AWS_DEFAULT_REGION=us-east-1 \
    aws --endpoint-url "$SELFTEST_S3_ENDPOINT" s3 mb "s3://$OFFSITE_S3_BUCKET" > /dev/null
else
  export OFFSITE_DEST_KIND=file OFFSITE_FILE_ROOT="$T/dest"
fi

# --- 1. backup + drill happy path ---------------------------------------------
BACKUP_TIER=weekly bash "$BK/offsite_backup.sh"
pass "backup to $OFFSITE_DEST_KIND"
DRILL_AGE_IDENTITY="$(cat "$T/drill.key")" DRILL_KEEP_DB=1 bash "$BK/restore_drill.sh" 2> "$T/drill.log" \
  || { cat "$T/drill.log"; fail "drill on a good backup"; }
grep -q 'restore drill passed' "$T/drill.log" || fail "drill did not report success"
grep -q '| storage.objects vs bytes | 1 rows without bytes, 0 bytes without row' "$T/drill.log" \
  || { cat "$T/drill.log"; fail "expected exactly the deleted object as drift"; }
cat "$T/drill.log"
pass "restore drill (drill key)"

# The offline key decrypts the same bundle (second recipient).
DRILL_AGE_IDENTITY_FILE="$T/offline.key" DRILL_KEEP_DB=1 bash "$BK/restore_drill.sh" 2> /dev/null || fail "drill with offline key"
pass "restore drill (offline key)"

# Schema fidelity beyond row counts: RLS, grants, triggers, platform objects.
RESTORED="${SELFTEST_DST_URL%/*}/restore_drill"
FIDELITY="$(psql -X -At -d "$RESTORED" -c "SELECT
  (SELECT count(*) FROM pg_policies WHERE policyname = 'own_sessions')
  || (SELECT relrowsecurity::int::text FROM pg_class WHERE oid = 'public.sessions'::regclass)
  || (SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime')
  || (SELECT count(*) FROM pg_event_trigger WHERE evtname = 'selftest_ddl_watch')
  || (SELECT count(*) FROM pg_trigger WHERE tgname = 'sessions_touch')
  || has_table_privilege('read_only', 'public.session_bands', 'SELECT')::int
  || (SELECT (sum(n) = 200)::int FROM public.band_counts)
  || (SELECT (rolsuper OR rolbypassrls)::int FROM pg_roles WHERE rolname = 'postgres')
  || (SELECT (tableowner = 'supabase_auth_admin')::int FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users')")"
[ "$FIDELITY" = 111111111 ] || fail "restored schema fidelity flags: $FIDELITY (want 111111111)"
pass "restored schema keeps RLS, grants, triggers, publication, matview, owners"

# The drill catches a restored table that lost rows.
mkdir -p "$T/b/db"
psql -X -q -d "$RESTORED" -c "DELETE FROM public.responses WHERE id = (SELECT min(id) FROM public.responses)"
psql -X -q -At -d "$RESTORED" -c "SELECT 'public.responses', count(*) + 1 FROM public.responses" -F $'\t' > "$T/b/db/rowcounts.tsv"
expect_fail "db-checks detects a row-count mismatch" 'row-count mismatch in 1 tables: public.responses' \
  python3 "$BK/bundle_tools.py" db-checks --target "$RESTORED" --bundle "$T/b"

# --- 2. storage restore into an empty project -----------------------------------
mkdir -p "$T/x"
META="$(OFFSITE_DEST_KIND=$OFFSITE_DEST_KIND bash -c "source '$BK/lib.sh'; dest_init; dest_list_keys selftest/ | grep meta.json | python3 '$BK/bundle_tools.py' pick-latest")"
BKEY="${META%meta.json}bundle.tar.age"
bash -c "source '$BK/lib.sh'; dest_init; dest_get_stream '$BKEY'" | age -d -i "$T/offline.key" | tar -C "$T/x" -xf -
expect_fail "storage restore requires --confirm-target-ref" 'confirm-target-ref' \
  env SUPABASE_SERVICE_KEY="$MOCK_KEY" python3 "$BK/storage_tool.py" restore \
  --supabase-url "http://127.0.0.1:$DST_PORT" --from "$T/x/storage"
SUPABASE_SERVICE_KEY="$MOCK_KEY" python3 "$BK/storage_tool.py" restore \
  --supabase-url "http://127.0.0.1:$DST_PORT" --from "$T/x/storage" --allow-unconfirmed-target > /dev/null
( cd "$SRC_ROOT" && find . -type f ! -name _buckets.json -exec sha256sum {} + | sort ) > "$T/src.sha"
( cd "$DST_ROOT" && find . -type f ! -name _buckets.json -exec sha256sum {} + | sort ) > "$T/dst.sha"
diff -q "$T/src.sha" "$T/dst.sha" > /dev/null || fail "restored storage differs from source"
python3 -c "import json,sys; b={x['id']:x for x in json.load(open(sys.argv[1]))}; assert b['vocab-audio']['public'] is True and b['vocab-audio']['allowed_mime_types']==['audio/mpeg'] and b['audio-responses']['public'] is False and 'empty-bucket' in b" "$DST_ROOT/_buckets.json" \
  || fail "bucket config not restored"
pass "storage restore (bytes + bucket config)"

# --- 3. negative cases -----------------------------------------------------------
expect_fail "backup refuses a project that is not the expected ref" 'does not point at the expected' \
  env BACKUP_EXPECTED_REF=zjphffoujxkpltixsbzj bash "$BK/offsite_backup.sh"
expect_fail "backup refuses a secret key as recipient" 'never an AGE-SECRET-KEY' \
  env BACKUP_AGE_RECIPIENTS="$(grep AGE-SECRET "$T/drill.key")" bash "$BK/offsite_backup.sh"
expect_fail "backup lists every missing variable" 'missing configuration: BACKUP_DATABASE_URL BACKUP_SUPABASE_SERVICE_KEY' \
  env -u BACKUP_DATABASE_URL -u BACKUP_SUPABASE_SERVICE_KEY bash "$BK/offsite_backup.sh"
expect_fail "drill refuses a Supabase target" 'never a Supabase project' \
  env DRILL_TARGET_URL="postgres://postgres.x@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres" \
  DRILL_AGE_IDENTITY=x bash "$BK/restore_drill.sh"
age-keygen -o "$T/other.key" 2> /dev/null
expect_fail "drill fails with a key that is not a recipient" 'no identity matched|failed' \
  env DRILL_AGE_IDENTITY_FILE="$T/other.key" bash "$BK/restore_drill.sh"

# A corrupted bundle in a file destination: age and the checksum both reject it.
FILE_DEST="$T/dest-file"
OFFSITE_DEST_KIND=file OFFSITE_FILE_ROOT="$FILE_DEST" BACKUP_TIER=manual bash "$BK/offsite_backup.sh" 2> /dev/null
B="$(find "$FILE_DEST" -name bundle.tar.age)"
python3 - "$B" <<'PY'
import sys
p = sys.argv[1]
data = bytearray(open(p, "rb").read())
data[len(data) // 2] ^= 0xFF
open(p, "wb").write(bytes(data))
PY
expect_fail "drill rejects a corrupted bundle" 'failed|checksum' \
  env OFFSITE_DEST_KIND=file OFFSITE_FILE_ROOT="$FILE_DEST" DRILL_AGE_IDENTITY_FILE="$T/drill.key" bash "$BK/restore_drill.sh"

# Unit checks on the pure helpers.
printf 'x/selftest/weekly/20261001T000000Z-1/meta.json\nx/selftest/monthly/20261020T000000Z-2/meta.json\nx/selftest/weekly/20261020T000000Z-3/bundle.tar.age\n' \
  | python3 "$BK/bundle_tools.py" pick-latest | grep -q '20261020T000000Z-2/meta.json' || fail "pick-latest"
pass "pick-latest ignores incomplete backups"
printf ';\n4; 3079 16384 EXTENSION - supabase_vault \n5; 0 0 COMMENT - EXTENSION supabase_vault \n6; 3079 1 EXTENSION - pgcrypto \n9; 0 1 TABLE DATA vault secrets supabase_admin\n10; 0 2 TABLE DATA public users postgres\n' > "$T/toc"
printf 'pgcrypto\n' > "$T/ext"; printf 'public users\n' > "$T/tables"
python3 "$BK/bundle_tools.py" toc-filter --available-extensions "$T/ext" --existing-tables "$T/tables" < "$T/toc" 2> /dev/null > "$T/toc.out"
[ "$(grep -c '^;[0-9]' "$T/toc.out")" = 3 ] && grep -q '^10; 0 2 TABLE DATA public users' "$T/toc.out" && grep -q '^6; ' "$T/toc.out" \
  || { cat "$T/toc.out"; fail "toc-filter"; }
pass "toc-filter drops only unavailable extensions and their config data"

echo "offsite backup selftest: all checks passed"
