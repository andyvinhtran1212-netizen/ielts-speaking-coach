# Tasks

- [x] T001 Approve CODEUNIQ-0028 on `staging` before implementation (approved by Vinh 2026-10-27 07:14 UTC+7; this spec PR).
- [ ] T002 Write `backend/migrations/325_access_codes_code_unique_canonical.sql` per `research.md` §5. `owns: backend/migrations/325_access_codes_code_unique_canonical.sql` `depends: T001`
- [ ] T003 [P] Use the #1733 collision-safe insert in instructor `mint_codes`. `owns: backend/routers/instructor.py, backend/tests/test_access_code_generation.py` `depends: T001`
- [ ] T004 Add static and PostgreSQL tests for 325. `owns: backend/tests/test_migration_325_access_codes_unique.py` `depends: T002`
- [ ] T005 Update `backend/migrations/README.md` (highest/next, 325 paragraph, drift note). `depends: T002`
- [ ] T006 Run production read-only checks P1–P6 (`research.md` §8) — chờ anh Vinh cho phép chạy chỉ đọc; if duplicates exist, prepare the dedupe of `research.md` §6 for separate review.
- [ ] T007 Apply 325 on staging with the runner and run AC-1…AC-8. `depends: T002, T003, T004, T005`
- [ ] T008 Apply 325 on production under explicit authorization. `depends: T006, T007`
