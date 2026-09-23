# Tasks

Tasks are dependency ordered. The approved specification is on the
implementation branch base (`0aad1f0f`).

- [x] T001 Establish additive exam-content, Mock exam-list, and Writing queue response contracts plus generated frontend types. `owns: backend/models/admin_writing_queue.py, backend/routers/admin_exam_content.py, backend/routers/admin_mock_exams.py, backend/routers/admin_writing.py, frontend/types/api.d.ts`
- [x] T002 Add backend-only Writing pagination, row-backed Review eligibility, and bounded content-catalog routines plus canonical service queries. `depends: T001; owns: backend/migrations/297_admin_writing_queue_page.sql, backend/migrations/298_admin_mock_review_eligibility.sql, backend/migrations/299_admin_exam_content_page.sql, backend/migrations/300_admin_writing_queue_page_snapshot.sql, backend/services/essay_service.py, backend/services/exam_content_service.py, backend/services/mock_exam_service.py`
- [x] T003 Separate Manage, Create, and Content Bank workspaces and make Live, Review, and Writing task scope truthful. `depends: T001; owns: frontend/app/(authed-admin-mock-*)/admin/`
- [x] T004 Implement bounded content/queue controls, canonical readback, and query-context round trips. `depends: T001,T002,T003; owns: frontend/lib/admin-*-model.mjs, frontend/public/css/admin-*-next.css`
- [x] T005 Add requirement-linked backend, frontend contract, and fixture-backed browser coverage; run TypeScript and production build. `depends: T002,T004`
- [ ] T006 Apply and verify migrations 297–300 on staging and production, complete independent review and exact-SHA staging evidence, then promote through the staging-first flow. `depends: T005`
