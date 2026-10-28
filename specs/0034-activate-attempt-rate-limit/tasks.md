# Tasks

- [x] T001 Owner approves ACTIVATELIMIT-0034 and its Decisions (approved by Vinh on 2026-10-28, `approval-decision.md`); migration number 334 locked by the Leader. `owns: specs/0034-activate-attempt-rate-limit/*, specs/README.md`
- [ ] T002 Write migration 334 and the README note. `owns: backend/migrations/334_activate_attempt_rate_limit.sql, backend/migrations/README.md` `depends: T001`
- [ ] T003 Static and PostgreSQL tests for 334 on PostgreSQL 16 and 17. `owns: backend/tests/test_migration_334_activate_attempt_rate_limit.py` `depends: T002`
- [ ] T004 Backend: `_rate_limit_activate` calls the RPC (429/503), in-memory dict removed, conftest seam, AC1–AC5 tests. `owns: backend/routers/auth.py, backend/tests/conftest.py, backend/tests/test_activate_rate_limit.py, backend/tests/test_admin_students_archive.py` `depends: T002`
- [ ] T005 Frontend `/login` reads `error_code`. `owns: frontend/lib/login-model.mjs, frontend/app/(public-auth)/login/login-behavior.tsx, frontend/tests/login-next-model.test.mjs, frontend/tests/login-next-behavior.test.mjs` `depends: T001`
- [ ] T006 Staging: dry run (BEGIN; 334; postchecks; ROLLBACK), then apply 334 under `pg_advisory_lock(173204,1)`, run the header postcheck, deploy the backend, run the 11-attempt QA probe. `depends: T003, T004, T005`
- [ ] T007 Production, with the owner's explicit authorization at the `staging` → `main` promotion: apply 334 under the advisory lock before the backend is promoted; run the postcheck read-only. `depends: T006`
