#!/usr/bin/env bash
# Disaster recovery: restore a DECRYPTED bundle's database into a NEW, empty
# Supabase project, as the project's `postgres` role. Storage bytes are a
# separate step (storage_tool.py restore --upsert). Runbook:
# docs/runbooks/offsite-backup.md "Restore procedure".
#
# The new project already has Supabase's roles, extensions and the auth,
# storage and realtime schemas, so only the app's own objects are recreated.
# Order matters: public tables first, then all rows (auth, storage, public)
# with triggers and FK checks off, then public indexes/FKs/policies/triggers
# (FKs to auth.users validate only once its rows exist), then app-defined
# triggers/policies on auth/storage tables.
#
# Required:
#   RESTORE_BUNDLE_DIR    directory with manifest.json and db/ from the bundle
#   RESTORE_TARGET_URL    new project's session-pooler URI (port 5432) as postgres
#   RESTORE_CONFIRM_REF   project ref that RESTORE_TARGET_URL must contain
# Optional:
#   RESTORE_APP_SCHEMAS   comma list (default public)
#   RESTORE_DATA_URL      connection for the data pass (default RESTORE_TARGET_URL;
#                         the self-test uses a superuser because plain Postgres
#                         reserves session_replication_role to superusers)
set -euo pipefail
umask 077
# shellcheck source=scripts/backup/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_vars RESTORE_BUNDLE_DIR RESTORE_TARGET_URL RESTORE_CONFIRM_REF
case "$RESTORE_TARGET_URL" in
  *"$RESTORE_CONFIRM_REF"*) ;;
  *) die "RESTORE_TARGET_URL does not contain RESTORE_CONFIRM_REF" ;;
esac
DUMP="$RESTORE_BUNDLE_DIR/db/full.dump"
[ -f "$DUMP" ] || die "$DUMP not found (decrypt and unpack the bundle first)"
APP_SCHEMAS="${RESTORE_APP_SCHEMAS:-public}"
DATA_URL="${RESTORE_DATA_URL:-$RESTORE_TARGET_URL}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/restore-project.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
q() { psql -X -q -v ON_ERROR_STOP=1 -At -d "$RESTORE_TARGET_URL" -c "$1"; }
schema_args=()
IFS=, read -ra _schemas <<< "$APP_SCHEMAS"
for s in "${_schemas[@]}"; do schema_args+=(--schema="$s"); done
in_list="'$(printf '%s' "$APP_SCHEMAS" | sed "s/,/','/g")'"

# 0. Only a fresh project: never merge into, or overwrite, live data.
[ "$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ($in_list) AND c.relkind IN ('r','p')")" = 0 ] \
  || die "target already has tables in $APP_SCHEMAS; restore only into a new, empty project"
[ "$(q "SELECT count(*) FROM auth.users")" = 0 ] || die "target auth.users is not empty"

# 1. Extensions the dump used (no-op for the ones Supabase pre-installs).
grep -E '^[0-9]+; [0-9]+ [0-9]+ EXTENSION ' "$RESTORE_BUNDLE_DIR/db/toc.txt" > "$WORK/ext.list" || true
pg_restore --file=- --use-list="$WORK/ext.list" "$DUMP" | grep '^CREATE EXTENSION' > "$WORK/ext.sql" || true
while IFS= read -r stmt; do
  psql -X -q -v ON_ERROR_STOP=1 -d "$RESTORE_TARGET_URL" -c "$stmt" > /dev/null 2>&1 \
    || printf '::warning::extension not created (enable it in the dashboard if the app needs it): %s\n' "$stmt" >&2
done < "$WORK/ext.sql"

# 2. Custom roles the new project lacks (Supabase-reserved roles exist already).
log "roles"
q "SELECT rolname FROM pg_roles" > "$WORK/roles.txt"
python3 "$BUNDLE_TOOLS" roles-filter --only-missing --existing-roles "$WORK/roles.txt" \
  --current-user "$(q 'SELECT current_user')" < "$RESTORE_BUNDLE_DIR/db/roles.sql" > "$WORK/roles.sql"
psql -X -q -v ON_ERROR_STOP=1 -d "$RESTORE_TARGET_URL" -f "$WORK/roles.sql" > /dev/null

# 3. App schema objects: tables, types, functions, views, grants.
log "pre-data ($APP_SCHEMAS)"
pg_restore --exit-on-error --no-owner --section=pre-data "${schema_args[@]}" \
  --dbname="$RESTORE_TARGET_URL" "$DUMP"

# 4. Rows of auth, storage and the app schemas in one transaction, with
# triggers and FK enforcement off (Supabase lets postgres set this).
log "data (auth, storage, $APP_SCHEMAS)"
python3 "$BUNDLE_TOOLS" project-toc --mode data --app-schemas "$APP_SCHEMAS" \
  < "$RESTORE_BUNDLE_DIR/db/toc.txt" > "$WORK/data.list"
pg_restore --data-only --file="$WORK/data.sql" --use-list="$WORK/data.list" "$DUMP"
psql -X -q -v ON_ERROR_STOP=1 --single-transaction -d "$DATA_URL" \
  -c 'SET session_replication_role = replica' -f "$WORK/data.sql" > /dev/null 2> "$WORK/data.err" \
  || die "data restore failed (details in the local psql output; not printed because it can quote rows)"

# 5. Indexes, constraints (FKs to auth.users validate now), triggers, policies.
log "post-data ($APP_SCHEMAS)"
pg_restore --exit-on-error --no-owner --section=post-data "${schema_args[@]}" \
  --dbname="$RESTORE_TARGET_URL" "$DUMP"

# 6. App-defined triggers/policies on auth and storage tables.
q "SELECT n.nspname || ' ' || c.relname || ' ' || t.tgname FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('auth','storage') AND NOT t.tgisinternal
   UNION ALL
   SELECT schemaname || ' ' || tablename || ' ' || policyname FROM pg_policies
    WHERE schemaname IN ('auth','storage')" > "$WORK/existing.txt"
python3 "$BUNDLE_TOOLS" project-toc --mode platform --existing "$WORK/existing.txt" \
  < "$RESTORE_BUNDLE_DIR/db/toc.txt" > "$WORK/platform.list"
if [ -s "$WORK/platform.list" ]; then
  log "app triggers/policies on auth/storage"
  pg_restore --exit-on-error --no-owner --use-list="$WORK/platform.list" \
    --dbname="$RESTORE_TARGET_URL" "$DUMP"
fi

# 7. Exact row counts for what was restored.
log "verify row counts"
python3 "$BUNDLE_TOOLS" db-checks --target "$RESTORE_TARGET_URL" --bundle "$RESTORE_BUNDLE_DIR" \
  --include-schemas "auth,storage,$APP_SCHEMAS" \
  --exclude-tables "auth.schema_migrations,storage.migrations" --expect-users
log "database restored; next: storage_tool.py restore --upsert, then re-apply newer migrations"
