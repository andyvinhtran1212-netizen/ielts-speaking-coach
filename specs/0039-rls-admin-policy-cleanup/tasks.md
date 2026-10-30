# Tasks

- [x] T001 Read-only staging catalog check of the 29 + 3 policies, the 21 tables' grants, `relrowsecurity` and the `service_role` ACL baseline; result in `research.md`. `owns: specs/0039-rls-admin-policy-cleanup/*, specs/README.md`
  Done in PC-J130 on 2026-10-29 11:23Z (18:23 UTC+7), staging `zjphffoujxkpltixsbzj`, read-only: live list equals the spec (29 policies on 21 tables, 3 BL-11 policies, no table outside the 21).
- [ ] T002 Write migration 344, its PostgreSQL 16/17 test with a fixture that replays the 29 + 3 policies, the README note and the forward-policy entry (PC-J131, starts after this spec PR merges). `owns: backend/migrations/344_rls_admin_policy_cleanup.sql, backend/tests/test_migration_344_rls_policy_cleanup.py, backend/migrations/README.md, backend/migrations/forward-policy.tsv` `depends: T001`
- [ ] T003 Staging: the Leader applies 344 under the advisory lock, then re-runs the T001 queries read-only and diffs the `service_role` ACL against the T001 baseline. `depends: T002`
- [ ] T004 Security Auditor re-checks the 21 tables on staging with a test learner JWT and a test instructor JWT: no read, no write. `depends: T003`
- [ ] T005 Production, with the owner's explicit authorization at the `staging` → `main` promotion: apply 344 under the advisory lock, then run the catalog postconditions read-only. `depends: T004`
