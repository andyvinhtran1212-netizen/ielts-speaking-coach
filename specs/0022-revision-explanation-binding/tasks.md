# Tasks

- [x] T001 Land this spec, with the owner's approval recorded, on staging.
- [x] T002 Map the reason codes to Vietnamese messages in class-give and admin approval; block 0-object papers in the homework form. Shipped in #1689 (`2c49f4c`), production via #1695. `owns: backend/services/mock_correction_service.py, backend/services/class_assignment_service.py, frontend/lib/admin-class-homework-model.mjs`
- [x] T003 Re-target #1692 to REVEXPLAIN-0022 as `high-risk`; reconcile migration number and `backend/migrations/README.md` with in-flight migrations. `depends: T001; owns: backend/migrations/319_explanation_version_unavailable_reason.sql, backend/migrations/README.md`
- [x] T004 Keep the binder and its tests green on the current staging base. `depends: T003; owns: backend/scripts/bind_revision_web_explanations.py, backend/tests/test_bind_revision_web_explanations.py, backend/tests/test_explanation_version_reason_postgres.py`
- [x] T005 Apply migration 319 to staging with the locked runner; verify reasons on staging; merge #1692. `depends: T004`
- [x] T006 Apply migration 319 to production with the locked runner; promote; verify a named refusal and an approved give. 319 applied 2026-10-26 04:53Z; refusal/approval verified with rolled-back calls. Code promoted by #1708 (staging `a366174`, all integrated checks green after one smoke re-run) as main merge `f9faf0a`; production runtime-config release marker read `f9faf0a031f15e3f3dbc14721130a8129bd4fdb9` at 05:16Z and `/health/grammar-check` stayed healthy. `depends: T005`
- [x] T007 Owner-approved one-off binding of C19T1 REV01 Reading and Listening (staging rehearsal, production commit, read-back, Course 5 give). Recorded 2026-10-25. `depends: T002`
- [ ] T008 For any further REV paper: owner review of changed questions, staging rehearsal, production commit, read-back. On request only. `depends: T006`
