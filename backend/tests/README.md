# Backend Tests

Run in the current worktree with its configured Python environment. The complete
local backend command is `cd backend && python -m pytest tests/ -q`; CI setup is
in `.github/workflows/backend-tests.yml`. See
[../../docs/AGENT_WORKFLOW.md](../../docs/AGENT_WORKFLOW.md) for cross-layer checks.

Paid provider smoke tests are gated by `--run-smoke`; live integration tests
need explicit environment configuration. Report skips separately from passes.
Do not enable paid calls or mutate a shared database merely to eliminate skips.

## Focused examples (mocked external services)

```bash
cd backend
python -m pytest tests/test_vocab_guards.py -v
python -m pytest tests/test_grammar_smoke.py -v
```

## RLS Integration Tests

Verifies cross-user isolation for `user_vocabulary` at the DB layer using 2 real Supabase JWTs.

### Prerequisites

1. Use a disposable/staging test target with the required vocabulary schema.
   The historical Phase B setup helper below applies migrations directly and
   must not be used as a general forward runner for an existing hosted database;
   use [../migrations/README.md](../migrations/README.md) for hosted changes.
   ```bash
   bash backend/scripts/setup_phase_b_test_env.sh
   ```

2. Set env vars (one-time, use `.env.test` or shell export):
   ```
   SUPABASE_URL=...
   SUPABASE_ANON_KEY=...
   RLS_TEST_USER_A_EMAIL=...
   RLS_TEST_USER_A_PASSWORD=...
   RLS_TEST_USER_B_EMAIL=...
   RLS_TEST_USER_B_PASSWORD=...
   ```

3. Run:
   ```bash
   cd backend && pytest tests/test_rls_vocab_integration.py -v
   ```

Tests auto-skip when env vars are absent — safe to include in CI without setup.

### What is tested

| Test | Verifies |
|------|---------|
| `test_user_a_cannot_select_user_b_vocab` | RLS SELECT policy: User A gets 0 rows for User B's row |
| `test_user_a_cannot_update_user_b_vocab` | RLS UPDATE USING: User A UPDATE affects 0 rows |
| `test_user_a_cannot_delete_user_b_vocab` | RLS DELETE: User A DELETE affects 0 rows |
| `test_user_cannot_reassign_user_id_on_update` | RLS UPDATE WITH CHECK: `user_id` field cannot be mutated to another user's ID |
