# Implementation plan

## Architecture impact

- Database: `public.access_codes` unique index/constraint and a new CHECK.
- Backend: `backend/routers/instructor.py` `mint_codes` switches from
  `[_gen_code() for _ in range(n)]` + plain insert to
  `insert_with_unique_codes` from `backend/services/access_code_gen.py` (#1733),
  through the instructor-scoped accessor. Admin paths already use it.
- `/auth/activate` is unchanged (already `strip().upper()`).

## Data and contracts

- `backend/migrations/325_access_codes_code_unique_canonical.sql`, no outer
  transaction (full SQL `research.md` §5):
  1. `SET lock_timeout = '5s'`; precheck aborts
     `access_codes_code_not_unique_or_not_canonical` with exact/normalized
     duplicate group counts and non-canonical counts.
  2. `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS access_codes_code_key ON public.access_codes (code)`.
  3. Abort if the index is invalid; attach it as constraint
     `access_codes_code_key UNIQUE USING INDEX` if no such constraint exists.
  4. In its own transaction: add `chk_access_codes_code_canonical` `NOT VALID`
     if missing, `VALIDATE`, then a postcondition on both objects.
- New #1733 codes (31-symbol upper-case alphabet, `XXXX-XXXX-XXXX`) and legacy
  codes on staging are canonical, so the CHECK accepts them.
- The runner (`backend/scripts/apply_migrations.sh`) does not wrap files in a
  transaction, which `CONCURRENTLY` requires; the implementation must confirm
  this through `apply_migration_locked.sql` in CI.
- Ordering: independent of 321–324; a ledger gap is allowed by
  `backend/migrations/README.md`.

## UI and interaction

- No UI change; the admin and instructor code panels keep their states.

## Work decomposition

- T002 migration + T004 migration tests; T003 instructor mint change + unit
  test in parallel; T005 README.

## Rollout and rollback

- Staging, then production after P1–P6 are clean. See `rollout.md`.
- Rollback drops only the CHECK; never drop `access_codes_code_key` where it
  existed before 325.

## Verification strategy

- Static test: no `BEGIN` before `CONCURRENTLY`; precheck and postcondition present.
- PostgreSQL test: insert `abcd-1234` → 23514; insert duplicate → 23505;
  re-apply 325 → no-op; invalid-index branch aborts.
- Unit test: instructor mint with a simulated 23505 retries and succeeds.
- Staging journeys `research.md` §9 AC-1…AC-8 (AC-3 now expects `XXXX-XXXX-XXXX`).
