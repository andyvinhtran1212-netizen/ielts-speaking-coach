# Tasks

- [ ] T001 Migration 509 with rollback and ledger rows. `owns: backend/migrations/509_course_give_request_unique.sql, backend/migrations/rollback/509_course_give_request_unique.sql, backend/migrations/register.tsv, backend/migrations/forward-policy.tsv, backend/migrations/README.md`
- [ ] T002 Backend re-give, catalog fields, request-id replay and race catch. `depends: T001` `owns: backend/routers/admin_class_assignments.py`
- [ ] T003 Homework editor enablement, date label, note and stable request id. `depends: T002` `owns: frontend/lib/admin-class-homework-model.mjs, frontend/app/(authed-admin)/(classes)/admin/classes/[cohortId]/`
- [ ] T004 Tests, staging apply and staging journey. `depends: T001, T002, T003`
