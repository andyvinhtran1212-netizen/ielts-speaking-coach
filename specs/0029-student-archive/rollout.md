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
  the merged SHA, then run `research.md` §7 AC-1…AC-14 with E2E learners only.

## Production

- With Vinh's explicit authorization at promotion: apply 326, deploy backend,
  verify P2 shows the new columns/table and no learner is archived, then archive
  and restore one E2E or Vinh-designated test learner.

## Rollback and repair

- Before any backend rollback, run (read-only)
  `SELECT count(*) FROM public.students WHERE archived_at IS NOT NULL`.
- Zero archived learners: a plain revert of backend/UI is allowed (the old code
  only loses the archive/restore routes and filters).
- One or more archived learners: a plain revert is **not** allowed. The pre-0029
  backend calls the hard delete again (`backend/routers/admin_students.py:129-136`
  → `student_service.delete_student`, cascading away the archived learner's work,
  against FR-005/FR-006) and its `fetch_linked_student` admits archived learners
  to Writing (against FR-002); the schema rollback guard cannot catch either, and
  the append-only audit table cannot be emptied. Roll back with an
  archive-compatible build instead: a forward revert commit that removes only the
  faulty change and keeps DELETE → `fn_archive_student`, the archived filter in
  `fetch_linked_student`, the `/auth/activate` refusal and the 409
  `student_archived` mapping. Before it takes traffic, re-run AC-2 (DELETE leaves
  every row count unchanged), AC-7 (Writing 403), AC-8 (activation 403, code
  unused) and AC-14 (no membership reactivated) against it with an archived E2E
  learner. If no such build is possible, stop and escalate to Vinh rather than
  reverting: restoring every archived learner to make a plain revert safe
  re-admits them and needs his explicit decision.
- The 326 membership guards stay in place under any backend version; an old
  backend that hits them fails closed (500) rather than re-adding the learner.
- Schema rollback (`research.md` §4) aborts unless zero learners are archived
  and the audit table is empty; otherwise restore each archived learner with
  `fn_restore_student` first. It must re-create the unguarded 227 bodies of the
  three membership functions before dropping the columns. Ship it as a new
  forward migration.
- Repair a wrongly archived learner with the restore route; the audit records both actions.

## Observability

- `student_lifecycle_audit` rows per day by action; backend logs for archive
  and restore 4xx/5xx; zero 500s on `DELETE /admin/students/{id}`.
- Owner: Vinh (product); the implementing agent reports AC results on the PR.
