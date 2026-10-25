# Implementation plan

## Architecture impact

- Database privilege layer only: `backend/migrations/320_client_write_privilege_lockdown.sql`.
- No FastAPI route, frontend component or OpenAPI contract changes. The browser
  uses supabase-js only for auth; FastAPI writes as `service_role`, except
  `routers/flashcards.py`, `routers/vocabulary_bank.py` and
  `routers/exercises.py`, which write learner-owned rows with the learner JWT.

## Data and contracts

- Revoke INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER from PUBLIC, `anon`
  and `authenticated` on every public relation (`r`, `p`, `v`, `m`, `f`).
- Keep `authenticated` INSERT/UPDATE/DELETE on `user_vocabulary`,
  `user_d1_questions`, `flashcard_stacks`, `flashcard_cards`,
  `flashcard_reviews`, `flashcard_review_log`, `vocabulary_exercise_attempts`
  and `d1_sessions` (owner-scoped RLS with WITH CHECK).
- Revoke the same privileges in the runner role's default privileges.
- Grant `authenticated` UPDATE on the nine PATCH `/auth/profile` columns of
  `users`; a SECURITY INVOKER BEFORE UPDATE trigger rejects every other column
  change when `current_user` or the PostgREST JWT role is a client role.
- A postcondition checks effective privileges and aborts on any survivor.

## Rollout and rollback

- Staging first through the advisory-locked runner, then production before or
  together with the promotion. Rollback is a narrow forward grant for a proven
  legitimate write, never a blanket re-grant. See `rollout.md`.

## Verification strategy

- `backend/tests/test_migration_320_client_write_lockdown.py`: static drift
  guards (allowlist equals learner-JWT write surface, grant equals
  `ProfileUpdate`, browser has no PostgREST writes) and real PostgreSQL tests
  that reproduce F01 before the migration and prove F01/F03/F04 closed after
  two applications.
- Full backend and frontend suites; staging exploit replay and read-only query.
