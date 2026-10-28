# Implementation plan

## Architecture impact

- Database only: `public.users` CHECK constraints. No route, model, service or
  UI change is required; both write paths (`backend/routers/admin.py:852-856`,
  `backend/routers/auth.py:503-508`) already write valid values and only the
  database refuses them.
- SECWRITE-0022 (migration 320) stays the authority on who may write `role`:
  clients have no INSERT/UPDATE on `users` and `trg_users_guard_privileged_columns`
  rejects client-role changes to `role`. 323 widens the set of valid *values*,
  not the set of writers.

## Data and contracts

- New file `backend/migrations/323_users_role_single_check.sql`, one
  transaction, `lock_timeout = 5s`, idempotent. Full SQL: `research.md` §6.2.
  Steps:
  1. Abort (`users_role_outside_canonical_set`) if any row has a non-NULL role
     outside `user, student, instructor, admin`.
  2. Ensure `chk_users_role` exists with exactly the canonical definition;
     recreate it `NOT VALID` only if missing or drifted, then `VALIDATE`.
  3. `DROP CONSTRAINT IF EXISTS users_role_check`.
  4. Postcondition: exactly one CHECK references `role`, it is the canonical
     validated `chk_users_role`, and `trg_users_guard_privileged_columns`
     exists with `tgenabled = 'O'`; otherwise abort.
- No data change; `role` stays nullable with default `'user'`.
- Ordering: 323 is logically independent of 321 (#1727) and 322 (#1720). If 323
  lands first the ledger has a temporary gap; `backend/migrations/README.md`
  allows this ("do not assume the sequence is dense"; "The runner applies any
  unapplied file regardless of order") and `backend/scripts/apply_migrations.sh`
  applies every file not yet in the ledger in name order, so 321/322 still apply
  later. Whichever PR merges last updates the README "highest is / next" line.

## UI and interaction

- No UI change. The existing role select in
  `frontend/app/(authed-admin-users)/admin/users/admin-users-panel.tsx` starts
  succeeding; its success and error banners are unchanged.

## Work decomposition

- T002 migration and T004 tests own `backend/migrations/323_*` and
  `backend/tests/test_migration_323_*`; T003 README and T005 seed comment are
  independent documentation edits.

## Rollout and rollback

- Staging first with the advisory-locked runner, then production at release with
  explicit authorization; no backend deploy coupling. See `rollout.md`.
- Rollback re-adds `users_role_check` only when zero `student`/`instructor` rows
  exist (SQL in `research.md` §6, guarded); it re-creates bug A-05, so prefer a
  forward fix.

## Verification strategy

- Static test on the 323 file (drops only `users_role_check`, keeps the four
  values, has the postcondition and 320 check, no GRANT/DROP TRIGGER).
- PostgreSQL test: table with both CHECKs plus the 320 trigger → apply 323 →
  `service_role` can set `instructor`; `authenticated` cannot; `'bogus'` fails
  with 23514; second apply is a no-op.
- Staging journeys AC-1…AC-14 in `research.md` §8.
