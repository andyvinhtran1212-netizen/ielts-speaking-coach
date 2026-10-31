# Implementation plan

## Architecture impact

- Database only. Migration 344 drops the 29 policies that call
  `public.is_current_user_admin()` / `public.is_current_user_instructor()` and
  the 3 dead BL-11 own-row write policies, then revokes every table privilege
  of `anon` and `authenticated` on the 21 tables (listed in `spec.md` and
  `research.md`). No GRANT.
- RLS stays enabled on all 21 tables; the learner own-read policies stay in
  place (inert without a grant); the two helper functions and their ACL stay.
- FastAPI and the frontend are unchanged: they reach these tables only through
  `service_role`, and the frontend has no `supabase.from(...)` table calls.

## Data and contracts

- No row is read or written by the migration.
- Catalog before → after on the 21 tables: function-calling policies 29 → 0;
  BL-11 policies 3 → 0; `anon=r`, `authenticated=r` → no entry; `service_role`
  entries unchanged (T001 baseline in `research.md`, including
  `class_action_log` without TRUNCATE).
- PostgREST before → after for a learner or instructor JWT: SELECT fails with
  42501 raised from inside a policy (PC-J74 I5) → 42501 "permission denied for
  table"; writes were already refused since 320 and stay refused.
- FastAPI API and OpenAPI contract: unchanged.

## UI and interaction

- None (`ui-states.md`).

## Rollout and rollback

- Apply 344 on staging first, then production at promotion; no backend deploy
  is needed and order with code is free (`rollout.md`).
- Rollback: the guarded down script in the 344 header recreates the dropped
  policies; it never grants a table privilege or function EXECUTE.

## Verification strategy

- `backend/tests/test_migration_344_rls_policy_cleanup.py`: static contract
  (one transaction, `lock_timeout`, no data change, no GRANT, table and policy
  lists equal the spec, down script never grants) and PostgreSQL 16 and 17 on
  a fixture that replays the 29 + 3 policies on the post-320 shape: double
  apply, the FR-001 to FR-003 postconditions, learner/instructor JWT reads and
  writes refused, `service_role` ACL byte-identical, precondition and
  postcondition failures.
- Existing suites: `test_migration_320_client_write_lockdown.py` and the PC-J94
  invariant `test_client_write_invariant_postgres.py` (#1923).
- Staging after apply: the T001 queries (T003) and the Security Auditor JWT
  probe (T004).
