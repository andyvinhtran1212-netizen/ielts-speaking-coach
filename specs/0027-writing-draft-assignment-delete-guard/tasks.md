# Tasks

- [x] T001 Approve ASSIGNDRAFT-0027 on `staging` before implementation (approved by Vinh 2026-10-27 07:14 UTC+7; this spec PR).
- [x] T002 Write `backend/migrations/324_writing_drafts_assignment_fk_no_action.sql` per `research.md` §5. `owns: backend/migrations/324_writing_drafts_assignment_fk_no_action.sql` `depends: T001`
- [x] T003 [P] Map 23503 on the final DELETE in `delete_unstarted_assignment` to 409 `ASSIGNMENT_STARTED_DETAIL`. `owns: backend/services/writing_assignment_delete_guard.py, backend/tests/test_writing_assignment_delete_guard.py` `depends: T001`
- [x] T004 Add static and PostgreSQL tests for 324, including the single-statement student delete. `owns: backend/tests/test_migration_324_writing_drafts_fk.py` `depends: T002`
- [x] T005 Update `backend/migrations/README.md` (highest/next, 324 paragraph). `depends: T002`
- [x] T006 Run production read-only checks P1–P5 (`research.md` §7).
  - Done 2026-10-27 17:07 UTC+7 under Vinh's authorization, immediately before the apply, with the same result as the earlier 15:43 read. FK `c`/validated, 0 orphan drafts, 572 assignments / 4 drafts, draft triggers enabled, 324 not in ledger (`verification.md` Release evidence).
- [ ] T007 Apply 324 on staging with the locked runner and run AC-1…AC-8. `depends: T002, T003, T004, T005`
  - Still open: the 2026-10-27 production release record covers only CI and the release smoke of the promoted staging SHA `c028ed21c910f469d36abfa0907e3fd71d363709`; it does not record this staging apply or its AC run.
- [x] T008 Apply 324 on production under explicit authorization. `depends: T006, T007`
  - Done 2026-10-27 17:07:56 UTC+7 (ledger `applied_at` 10:07:58 UTC), promotion PR #1763 (`staging` → `main`), merge commit `c9d564dfeac2df42611dcd308aaad1a2e970c580`, merged 2026-10-27 17:09 UTC+7. Post-apply: FK `a`/validated, 0 cascading children, counts unchanged.
- [ ] T009 Revision 1: set `ASSIGNMENT_STARTED_DETAIL` to "Học viên đã bắt đầu làm bài nên không xóa được bài giao này." and update its pins. `owns: backend/services/writing_assignment_delete_guard.py, backend/tests/test_writing_assignment_delete_guard.py, frontend/tooling/verify-admin-writing-assignments-flow.mjs, backend/migrations/README.md` `depends: T001`
