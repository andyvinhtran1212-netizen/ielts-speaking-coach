# Tasks

- [x] T001 Approve ASSIGNDRAFT-0027 on `staging` before implementation (approved by Vinh 2026-10-27 07:14 UTC+7; this spec PR).
- [x] T002 Write `backend/migrations/324_writing_drafts_assignment_fk_no_action.sql` per `research.md` §5. `owns: backend/migrations/324_writing_drafts_assignment_fk_no_action.sql` `depends: T001`
- [x] T003 [P] Map 23503 on the final DELETE in `delete_unstarted_assignment` to 409 `ASSIGNMENT_STARTED_DETAIL`. `owns: backend/services/writing_assignment_delete_guard.py, backend/tests/test_writing_assignment_delete_guard.py` `depends: T001`
- [x] T004 Add static and PostgreSQL tests for 324, including the single-statement student delete. `owns: backend/tests/test_migration_324_writing_drafts_fk.py` `depends: T002`
- [x] T005 Update `backend/migrations/README.md` (highest/next, 324 paragraph). `depends: T002`
- [ ] T006 Run production read-only checks P1–P5 (`research.md` §7) — chờ anh Vinh cho phép chạy chỉ đọc.
- [ ] T007 Apply 324 on staging with the locked runner and run AC-1…AC-8. `depends: T002, T003, T004, T005`
- [ ] T008 Apply 324 on production under explicit authorization. `depends: T006, T007`
