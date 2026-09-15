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

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROD_REF="huwsmtubwulikhlmcirx"
STAGING_REF="zjphffoujxkpltixsbzj"

PROD_URL="$(grep '^DATABASE_URL=' "$ROOT/backend/.env" | cut -d= -f2-)"
STAGING_URL="$(grep '^DATABASE_URL=' "$ROOT/backend/.env.staging" | cut -d= -f2-)"

[[ -n "$PROD_URL" ]] || { echo "DATABASE_URL not found in backend/.env" >&2; exit 1; }
[[ "$STAGING_URL" == *"$STAGING_REF"* ]] || { echo "REFUSED: staging URL is not the staging project ($STAGING_REF)" >&2; exit 1; }
[[ "$STAGING_URL" != *"$PROD_REF"* ]] || { echo "REFUSED: staging URL points at production" >&2; exit 1; }

DUMP="$(mktemp -t prod_schema_XXXXXX).sql"
trap 'rm -f "$DUMP"' EXIT

echo "== dumping production schema (schema-only, read-only)"
pg_dump "$PROD_URL" --schema-only --schema=public --no-owner --no-privileges -f "$DUMP"

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
grep -v '^CREATE SCHEMA public;$' "$DUMP" > "$DUMP.tmp"
mv "$DUMP.tmp" "$DUMP"

echo "== resetting staging public schema"
psql "$STAGING_URL" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
COMMENT ON SCHEMA public IS 'standard public schema';
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres, service_role;
SQL

echo "== applying schema to staging"
psql "$STAGING_URL" -v ON_ERROR_STOP=1 -q -f "$DUMP"

echo "== granting Supabase role access on cloned objects"
psql "$STAGING_URL" -v ON_ERROR_STOP=1 <<'SQL'
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
SQL

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
