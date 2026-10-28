# Tasks

- [x] T001 Owner approves PAPERUPDATEDAT-0037 (Vinh, 2026-10-28 21:33, `approval-decision.md`); migration number 338 chosen after checking open PRs and queued jobs. `owns: specs/0037-mock-paper-updated-at-and-hide-warning/*, specs/README.md`
- [ ] T002 Write migration 338 and the README note. `owns: backend/migrations/338_reading_listening_paper_updated_at.sql, backend/migrations/README.md` `depends: T001`
- [ ] T003 Static and PostgreSQL tests for 338. `owns: backend/tests/test_migration_338_paper_updated_at_triggers.py` `depends: T002`
- [ ] T004 Mock Test create-form warning and its test. `owns: frontend/app/(authed-admin-mock-exams)/admin/mock-exams/exam-create-form.tsx, frontend/public/css/admin-mock-exams-next.css, frontend/tests/react/mock-public-source-hide-warning.test.tsx` `depends: T001`
- [ ] T005 Staging: the Leader applies 338 under the advisory lock; run the header catalog query and a visibility-toggle probe on a QA paper. `depends: T002, T003`
- [ ] T006 Content Manager reviews the warning wording. `depends: T004`
- [ ] T007 Production, with the owner's explicit authorization at the `staging` → `main` promotion. `depends: T005`
