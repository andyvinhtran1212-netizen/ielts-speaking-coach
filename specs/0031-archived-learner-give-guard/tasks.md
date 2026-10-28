# Tasks

- [x] T001 Approve GIVEARCHIVE-0031 and lock 0031/331 (approved by Vinh with decisions 1–3, `approval-decision.md`). `owns: specs/0031-archived-learner-give-guard/*, specs/README.md`
- [x] T002 Write migration 331 and the README note. `owns: backend/migrations/331_writing_assignment_archived_student_guard.sql, backend/migrations/README.md` `depends: T001`
- [x] T003 Add `student_service.raise_if_student_archived` and map the refusal on every give path; make the roster backfill script skip on `student_archived`. `owns: backend/services/student_service.py, backend/routers/admin_writing_assignments.py, backend/routers/instructor.py, backend/services/cohort_assignment_service.py, backend/scripts/backfill_class_enrollment_roster.py` `depends: T001`
- [x] T004 Static and PostgreSQL tests for 331, including the pinned "A-10/330 keeps the guard" and "only the 326 functions write `archived_at`" checks. `owns: backend/tests/test_migration_331_archived_student_give_guard.py` `depends: T002`
- [x] T005 Two-session concurrency tests: archive-first, give-first, stale pre-check, negative control without 331, jittered cohort RPC vs archive. `owns: backend/tests/test_migration_331_archived_student_give_guard.py` `depends: T002`
- [x] T006 Route mapping tests for the six give paths, the backfill service, activation Step 6 and the roster script. `owns: backend/tests/test_writing_give_archived_race.py` `depends: T003`
- [ ] T007 Staging: apply 331 with the advisory-locked runner, deploy the merged SHA, run R1–R4 (read-only) and the Web Manager journey W1–W5 (`research.md` §R); record SHA, outputs and fan-out timing. `depends: T002, T003, T004, T005, T006`
- [ ] T008 Production, with Vinh's explicit authorization at the `staging` → `main` promotion: apply 331 under the advisory lock before or with the backend, then run R1–R3 read-only. `depends: T007`

Follow-up outside this spec (separate `small` change): map 40P01/40001 on the
give routes to a retryable 409.
