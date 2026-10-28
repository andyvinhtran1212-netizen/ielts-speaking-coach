# Implementation plan

## Architecture impact

- Database only. Migration 335 adds `app_private.is_current_user_active()`
  (SECURITY DEFINER, STABLE, `search_path = ''`, reads `public.users.is_active`
  for `auth.uid()`, missing row or NULL = false) and, on `user_vocabulary`,
  `flashcard_stacks`, `flashcard_cards`, `flashcard_reviews`,
  `flashcard_review_log` and `user_d1_questions`, three RESTRICTIVE policies
  `TO authenticated`: `require_active_account_insert` (WITH CHECK),
  `_update` (USING + WITH CHECK) and `_delete` (USING), each calling
  `(SELECT app_private.is_current_user_active())` so it runs once per
  statement.
- The helper is outside `public` because migration 320's postcondition rejects
  client-executable SECURITY DEFINER functions in `public`; `authenticated`
  needs EXECUTE because RLS evaluates policies as the caller.
- FastAPI and the frontend are unchanged: every learner-JWT write route is
  already behind the W-03 gate, so only direct REST calls change.

## Data and contracts

- No row is read or written by the migration.
- PostgREST before → after for an inactive account: `POST` on the six tables
  201 → 403 (42501); `PATCH`/`DELETE` 200/204 with rows → 200/204 with no
  rows; `GET` unchanged. Active accounts: unchanged.
- FastAPI API and OpenAPI contract: unchanged.

## UI and interaction

- None (`ui-states.md`).

## Rollout and rollback

- Apply 335 on staging first, then production at promotion; no backend deploy
  is needed and order with code is free (`rollout.md`).
- Rollback: the forward migration in the 335 header (drop the 18 policies and
  the helper); it only reopens SEC-20261028-02.

## Verification strategy

- `backend/tests/test_migration_335_learner_writes_require_active.py`: static
  contract (transaction, no data change, the table list equals the
  learner-JWT write surface derived from the routers by the 320 test, helper
  shape and grants, restrictive per-command policies, catalog-driven
  postconditions, no other migration touches the policies/helper, no exempt
  learner-JWT write route). PostgreSQL 16 and 17 on the post-320 staging shape:
  the exploit works before 335; after a double apply inactive/NULL/missing-row
  accounts write nothing (INSERT 42501, UPDATE/DELETE 0 rows, invoker RPC
  refused) and keep reading; active learners keep every write and the owner
  checks; activation changes apply on the next statement; `service_role`
  writes for an inactive account; helper answers only for the caller and is
  not anon-executable; the rollback note reopens the hole; postcondition and
  precondition failures.
- Existing suites: `test_migration_320_client_write_lockdown.py`, activation
  gate and flashcard/vocabulary tests.
- Staging (after apply): the header catalog query, then 403/201 REST probes
  with an inactive and an active QA JWT.
