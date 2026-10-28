# Tasks

- [x] T001 Owner (Vinh) approves this spec; the approval change lands on `staging` (Vinh, 2026-10-27 07:14, `approval-decision.md`).
- [ ] T002 #1727 cites `WRITINGRATE-0025` with change class `high-risk` and per-FR requirement coverage; CI and spec governance green. `depends: T001; owns: backend/migrations/321_writing_grade_ratings_feedback_version.sql, backend/migrations/README.md, backend/tests/test_migration_321_writing_grade_ratings_feedback_version.py`
- [ ] T003 Apply 321 to staging with the advisory-locked runner (dry run first); run the read-only shape queries; rate a graded essay on the staging admin grade page and reload; merge #1727. `depends: T002`
- [ ] T004 Apply 321 to production with the advisory-locked runner at release, before or with the staging → main promotion; run the read-only shape queries. `depends: T003`
- [ ] T005 Record evidence in `verification.md` and move status forward. `depends: T004`
