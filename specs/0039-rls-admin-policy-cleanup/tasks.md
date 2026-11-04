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
- [x] T003 Staging: the Leader applies 344 under the advisory lock, then re-runs the T001 queries read-only and diffs the `service_role` ACL against the T001 baseline. `depends: T002`
  Application recorded in `/workspace/cc-jobs/migrations-register.md`, section
  "02/11 promote prep": staging 344 at 08:49 UTC+7. Read-only staging ledger
  confirmation on 2026-11-02: `344_rls_admin_policy_cleanup.sql`,
  `applied_at = 2026-11-02T01:49:14.013649Z`. PC-J548's catalog recheck at
  14:15Z (`read_only: true`, `transaction_read_only = on`) found zero
  helper-calling policies, zero BL-11 policies, zero effective client
  table/column privileges, RLS enabled on all 21 tables, eight retained
  policies and unchanged helper ACLs. Against T001's `research.md` baseline,
  20 `service_role` ACL entries are unchanged; `class_action_log` is now
  `service_role=ar/postgres`, matching the later migration 356 revokes
  (staging ledger `applied_at = 2026-11-02T11:47:54.667279Z`). Migration 344
  itself checks before/after service-role ACL equality inside its transaction.
  Queries, raw results and comparison: `/workspace/cc-jobs/job-q-cx-1qk-pc-j548-fdp12.log.d/staging-t003.sql`,
  `staging-t003.result.json`, `staging-acl-followup.result.json` and
  `evidence-summary.json` in that directory. No database writes in PC-J548;
  JWT acceptance and production remain T004/T005.
- [ ] T004 Security Auditor re-checks the 21 tables on staging with a test learner JWT and a test instructor JWT: no read, no write. `depends: T003`
- [ ] T005 Production, with the owner's explicit authorization at the `staging` → `main` promotion: apply 344 under the advisory lock, then run the catalog postconditions read-only. `depends: T004`
