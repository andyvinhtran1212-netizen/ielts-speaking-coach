# Tasks

- [x] T001 Approve ROLECHECK-0026 on `staging` before implementation (approved by Vinh 2026-10-27 07:14 UTC+7; this spec PR).
- [x] T002 Write `backend/migrations/323_users_role_single_check.sql` per `research.md` §6.2. `owns: backend/migrations/323_users_role_single_check.sql` `depends: T001`
- [x] T003 Update `backend/migrations/README.md` (highest/next, 323 paragraph, replace the "`users_role_check` is intentionally untouched" note). `depends: T002`
- [x] T004 Add static and PostgreSQL tests for 323. `owns: backend/tests/test_migration_323_users_role_single_check.py` `depends: T002`
- [x] T005 [P] Correct the stale comment in `backend/scripts/staging_seed.py` (lines 14, 109-112). `owns: backend/scripts/staging_seed.py`
- [x] T006 Run production read-only checks P1–P6 (done 2026-10-27 ~07:19 UTC+7 with Vinh's permission; no drift; `research.md` §5.2).
- [x] T007 Apply 323 on staging with the locked runner and run AC-1…AC-14. `depends: T002, T003, T004`
  - Reconciled 2026-10-29 under PC #55 approval: migration already present in the staging ledger since 2026-10-27; live acceptance and isolated-fixture cleanup completed. [Staging evidence, row counts and runner transport limitation](../../docs/verification/2026-10-29-admin-t007-0026-0028-staging.md). No migration replay or production action.
- [ ] T008 Apply 323 on production under explicit authorization, re-run P1/P4/P5 immediately before and P1/P3 after, then one real instructor promotion chosen by Vinh. `depends: T007`
  - Done 2026-10-27 under Vinh's authorization (16:32–16:33 UTC+7), promotion PR #1763 (`staging` → `main`), merge commit `c9d564dfeac2df42611dcd308aaad1a2e970c580`, merged 2026-10-27 17:09 UTC+7: P1/P4/P5 re-run at 17:07, 323 applied at 17:07:40 (ledger `applied_at` 10:07:42 UTC), P1/P3 after apply match (`verification.md` Release evidence).
  - Pending — owner account decision: the real instructor promotion of an account Vinh names has not been run. The box stays open until it is.
