#!/usr/bin/env bash
# Setup DB test environment for Phase D Wave 2 (Flashcards + SRS).
# Run from project root: bash backend/scripts/setup_phase_d_wave_2_test_env.sh
#
# - Idempotent: safe to run multiple times.
# - Requires: DATABASE_URL env var pointing to the target Supabase Postgres.
# - Re-uses the RLS-test-user provisioning from setup_phase_d_test_env.sh
#   (Wave 1) — same two accounts power the cross-user RLS tests for stacks,
#   cards, and reviews.
set -euo pipefail

echo "== Phase D Wave 2 Test Env Setup =="

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set."
  exit 1
fi

# 1. Apply Wave 2 migrations (idempotent via IF NOT EXISTS / DROP POLICY IF EXISTS).
#    Order matters:
#      025 creates flashcard_stacks
#      026 references flashcard_stacks
#      027 references user_vocabulary (Phase B 019)
#      028 adds user_vocabulary.topic + backfills from sessions.topic — the
#          Manual Stack "topic" filter depends on this column.
for migration in \
    025_flashcard_stacks \
    026_flashcard_cards \
    027_flashcard_reviews \
    028_user_vocab_topic; do
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
psql "$DATABASE_URL" -c "\dt flashcard_stacks"      | tail -3 || true
psql "$DATABASE_URL" -c "\dt flashcard_cards"       | tail -3 || true
psql "$DATABASE_URL" -c "\dt flashcard_reviews"     | tail -3 || true
psql "$DATABASE_URL" -c "\dt flashcard_review_log"  | tail -3 || true

# 3. Verify RLS policies — all four tables must enforce USING + WITH CHECK on
#    the mutating policies.  This is the single most common Wave 1 audit miss.
echo ""
echo "=== RLS policy verification ==="
psql "$DATABASE_URL" <<'SQL'
SELECT tablename, policyname, cmd,
       (qual IS NOT NULL)       AS has_using,
       (with_check IS NOT NULL) AS has_with_check
  FROM pg_policies
 WHERE tablename IN ('flashcard_stacks','flashcard_cards','flashcard_reviews','flashcard_review_log')
 ORDER BY tablename, cmd, policyname;
SQL

# 4. Seed mock vocab for an RLS test user (only when the bank is empty for that user).
#    Requires SUPABASE_SERVICE_KEY + the RLS test creds from Wave 1 setup.
echo ""
echo "=== Seeding mock vocabulary for RLS test user A ==="
if [[ -z "${RLS_TEST_USER_A_EMAIL:-}" ]]; then
  echo "WARN: RLS_TEST_USER_A_EMAIL not in env — skipping seed."
  echo "      Run backend/scripts/setup_phase_d_test_env.sh first, then"
  echo "      'set -a; source backend/.env.staging.test' before this script."
else
  psql "$DATABASE_URL" <<SQL
DO \$\$
DECLARE
  uid UUID;
  cur_count INT;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE email = '${RLS_TEST_USER_A_EMAIL}' LIMIT 1;
  IF uid IS NULL THEN
    RAISE NOTICE 'User % not found — skipping seed.', '${RLS_TEST_USER_A_EMAIL}';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO cur_count
    FROM user_vocabulary
   WHERE user_id = uid AND NOT is_archived;

  IF cur_count >= 30 THEN
    RAISE NOTICE 'User already has % vocabulary rows — skipping seed.', cur_count;
    RETURN;
  END IF;

  INSERT INTO user_vocabulary (user_id, headword, definition_vi, source_type, category)
  SELECT uid,
         'word_' || gs::text,
         'Vietnamese gloss ' || gs::text,
         CASE (gs % 3) WHEN 0 THEN 'used_well' WHEN 1 THEN 'needs_review' ELSE 'upgrade_suggested' END,
         CASE (gs % 4) WHEN 0 THEN 'topic' WHEN 1 THEN 'idiom' WHEN 2 THEN 'phrasal_verb' ELSE 'collocation' END
    FROM generate_series(1, 30) AS gs
   ON CONFLICT (user_id, lower(headword)) WHERE NOT is_archived DO NOTHING;

  RAISE NOTICE 'Seeded mock vocabulary for user %.', uid;
END \$\$;
SQL
fi

echo ""
echo "== Phase D Wave 2 setup complete. =="
echo "Next:"
echo "  pytest backend/tests/test_srs_algorithm.py -v"
echo "  pytest backend/tests/test_flashcard_e2e.py -v"
echo "  pytest backend/tests/test_due_queue.py -v"
echo "  set -a; source backend/.env.staging.test  # then:"
echo "  pytest backend/tests/test_stack_rls.py -v   # must NOT skip"
