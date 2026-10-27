# Rollout and rollback

## Preconditions

- STUDENTARCHIVE-0029 approved on `staging` (this PR).
- Migration 320 applied (326 aborts otherwise).
- T002a function bodies read on staging and the fan-out assumption confirmed.
- Production read-only checks P1–P6 (`research.md` §6): pending Vinh's
  read-only permission (chờ anh Vinh cho phép chạy chỉ đọc).
- Ledger order: 326 may land before 321–325; the README allows a non-dense
  sequence and the runner applies unapplied files regardless of order.

## Staging

- Apply 326 with the advisory-locked runner, then deploy the backend and UI at
  the merged SHA, then run `research.md` §7 AC-1…AC-13 with E2E learners only.

## Production

- With Vinh's explicit authorization at promotion: apply 326, deploy backend,
  verify P2 shows the new columns/table and no learner is archived, then archive
  and restore one E2E or Vinh-designated test learner.

## Rollback and repair

- Roll back backend/UI first (old code ignores the new columns).
- Schema rollback (`research.md` §4) aborts unless zero learners are archived
  and the audit table is empty; otherwise restore each archived learner with
  `fn_restore_student` first. Ship it as a new forward migration.
- Repair a wrongly archived learner with the restore route; the audit records both actions.

## Observability

- `student_lifecycle_audit` rows per day by action; backend logs for archive
  and restore 4xx/5xx; zero 500s on `DELETE /admin/students/{id}`.
- Owner: Vinh (product); the implementing agent reports AC results on the PR.
