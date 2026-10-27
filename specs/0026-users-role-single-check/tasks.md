# Tasks

- [x] T001 Approve ROLECHECK-0026 on `staging` before implementation (approved by Vinh 2026-10-27 07:14 UTC+7; this spec PR).
- [ ] T002 Write `backend/migrations/323_users_role_single_check.sql` per `research.md` §6.2. `owns: backend/migrations/323_users_role_single_check.sql` `depends: T001`
- [ ] T003 Update `backend/migrations/README.md` (highest/next, 323 paragraph, replace the "`users_role_check` is intentionally untouched" note). `depends: T002`
- [ ] T004 Add static and PostgreSQL tests for 323. `owns: backend/tests/test_migration_323_users_role_single_check.py` `depends: T002`
- [ ] T005 [P] Correct the stale comment in `backend/scripts/staging_seed.py` (lines 14, 109-112). `owns: backend/scripts/staging_seed.py`
- [x] T006 Run production read-only checks P1–P6 (done 2026-10-27 ~07:19 UTC+7 with Vinh's permission; no drift; `research.md` §5.2).
- [ ] T007 Apply 323 on staging with the locked runner and run AC-1…AC-14. `depends: T002, T003, T004`
- [ ] T008 Apply 323 on production under explicit authorization, re-run P1/P4/P5 immediately before and P1/P3 after, then one real instructor promotion chosen by Vinh. `depends: T007`
