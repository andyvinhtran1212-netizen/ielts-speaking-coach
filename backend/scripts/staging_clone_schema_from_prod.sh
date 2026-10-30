#!/usr/bin/env bash
# Clone the PRODUCTION schema (structure only, ZERO data) into the STAGING
# Supabase project. Production is only ever READ (pg_dump --schema-only).
#
# Why this exists: backend/migrations/ starts at 001 as ALTERs on a base
# schema that was created out-of-band and is not in the repo, so replaying
# migrations cannot bootstrap a fresh database. Cloning production structure
# is also the stronger parity guarantee for environment certification.
#
# Usage (from repo root):  backend/scripts/staging_clone_schema_from_prod.sh
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROD_REF="huwsmtubwulikhlmcirx"
STAGING_REF="zjphffoujxkpltixsbzj"

# pg_dump 17.6+ emits \restrict, which older psql clients cannot read.
PSQL_VERSION="$(psql --version)"
if [[ ! "$PSQL_VERSION" =~ ([0-9]+)\.([0-9]+) ]] ||
   (( BASH_REMATCH[1] < 17 || (BASH_REMATCH[1] == 17 && BASH_REMATCH[2] < 6) )); then
  echo "REFUSED: psql >= 17.6 is required" >&2
  exit 1
fi

PROD_URL="$(grep '^DATABASE_URL=' "$ROOT/backend/.env" | cut -d= -f2-)"
STAGING_URL="$(grep '^DATABASE_URL=' "$ROOT/backend/.env.staging" | cut -d= -f2-)"

[[ -n "$PROD_URL" ]] || { echo "DATABASE_URL not found in backend/.env" >&2; exit 1; }
[[ "$STAGING_URL" != "$PROD_URL" ]] || { echo "REFUSED: source and target URLs are identical" >&2; exit 1; }
[[ "$STAGING_URL" == *"$STAGING_REF"* ]] || { echo "REFUSED: staging URL is not the staging project ($STAGING_REF)" >&2; exit 1; }
[[ "$STAGING_URL" != *"$PROD_REF"* ]] || { echo "REFUSED: staging URL points at production" >&2; exit 1; }
# Different strings can still name one database (pooler vs direct host), so
# the source must positively name production. Never echo URLs or refs.
[[ "$PROD_URL" == *"$PROD_REF"* ]] || { echo "REFUSED: production URL does not name the production project" >&2; exit 1; }
[[ "$PROD_URL" != *"$STAGING_REF"* ]] || { echo "REFUSED: production URL names the staging project" >&2; exit 1; }

DUMP="$(mktemp -t prod_schema_XXXXXX.sql)"
trap 'rm -f "$DUMP" "$DUMP.tmp"' EXIT

echo "== dumping production schema (schema-only, read-only)"
# Keep object ACLs and the migration owner's defaults, including 204/320 (and 356
# once applied to the source). Replacing them with blanket grants would reopen
# client writes and audit-log maintenance privileges. Ownership stays local.
pg_dump "$PROD_URL" --schema-only --schema=public --no-owner -f "$DUMP"

TABLES=$(grep -c '^CREATE TABLE' "$DUMP" || true)
echo "== dump contains $TABLES CREATE TABLE statements"
if [[ "$TABLES" -lt 30 ]]; then
  echo "REFUSED: dump looks too small — aborting before touching staging" >&2
  exit 1
fi

# The dump re-creates schema public (we do it ourselves below) — drop that
# one line BEFORE any destructive step, with a portable temp-file edit
# (BSD `sed -i ''` breaks on GNU sed and would abort AFTER the schema drop,
# leaving staging empty — review P1 2026-07-13).
# Hosted postgres cannot ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
# (320 documents this boundary). Do not import those managed-role defaults;
# app migrations create objects as postgres. Keep all object ACLs and postgres
# defaults so the sensitive-table revokes survive without replaying migrations.
grep -v -e '^CREATE SCHEMA public;$' \
  -e '^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public ' \
  "$DUMP" > "$DUMP.tmp"
mv "$DUMP.tmp" "$DUMP"

echo "== preflighting dump roles and target default ACLs (read-only)"
# Global defaults survive DROP SCHEMA and can silently add privileges to the
# restored objects. Fail closed on ANY global entry, for every owner/grantee.
psql "$STAGING_URL" -X -qAt -v ON_ERROR_STOP=1 -c "
BEGIN READ ONLY;
SELECT json_build_object(
  'roles', ARRAY(SELECT rolname FROM pg_roles),
  'global_default_acl', EXISTS (
    SELECT 1 FROM pg_default_acl WHERE defaclnamespace = 0));
COMMIT;
" | python3 "$ROOT/backend/scripts/staging_clone_preflight.py" "$DUMP"

echo "== resetting staging public schema and restoring atomically"
# Any restore OR postcondition error rolls back the DROP and all restored DDL
# and ACLs. -X prevents operator psqlrc settings from changing this contract.
psql "$STAGING_URL" -X -1 -v ON_ERROR_STOP=1 -q \
  -f "$ROOT/backend/scripts/sql/staging_clone_reset.sql" -f "$DUMP" \
  -f "$ROOT/backend/scripts/sql/staging_clone_postconditions.sql"

echo "== baselining migration ledger (clone contains production-active migrations)"
"$ROOT/backend/scripts/apply_migrations.sh" --baseline "$STAGING_URL"

echo "== restoring staging-first Curated Vocabulary schema"
MIGRATION_FEATURES=curated_vocab \
  "$ROOT/backend/scripts/apply_migrations.sh" "$STAGING_URL"

echo "== verifying Curated Vocabulary ledger and schema"
psql "$STAGING_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  ledger_count integer;
BEGIN
  SELECT count(*)
    INTO ledger_count
    FROM public._schema_migrations
   WHERE filename IN (
     '234_vocab_curated_identity_and_editorial.sql',
     '235_vocab_curated_tasks_attempts_mastery.sql',
     '236_vocab_curated_recommendations_and_flags.sql',
     '237_vocab_curated_speaking_signal_maps.sql',
     '238_vocab_curated_pilot_metrics.sql',
     '239_vocab_curated_context_lookups.sql'
   );
  IF ledger_count <> 6 THEN
    RAISE EXCEPTION 'curated vocabulary ledger incomplete: %/6', ledger_count;
  END IF;
  PERFORM id FROM public.vocab_learning_units LIMIT 0;
  PERFORM id FROM public.vocab_unit_tasks LIMIT 0;
  PERFORM id FROM public.vocab_unit_recommendations LIMIT 0;
  PERFORM id FROM public.vocab_speaking_signal_maps LIMIT 0;
  PERFORM id FROM public.vocab_context_lookup_terms LIMIT 0;
END
$$;
SQL

echo "== verify: table count in staging public schema"
psql "$STAGING_URL" -tAc "select count(*) from information_schema.tables where table_schema='public';"
echo "done — staging schema now mirrors production structure (no data)."
