# Tasks

- [x] T001 Approve CODEUNIQ-0028 on `staging` before implementation (approved by Vinh 2026-10-27 07:14 UTC+7; this spec PR).
- [x] T002 Write `backend/migrations/325_access_codes_code_unique_canonical.sql` per `research.md` §5. `owns: backend/migrations/325_access_codes_code_unique_canonical.sql` `depends: T001`
- [x] T003 [P] Use the #1733 collision-safe insert in instructor `mint_codes`. `owns: backend/routers/instructor.py, backend/tests/test_access_code_generation.py` `depends: T001`
- [x] T004 Add static and PostgreSQL tests for 325. `owns: backend/tests/test_migration_325_access_codes_unique.py` `depends: T002`
- [x] T005 Update `backend/migrations/README.md` (highest/next, 325 paragraph, drift note). `depends: T002`
- [x] T006 Run production read-only checks P1–P6 (`research.md` §8); if duplicates exist, prepare the dedupe of `research.md` §6 for separate review.
  - Done 2026-10-27 17:08 UTC+7 under Vinh's authorization, immediately before the apply: 110 codes, every duplicate/non-canonical counter 0. P5 and the dedupe were not needed. `access_codes_code_key` already existed (validated); 325 not in ledger (`verification.md` Release evidence).
- [ ] T007 Apply 325 on staging with the runner and run AC-1…AC-8. `depends: T002, T003, T004, T005`
  - Still open: the 2026-10-27 production release record covers only CI and the release smoke of the promoted staging SHA `c028ed21c910f469d36abfa0907e3fd71d363709`; it does not record this staging apply or its AC run.
- [x] T008 Apply 325 on production under explicit authorization. `depends: T006, T007`
  - Done 2026-10-27 17:08:13–17:08:22 UTC+7 as 325a/325b/325c (ledger `applied_at` 10:08:24 UTC), promotion PR #1763 (`staging` → `main`), merge commit `c9d564dfeac2df42611dcd308aaad1a2e970c580`, merged 2026-10-27 17:09 UTC+7. Post-apply: unique index valid, canonical CHECK validated, counters still 0.
