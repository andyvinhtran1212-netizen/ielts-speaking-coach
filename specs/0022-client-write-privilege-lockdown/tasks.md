# Tasks

- [x] T001 Audit public table grants, write policies and every client write path. owns: audit notes in the PR.
- [x] T002 Write migration 320 with postcondition and rollback note. depends: T001. owns: backend/migrations/320_client_write_privilege_lockdown.sql, backend/migrations/README.md.
- [x] T003 Add static and PostgreSQL tests. depends: T002. owns: backend/tests/test_migration_320_client_write_lockdown.py.
- [x] T008 Address the Project Coordinator review: F14 definer EXECUTE, FOR ROLE default privileges, users policy WITH CHECK and no client grant, D1 results server-written, Speaking admission re-check. depends: T003. owns: backend/migrations/320_client_write_privilege_lockdown.sql, backend/routers/{sessions,questions,grading,pronunciation,exercises}.py, backend/tests/test_speaking_entitlement_guard.py, backend/tests/test_d1_session.py.
- [ ] T004 Owner approves this spec on `staging`. depends: T001.
- [ ] T005 Run the rollout pre-checks, apply 320 to staging, promote its backend, run the verification queries and replay the exploits. depends: T004.
- [ ] T006 Verify learner Speaking (generate → grading → pronunciation), Vocabulary/flashcard/D1, profile, activation and admin role journeys on staging at the merged SHA. depends: T005.
- [ ] T007 Apply 320 to production with the locked runner under explicit authorization together with the promotion and repeat the verification queries. depends: T006.
