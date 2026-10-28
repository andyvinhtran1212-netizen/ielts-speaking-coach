# Rollout and rollback

## Preconditions

- GIVEARCHIVE-0031 approved on `staging`.
- Migration 326 applied; 331 aborts otherwise (`migration_326_missing`) and
  also aborts if either 326 lifecycle function no longer locks `FOR UPDATE`.
- R1 and R3 (`research.md` §R, read-only) recorded on staging before apply.
- No long-running transaction on `writing_assignments`: `CREATE TRIGGER` takes
  a brief `SHARE ROW EXCLUSIVE` lock under `lock_timeout = 5s`; on timeout,
  re-run off-peak (the file is re-runnable).
- Ledger order: 331 may land before 327–330; the README allows a non-dense
  sequence and the runner applies unapplied files regardless of order.

## Staging

1. Apply 331 with the advisory-locked runner.
2. Deploy the merged SHA (backend; no frontend change).
3. Assignment Tracker runs R1–R4 (read-only); Web Manager runs W1–W5 with E2E
   accounts only. Record the SHA, outputs and fan-out timing before/after.

The order of steps 1 and 2 is flexible: the migration alone fails closed (an
old backend inside the race returns 500 and creates no row); the backend alone
is dormant.

## Production

With Vinh's explicit authorization at the `staging` → `main` promotion:

1. Apply 331 under the advisory lock.
2. Promote/deploy.
3. Run R1–R3 read-only.

No production writes, test gives or write-then-rollback probes are part of this
spec (R5 is not approved).

## Rollback and repair

- Backend revert: safe at any time; the trigger stays, and a race then returns
  500 with no row.
- Schema rollback: the forward migration in the 331 header (drop the trigger,
  then the function). Safe at any time, no data to repair; it only reopens the
  0029 race.
- Rows the old race already created (R3 confirmed candidates): report to Vinh.
  A `pending` row with no draft or essay may be removed through the existing
  guarded delete route (A-08); otherwise keep it. No automatic repair.

## Observability

- Backend 409 `student_archived` per give route (existing request logs,
  `detail.code`); zero 500s whose message contains `student_archived`.
- `[auth] cohort give backfill failed … student_archived` warnings and
  `E1 skipped archived` lines from the roster script.
- Owner: Vinh (product); the implementing agent reports T007 on the PR.
