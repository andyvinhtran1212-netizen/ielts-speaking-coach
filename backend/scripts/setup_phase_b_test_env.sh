#!/usr/bin/env bash
# Setup DB test environment for Phase B audit verification.
# Run from project root: bash backend/scripts/setup_phase_b_test_env.sh
#
# Requires: DATABASE_URL env var pointing to the target Supabase Postgres instance.
set -euo pipefail

echo "== Phase B Test Env Setup =="

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set."
  exit 1
fi

# 1. Apply required migrations in order (idempotent — safe to re-run)
for migration in 018_analytics_events 019_user_vocabulary 019b_fix_rls_update_policy; do
  migration_file="backend/migrations/${migration}.sql"
  if [[ ! -f "$migration_file" ]]; then
    echo "WARN: $migration_file not found — skipping."
    continue
  fi
  echo "Applying migration: $migration..."
  psql "$DATABASE_URL" -f "$migration_file"
done

# 2. Ensure users.feature_flags column exists (may already exist after 019)
echo "Ensuring users.feature_flags column..."
psql "$DATABASE_URL" <<SQL
ALTER TABLE users
ADD COLUMN IF NOT EXISTS feature_flags JSONB DEFAULT '{}'::jsonb;
SQL

# 3. Verify schema
echo ""
echo "=== Schema verification ==="
psql "$DATABASE_URL" -c "\d users" | grep feature_flags || echo "WARN: feature_flags column not found in users"
psql "$DATABASE_URL" -c "\d user_vocabulary" || echo "WARN: user_vocabulary table not found"
echo ""
echo "== Setup complete. Ready for RLS 2-JWT tests. =="
echo "Next: set RLS_TEST_USER_A_EMAIL, RLS_TEST_USER_A_PASSWORD,"
echo "      RLS_TEST_USER_B_EMAIL, RLS_TEST_USER_B_PASSWORD"
echo "Then: cd backend && pytest tests/test_rls_vocab_integration.py -v"
