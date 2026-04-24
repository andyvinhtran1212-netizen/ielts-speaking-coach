# Backend Tests

## Unit tests (no external deps)

```bash
cd backend
pytest tests/test_vocab_guards.py -v       # 23 tests — vocab guard logic
pytest tests/test_grammar_smoke.py -v      # 4  tests — grammar content smoke
```

## RLS Integration Tests

Verifies cross-user isolation for `user_vocabulary` at the DB layer using 2 real Supabase JWTs.

### Prerequisites

1. Apply Phase B migrations:
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
