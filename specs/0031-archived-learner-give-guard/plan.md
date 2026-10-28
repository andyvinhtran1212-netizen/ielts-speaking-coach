# Implementation plan

## Architecture impact

- Database owns the invariant "no new give for an archived learner": migration
  331 adds trigger `archive_guard_writing_assignment_student`
  (`BEFORE INSERT OR UPDATE OF student_id`, row level) and its function
  `fn_guard_writing_assignment_student_archived()` (SECURITY DEFINER,
  `search_path = public, pg_temp`, EXECUTE revoked from client roles). It covers
  every writer in the inventory (`research.md` §2), including manual SQL.
- Backend translates the refusal; the Python pre-checks stay as the fast path:
  - `services/student_service.py`: `raise_if_student_archived(db, exc,
    candidate_ids)` re-raises a `student_archived` error as the 0029 409 (ids
    from DETAIL, comma lists included; otherwise a canonical re-read); no-op for
    any other error and for an already-mapped `HTTPException`.
  - `routers/admin_writing_assignments.py`: individual RPC and fan-out RPC
    `except` blocks call it first; the legacy individual insert is wrapped.
  - `routers/instructor.py`: the individual insert is wrapped.
  - `services/cohort_assignment_service.py`: the bulk insert of
    `fan_out_assignment` (admin legacy fan-out and instructor fan-out) and of
    `backfill_cohort_writing_assignments` (activation Step 6 and the roster
    script) is wrapped, so every caller of these writers gets the 409.
  - `scripts/backfill_class_enrollment_roster.py`: catches that 409, logs
    `E1 skipped archived student=… cohort=…`, counts it and continues.
  - `routers/auth.py` is unchanged: Step 6 already logs any backfill failure
    as a warning without failing the activation.
- Frontend: no change. Both give UIs already render `detail.message` of the
  0029 409 (`public/js/api.js` object-detail handling).

## Data and contracts

- `backend/migrations/331_writing_assignment_archived_student_guard.sql`: one
  transaction, `lock_timeout = 5s`; preconditions (326 column present,
  `writing_assignments` present, both lifecycle functions contain
  `students WHERE id = p_student_id FOR UPDATE`); function; REVOKE;
  `CREATE OR REPLACE TRIGGER` (PG14+, CI 16, Supabase 17); comment;
  postconditions (trigger enabled and bound to the function, definer with the
  pinned `search_path`, no client EXECUTE, no client UPDATE on `students`).
- Error vocabulary unchanged: default SQLSTATE P0001, message
  `student_archived`, matched by `student_service.is_student_archived_error`
  exactly like the 326 guards.
- API before → after (only inside the race window; outside it the pre-check
  answers first and nothing changes):

| Path | Before | After |
| --- | --- | --- |
| `POST /admin/writing/assignments` with `request_id` | 201, a row for the archived learner | 409 `student_archived`, no row, no ledger row |
| `POST /admin/writing/assignments` without `request_id` | 201, rows created | 409 `student_archived`, no row (one statement) |
| `POST /instructor/assignments` | 201 | 409 `student_archived` |
| `POST /admin/writing/assignments/fan-out` with `request_id` | 409 `roster_changed` (already safe) | unchanged; `student_archived` → 409 only as a backstop |
| `POST /admin/writing/assignments/fan-out` without `request_id`, `POST /instructor/assignments/fan-out` | 201 including the archived learner | 409 `student_archived`, nobody receives the give |
| `/auth/activate` Step 6 backfill | row created | refused, logged as a warning; activation succeeds |
| roster backfill script E1 | row created | learner skipped and logged; the run continues |

## UI and interaction

- See `ui-states.md`; no component change.

## Rollout and rollback

- Order is free (`rollout.md`): 331 alone fails closed (an old backend inside
  the race returns 500 and creates no row); the backend alone is dormant.
- Rollback: the forward migration in the 331 header (drop trigger, then
  function); it reopens the race only. A backend revert is safe at any time.

## Verification strategy

- `backend/tests/test_migration_331_archived_student_give_guard.py`: static
  contract (transaction, lock timeout, trigger shape, `FOR KEY SHARE`, refuse
  never skip, preconditions, postconditions, trigger order, no other migration
  drops/replaces/bypasses the guard, no application write of `archived_at`,
  rollback note). PostgreSQL on the 326 harness plus the 228 RPC, its ledger
  and an origin side-effect trigger: every writer refused with nothing written
  (also for a role without UPDATE on `students`), `student_id` change refused
  while other updates pass, restore, FK error kept, replay after archive,
  preconditions abort, rollback then re-apply; concurrency: archive-first ×
  {plain, RPC, bulk, update} refused after a measured wait, give-first ×
  {plain, RPC, bulk} kept with the archive waiting, stale pre-check, negative
  control without 331 (the race creates the row), jittered cohort RPC vs
  archive invariant.
- `backend/tests/test_writing_give_archived_race.py`: each of the six route
  paths plus the backfill service maps the trigger error to the 409 with the
  right ids (DETAIL and re-read), creates nothing; activation Step 6 stays
  best-effort; the script skips and continues; other errors stay 500.
- Existing 0029 suites (`test_admin_students_archive.py`,
  `test_migration_326_student_archive.py`) unchanged and passing.
- Staging/production read-only checks R1–R4 (`research.md` §R).
