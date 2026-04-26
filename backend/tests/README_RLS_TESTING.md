# Live 2-JWT RLS Testing — Phase D Wave 1

Some tests in this folder verify Row Level Security with two real Supabase
JWTs.  They are auto-skipped when `RLS_TEST_USER_*` env vars are not set, so
CI without test users still passes — but Wave 1 audit explicitly requires
them to **run, not skip**.

This file documents the full workflow.

## Affected tests

| File | What it proves |
|---|---|
| `test_exercise_rls.py` | User A cannot SELECT or INSERT against User B's `vocabulary_exercise_attempts` rows. |
| `test_rls_vocab_integration.py` | Phase B regression: User A cannot SELECT / UPDATE / reassign User B's `user_vocabulary` rows. |

## One-time provisioning (auto, on staging)

`backend/scripts/setup_phase_d_test_env.sh` provisions the two accounts via
the Supabase Auth Admin API on its first run and remembers them in
`backend/.env.staging.test` (gitignored, mode 600) so subsequent runs reuse
the same credentials.

```bash
# 1. Make sure the staging env is loaded (URL + service key + DB URL)
set -a
source backend/.env.staging
set +a

# 2. Run the setup script — applies migrations, seeds D1, provisions users
bash backend/scripts/setup_phase_d_test_env.sh

# 3. Source the generated credentials
set -a
source backend/.env.staging.test
set +a

# 4. Run the live RLS suites — should NO LONGER skip
pytest backend/tests/test_exercise_rls.py -v
pytest backend/tests/test_rls_vocab_integration.py -v
```

The script is idempotent — re-running it will not churn passwords (it reuses
the values already in `.env.staging.test` if the file exists) and will not
duplicate the test users (the Supabase admin API surfaces `already exists`
which the script tolerates).

## Manual provisioning (without the setup script)

If you cannot run the setup script (e.g. you only have a Postgres URL, not
the Supabase admin key), create the two users by hand in the Supabase
Dashboard → Authentication → Users → Add user (set "Auto Confirm User"),
then export the credentials before running pytest:

```bash
export SUPABASE_URL="https://<project>.supabase.co"
export SUPABASE_ANON_KEY="<anon key>"
export RLS_TEST_USER_A_EMAIL="rls-test-a@phase-d.local"
export RLS_TEST_USER_A_PASSWORD="<your password>"
export RLS_TEST_USER_B_EMAIL="rls-test-b@phase-d.local"
export RLS_TEST_USER_B_PASSWORD="<your password>"

pytest backend/tests/test_exercise_rls.py backend/tests/test_rls_vocab_integration.py -v
```

## Cleanup

The two accounts are intentionally **persistent**: re-creating them on every
run would churn auth.users IDs and waste Supabase rate limits.  If you ever
need to remove them — for example before tearing down a staging project —
delete them via the dashboard or:

```bash
# Resolve user id, then DELETE /auth/v1/admin/users/<id>
curl -H "apikey: $SUPABASE_SERVICE_KEY" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
     "$SUPABASE_URL/auth/v1/admin/users?email=rls-test-a@phase-d.local"

curl -X DELETE \
     -H "apikey: $SUPABASE_SERVICE_KEY" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
     "$SUPABASE_URL/auth/v1/admin/users/<id>"
```

After cleanup, also remove `backend/.env.staging.test`.

## What "passes" means in audit context

For Wave 1 sign-off, both suites must report **all tests passed** (not
skipped):

```
backend/tests/test_exercise_rls.py::test_user_a_cannot_select_user_b_attempt PASSED
backend/tests/test_exercise_rls.py::test_user_a_cannot_insert_attempt_as_user_b PASSED
backend/tests/test_rls_vocab_integration.py::test_user_a_cannot_select_user_b_vocab PASSED
backend/tests/test_rls_vocab_integration.py::test_user_a_cannot_update_user_b_vocab PASSED
backend/tests/test_rls_vocab_integration.py::test_user_cannot_reassign_user_id_on_update PASSED
```

A `SKIPPED` line means the env wasn't sourced — fix that before reporting
the audit complete.
