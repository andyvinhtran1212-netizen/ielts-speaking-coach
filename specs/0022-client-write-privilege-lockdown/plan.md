# Implementation plan

## Architecture impact

- Database privilege layer: `backend/migrations/320_client_write_privilege_lockdown.sql`.
- FastAPI admission: `routers/sessions.require_speaking_entitlement` (active
  account + session-mode permission, class-assignment sessions entitled by the
  assignment, any Speaking scope when there is no session) is called after the
  ownership lookup in `routers/questions.py` (generate, custom, cue-card),
  `routers/grading.py` (POST responses) and `routers/pronunciation.py`
  (POST pronunciation/full). No response shape changes; new 403s only.
- D1 results: `routers/exercises.py` writes `d1_sessions` and
  `vocabulary_exercise_attempts` through `_service_sb()` (service role) with
  the verified `user_id`, and seals attempts through the new service-only
  `fn_finalize_d1_attempt_for_user`; ownership reads stay on the learner JWT.
- No frontend component or OpenAPI contract changes. The browser uses
  supabase-js only for auth; FastAPI writes as `service_role`, except
  `routers/flashcards.py` and `routers/vocabulary_bank.py`, which write
  learner-owned Vocabulary/flashcard rows with the learner JWT.

## Data and contracts

- Revoke INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER from PUBLIC, `anon`
  and `authenticated` on every public relation (`r`, `p`, `v`, `m`, `f`), and
  sequence UPDATE (setval) from the client roles.
- Keep `authenticated` INSERT/UPDATE/DELETE on `user_vocabulary`,
  `flashcard_stacks`, `flashcard_cards`, `flashcard_reviews` and
  `flashcard_review_log` (owner-scoped RLS with WITH CHECK), plus
  `UPDATE (is_active)` on `user_d1_questions`.
- Default privileges: `ALTER DEFAULT PRIVILEGES FOR ROLE <owner> IN SCHEMA
  public` for `postgres`, `supabase_admin`, the runner and every other role
  holding a default ACL in public, when the runner may act for it (superuser
  or member); tables lose client writes, sequences lose client UPDATE. The
  postcondition is strict for those owners and raises a WARNING for an owner
  the runner cannot act for (`supabase_admin` on hosted Supabase). Function
  EXECUTE defaults stay unchanged (documented).
- `users`: no client UPDATE; the dashboard policy becomes `TO authenticated`
  with USING/WITH CHECK `auth.uid() = id` when it exists; a SECURITY INVOKER
  BEFORE UPDATE trigger rejects non-profile column changes by client roles.
  `users_role_check` and `chk_users_role` are untouched.
- Revoke client EXECUTE on every SECURITY DEFINER trigger function in public
  (the seven F14 guards) and on the retired `fn_finalize_d1_attempt`.
- A postcondition checks effective relation, column, sequence, default-ACL,
  function and policy state and aborts on any survivor.

## Rollout and rollback

- Staging first through the advisory-locked runner, then production together
  with the backend promotion (the previous backend's D1 writes need the old
  grants). Rollback is a narrow forward grant for a proven legitimate write,
  never a blanket re-grant. See `rollout.md`.

## Verification strategy

- `backend/tests/test_migration_320_client_write_lockdown.py`: static drift
  guards (allowlist equals learner-JWT write surface, D1 writes use the service
  client with the user id, column grant equals the learner write, no users
  grant, FOR ROLE default privileges, F14 coverage, browser has no PostgREST
  writes) and real PostgreSQL tests that reproduce F01/F03/F14 and the client
  default ACLs before the migration and prove each closed after two
  applications, with trigger guards still firing; plus a non-superuser runner
  with a second default-ACL owner it is not a member of (succeeds with the
  warning; still aborts on an existing client-writable relation).
- `backend/tests/test_speaking_entitlement_guard.py`: guard decisions and
  endpoint wiring (ownership 404 first, then 403 before any AI call).
- `backend/tests/test_d1_session.py`: the D1 flow works with a learner client
  that cannot write results; completion is user-scoped.
- Full backend and frontend suites; staging exploit replay and read-only queries.
