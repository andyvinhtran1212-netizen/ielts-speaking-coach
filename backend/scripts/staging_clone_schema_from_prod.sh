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

echo "== resetting staging public schema"
psql "$STAGING_URL" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
COMMENT ON SCHEMA public IS 'standard public schema';
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres, service_role;
SQL

# The dump re-creates schema public (we already did) — drop that one line.
sed -i '' '/^CREATE SCHEMA public;$/d' "$DUMP"

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

echo "== verify: table count in staging public schema"
psql "$STAGING_URL" -tAc "select count(*) from information_schema.tables where table_schema='public';"
echo "done — staging schema now mirrors production structure (no data)."
