# Tasks

- [x] T001 Audit public table grants, write policies and every client write path. owns: audit notes in the PR.
- [x] T002 Write migration 320 with postcondition and rollback note. depends: T001. owns: backend/migrations/320_client_write_privilege_lockdown.sql, backend/migrations/README.md.
- [x] T003 Add static and PostgreSQL tests. depends: T002. owns: backend/tests/test_migration_320_client_write_lockdown.py.
- [ ] T004 Owner approves this spec on `staging`. depends: T001.
- [ ] T005 Apply 320 to staging, run the verification query and replay the three exploits. depends: T004.
- [ ] T006 Verify learner Vocabulary/D1, profile, activation and admin role journeys on staging at the merged SHA. depends: T005.
- [ ] T007 Apply 320 to production with the locked runner under explicit authorization and repeat the verification query. depends: T006.
