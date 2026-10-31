# Tasks

- [x] T001 Read-only staging catalog check of the 29 + 3 policies, the 21 tables' grants, `relrowsecurity` and the `service_role` ACL baseline; result in `research.md`. `owns: specs/0039-rls-admin-policy-cleanup/*, specs/README.md`
  Done in PC-J130 on 2026-10-29 11:23Z (18:23 UTC+7), staging `zjphffoujxkpltixsbzj`, read-only: live list equals the spec (29 policies on 21 tables, 3 BL-11 policies, no table outside the 21).
- [x] T002 Write migration 344, its PostgreSQL 16/17 test with a fixture that replays the 29 + 3 policies, the README note and the forward-policy entry (PC-J131, starts after this spec PR merges). `owns: backend/migrations/344_rls_admin_policy_cleanup.sql, backend/migrations/rollback/344_rls_admin_policy_cleanup.sql, backend/tests/test_migration_344_rls_policy_cleanup.py, backend/tests/test_client_write_invariant_postgres.py, backend/migrations/README.md, backend/migrations/forward-policy.tsv` `depends: T001`
  PC-J131R migration, guarded down script, portable PG16/17 tests and release
  metadata are prepared. Leader authorized historical fixture setup in
  `_pre_320()` and `_pre_320_history()` on 2026-10-31; every assertion and all
  code outside these two functions are unchanged. PG17.11 focused verification:
  53 passed (30 invariant + 23 migration), zero skipped. Two full PG17 runs each
  had 15,128 passed / 46 skipped / one different local PostgreSQL timeout;
  both affected unchanged modules pass separately (11 and 38 passed). Every
  non-skipped case passed in at least one full run; neither invocation was
  clean. Exact-head CI, including PG16 (unavailable locally), remains required.
  See `verification.md`; staging and production acceptance are separate work.
- [ ] T003 Staging: the Leader applies 344 under the advisory lock, then re-runs the T001 queries read-only and diffs the `service_role` ACL against the T001 baseline. `depends: T002`
- [ ] T004 Security Auditor re-checks the 21 tables on staging with a test learner JWT and a test instructor JWT: no read, no write. `depends: T003`
- [ ] T005 Production, with the owner's explicit authorization at the `staging` → `main` promotion: apply 344 under the advisory lock, then run the catalog postconditions read-only. `depends: T004`
