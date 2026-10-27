# Tasks

- [x] T001 Approve STUDENTARCHIVE-0029 on `staging` before implementation (approved by Vinh 2026-10-27 07:14 UTC+7; this spec PR).
- [ ] T002a Read the live bodies of `fn_create_class_assignment`, `fn_create_writing_assignments_idempotent` and the legacy cohort sync trigger function on staging (read-only) and record whether fan-out uses active memberships. `depends: T001`
- [ ] T002 Write `backend/migrations/326_student_archive.sql` per `research.md` §4, including the step 4b archive guards on the 227 membership writers. `owns: backend/migrations/326_student_archive.sql` `depends: T002a`
- [ ] T003 Implement the backend changes in `research.md` §5. `owns: backend/routers/admin_students.py, backend/services/student_service.py, backend/models/admin_students.py, backend/routers/instructor.py, backend/routers/auth.py, backend/routers/admin_writing_assignments.py, backend/routers/cohorts.py, backend/routers/admin.py` `depends: T002`
- [ ] T004 Add PostgreSQL and route tests. `owns: backend/tests/test_migration_326_student_archive.py, backend/tests/test_admin_students_archive.py` `depends: T002, T003`
- [ ] T005 Admin UI archive/restore and archived filter; retire the legacy delete confirm. `owns: frontend/app/(authed-admin-students)/admin/students/` `depends: T003`
- [ ] T006 [P] Update `backend/migrations/README.md` (highest/next, 326 paragraph). `owns: backend/migrations/README.md`
- [ ] T007 Run production read-only checks P1–P6 (`research.md` §6) — chờ anh Vinh cho phép chạy chỉ đọc.
- [ ] T008 Apply 326 on staging, deploy backend and UI, run AC-1…AC-14. `depends: T002, T003, T004, T005, T006`
- [ ] T009 Apply 326 on production under explicit authorization. `depends: T007, T008`
- [ ] T010 Phase 2: separate spec for an explicit GDPR erase of archived learners. `depends: T009`
