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
for migration in 021_vocabulary_exercises 022_vocabulary_exercise_attempts 022b_fix_attempts_rls_update_policy; do
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

# 4. Provision the 2 RLS test users (idempotent).
#
#    The live 2-JWT RLS suites (test_exercise_rls.py, test_rls_vocab_integration.py)
#    auto-skip when RLS_TEST_USER_A_* / RLS_TEST_USER_B_* are absent.  Auditing
#    Wave 1 requires those tests to RUN, not skip.  This block creates the
#    accounts via the Supabase Auth Admin API on first run and records their
#    credentials in backend/.env.staging.test (gitignored) so subsequent runs
#    can `set -a; source` the file and have the env vars in scope.
#
#    Skipped when the env already has both users set, or when the Supabase
#    admin credentials needed for creation are not present.  See
#    backend/tests/README_RLS_TESTING.md for the full workflow.
echo ""
echo "=== RLS test users ==="

CREDS_FILE="backend/.env.staging.test"

if [[ -n "${RLS_TEST_USER_A_EMAIL:-}" && -n "${RLS_TEST_USER_A_PASSWORD:-}" \
   && -n "${RLS_TEST_USER_B_EMAIL:-}" && -n "${RLS_TEST_USER_B_PASSWORD:-}" ]]; then
  echo "RLS_TEST_USER_* already in env — leaving them as-is."
elif [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_KEY:-}" ]]; then
  echo "WARN: SUPABASE_URL or SUPABASE_SERVICE_KEY not set — cannot auto-create RLS test users."
  echo "      Set them in backend/.env.staging or pass them inline. See backend/tests/README_RLS_TESTING.md."
else
  if ! command -v curl >/dev/null 2>&1; then
    echo "ERROR: curl is required to provision test users."
    exit 1
  fi

  EMAIL_A="${RLS_TEST_USER_A_EMAIL:-rls-test-a@phase-d.local}"
  EMAIL_B="${RLS_TEST_USER_B_EMAIL:-rls-test-b@phase-d.local}"
  # Stable per-environment password chosen here once; re-runs reuse it via
  # the credentials file so existing accounts continue to work.
  PASS_A="${RLS_TEST_USER_A_PASSWORD:-$(openssl rand -hex 16)}"
  PASS_B="${RLS_TEST_USER_B_PASSWORD:-$(openssl rand -hex 16)}"

  if [[ -f "$CREDS_FILE" ]]; then
    # Reuse passwords from a previous run so we don't churn them on every setup.
    # shellcheck disable=SC1090
    source "$CREDS_FILE"
    PASS_A="${RLS_TEST_USER_A_PASSWORD:-$PASS_A}"
    PASS_B="${RLS_TEST_USER_B_PASSWORD:-$PASS_B}"
    EMAIL_A="${RLS_TEST_USER_A_EMAIL:-$EMAIL_A}"
    EMAIL_B="${RLS_TEST_USER_B_EMAIL:-$EMAIL_B}"
  fi

  _create_user () {
    local email="$1" password="$2"
    local body
    body=$(printf '{"email":"%s","password":"%s","email_confirm":true}' "$email" "$password")
    local code
    code=$(curl -sS -o /tmp/sb_admin_user.json -w "%{http_code}" \
      -H "apikey: ${SUPABASE_SERVICE_KEY}" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
      -H "Content-Type: application/json" \
      -X POST -d "$body" \
      "${SUPABASE_URL%/}/auth/v1/admin/users")
    if [[ "$code" == "200" || "$code" == "201" ]]; then
      echo "  created $email"
    elif grep -qi 'already' /tmp/sb_admin_user.json 2>/dev/null; then
      echo "  $email already exists — leaving as-is."
    else
      echo "  WARN: $email creation returned HTTP $code:"
      cat /tmp/sb_admin_user.json
    fi
  }

  _create_user "$EMAIL_A" "$PASS_A"
  _create_user "$EMAIL_B" "$PASS_B"

  cat > "$CREDS_FILE" <<EOF
# Auto-generated by backend/scripts/setup_phase_d_test_env.sh — DO NOT COMMIT.
# Source this file before running the live 2-JWT RLS tests:
#   set -a; source $CREDS_FILE
#   pytest backend/tests/test_exercise_rls.py -v
RLS_TEST_USER_A_EMAIL="$EMAIL_A"
RLS_TEST_USER_A_PASSWORD="$PASS_A"
RLS_TEST_USER_B_EMAIL="$EMAIL_B"
RLS_TEST_USER_B_PASSWORD="$PASS_B"
EOF
  chmod 600 "$CREDS_FILE"
  echo "Wrote credentials to $CREDS_FILE (gitignored, mode 600)."
fi

echo ""
echo "== Phase D Wave 1 setup complete. =="
echo "Next:"
echo "  set -a; source $CREDS_FILE  # load RLS test creds (auto-created above)"
echo "  pytest backend/tests/test_d1_e2e.py backend/tests/test_rate_limit.py -v"
echo "  pytest backend/tests/test_exercise_rls.py -v   # now runs without skip"
