# Tasks

- [x] T001 Owner approves PAPERUPDATEDAT-0037 (Vinh, 2026-10-28 21:33, `approval-decision.md`); migration number 338 chosen after checking open PRs and queued jobs. `owns: specs/0037-mock-paper-updated-at-and-hide-warning/*, specs/README.md`
- [x] T002 Write migration 338 and the README note. `owns: backend/migrations/338_reading_listening_paper_updated_at.sql, backend/migrations/README.md` `depends: T001`
  Done in #1877 (merge `c0593213db019c7f3ec6758a77bdc4f4c54c5c10`, 2026-10-29 02:15 UTC+7; spec #1876 `8c6527f14`): `338_reading_listening_paper_updated_at.sql` and the README note.
- [x] T003 Static and PostgreSQL tests for 338. `owns: backend/tests/test_migration_338_paper_updated_at_triggers.py` `depends: T002`
  Done in #1877 (merge `c0593213db019c7f3ec6758a77bdc4f4c54c5c10`, 2026-10-29 02:15 UTC+7; spec #1876 `8c6527f14`): `test_migration_338_paper_updated_at_triggers.py`, 29 passed, 0 skipped on PostgreSQL 16 in CI run 40784593322 (staging `56a8c344f`); 29 passed on PostgreSQL 17.11 per the #1877 body.
- [x] T004 Mock Test create-form warning and its test. `owns: frontend/app/(authed-admin-mock-exams)/admin/mock-exams/exam-create-form.tsx, frontend/public/css/admin-mock-exams-next.css, frontend/tests/react/mock-public-source-hide-warning.test.tsx` `depends: T001`
  Done in #1877 (merge `c0593213db019c7f3ec6758a77bdc4f4c54c5c10`, 2026-10-29 02:15 UTC+7; spec #1876 `8c6527f14`): warning in `exam-create-form.tsx`, CSS, and `mock-public-source-hide-warning.test.tsx` (2 passed in run 40784593322).
- [ ] T005 Staging: the Leader applies 338 under the advisory lock; run the header catalog query and a visibility-toggle probe on a QA paper. `depends: T002, T003`
  Partial. 338 is in the staging ledger at 2026-10-28 19:44:25Z (2026-10-29 02:44:25 UTC+7) (`/workspace/qa/pcj60/ledger.out.tsv`); the tracker row `SEC-UPDATED-AT` records job 14k ran a dry run first and the post-check passed (`/workspace/cc-jobs/handoff/project-coordinator/tracker.tsv`). The header catalog query returns 5 rows, all `tgenabled = 'O'` (2026-10-29 06:15 UTC+7, `/workspace/qa/pcj60/postchecks.out.json`). Still open: the visibility-toggle probe on a QA paper.
- [ ] T006 Content Manager reviews the warning wording. `depends: T004`
  Not done: Content Manager ticket PC-1029-12 has no reply yet.
- [ ] T007 Production, with the owner's explicit authorization at the `staging` → `main` promotion. `depends: T005`
