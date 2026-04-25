#!/usr/bin/env bash
# Setup DB test environment for Phase D Wave 1 (D1 fill-blank + admin review).
# Run from project root: bash backend/scripts/setup_phase_d_test_env.sh
#
# - Idempotent: safe to run multiple times.
# - Requires: DATABASE_URL env var pointing to the target Supabase Postgres instance.
set -euo pipefail

echo "== Phase D Wave 1 Test Env Setup =="

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set."
  exit 1
fi

# 1. Apply Phase D migrations (idempotent via IF NOT EXISTS / DROP POLICY IF EXISTS)
for migration in 021_vocabulary_exercises 022_vocabulary_exercise_attempts; do
  migration_file="backend/migrations/${migration}.sql"
  if [[ ! -f "$migration_file" ]]; then
    echo "ERROR: $migration_file not found."
    exit 1
  fi
  echo "Applying migration: $migration..."
  psql "$DATABASE_URL" -f "$migration_file"
done

# 2. Verify schema
echo ""
echo "=== Schema verification ==="
psql "$DATABASE_URL" -c "\dt vocabulary_exercises"          | tail -3 || true
psql "$DATABASE_URL" -c "\dt vocabulary_exercise_attempts"  | tail -3 || true

# 3. Seed mock D1 exercises (only when none exist yet — idempotent).
echo ""
echo "=== Seeding mock D1 exercises (only if pool is empty) ==="
psql "$DATABASE_URL" <<'SQL'
DO $$
DECLARE
  current_count INT;
BEGIN
  SELECT COUNT(*) INTO current_count
  FROM vocabulary_exercises
  WHERE exercise_type = 'D1';

  IF current_count = 0 THEN
    INSERT INTO vocabulary_exercises (exercise_type, status, content_payload)
    SELECT
      'D1',
      'published',
      jsonb_build_object(
        'sentence',    'The government must ___ the impact of climate change.',
        'answer',      'mitigate',
        'distractors', jsonb_build_array('aggravate','ignore','exacerbate'),
        'word',        'mitigate'
      )
    FROM generate_series(1, 50);
    RAISE NOTICE 'Seeded 50 mock D1 exercises.';
  ELSE
    RAISE NOTICE 'D1 pool already has % exercises — skipping seed.', current_count;
  END IF;
END $$;
SQL

echo ""
echo "== Phase D Wave 1 setup complete. =="
echo "Next: pytest backend/tests/test_d1_e2e.py backend/tests/test_rate_limit.py -v"
