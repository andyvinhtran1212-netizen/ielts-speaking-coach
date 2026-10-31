# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_344_rls_policy_cleanup.py (0 helper-calling policies, BL-11 gone, other policies unchanged) plus the T003 staging catalog query | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_344_rls_policy_cleanup.py (no anon/authenticated privilege on the 21 tables, learner/instructor JWT refused) plus the T003 catalog query and the T004 Security Auditor probe | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_344_rls_policy_cleanup.py (no GRANT, RLS on, service_role ACL byte-identical, helpers unchanged) plus the T003 relacl diff against the T001 baseline in research.md | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_migration_344_rls_policy_cleanup.py (static contract, double apply, precondition and postcondition failures, down script never grants) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_client_write_invariant_postgres.py plus the full backend suite, Next-native verifiers and Staging E2E on the staging SHA that contains 344 | PENDING |

## Contract evidence

- OpenAPI/type drift: none expected; FastAPI is unchanged.
- Database: T001 baseline recorded in `research.md` (2026-10-29 11:23Z,
  staging, read-only).

## Data evidence

- Migration writes no row. Pending T003.

## Offline implementation evidence (PC-J131R, 2026-10-31)

- Base: post-R2 `origin/staging` / PR #2103, commit
  `28fd53ddd8ca8c433eb2978be83eb60fbe86632e`. Spec present, STAGING_FREEZE
  absent, and no 344 file on the fetched remote branches or open PRs at start.
- The 32 original CREATE POLICY definitions match T001's 29 helper policies
  plus 3 BL-11 policies on exactly 21 tables. The down script copies those
  definitions, schema-qualifying only the target relation. Neither script
  grants privileges; the down script requires explicit opt-in and refuses
  open client table/column privileges or helper EXECUTE.
- The fixture replays the original 32 policies and seven retained learner
  read policies as a NOSUPERUSER table owner, with RLS enabled and the T001
  non-uniform service-role ACL (no TRUNCATE on `class_action_log`). It checks
  exact policy/ACL/row preservation, double apply, actual 345 before 344,
  old write-grant removal, PG17 MAINTAIN, learner/instructor claim probes,
  atomic failures and policy-only rollback. It also checks catalog ACLs
  after rollback rather than relying on a text search for grants alone.
- PostgreSQL 17 is installed locally; PostgreSQL 16 is unavailable. The test
  file is portable to both versions, but PG16 execution is still pending.
- On PostgreSQL 17.11, `REQUIRE_PG=1`, the 344 tests plus the existing 320,
  345 and forward-policy suites report **112 passed** (no skips). The 344
  file contributes 23 cases. Logs remain outside the patch under the PC-J131R
  job log directory.
- Historical full backend result before the authorized fixture repair:
  **14,694 passed, 46 skipped, 28 errors** in 1,044.36 seconds. All 28
  errors came from the PC-J94 shared fixture failing 344's preconditions;
  first error: `rls344_rls_disabled: access_codes`. This historical result
  does not describe the repaired head.
- Leader authorized `_pre_320()` fixture bring-up on 2026-10-31 and then
  `_pre_320_history()` RLS setup at 04:25 UTC+7. No assertion, invariant,
  skip, timeout or CI check changed. An AST comparison confirms every
  assertion and all code outside these two functions remain identical.
- Fixture additions, using the original migration CREATE definitions:
  `writing_prompts` (035), `error_logs` (061), `writing_tips` (082),
  `essay_regrade_requests` (084), `mock_exams` (145, the FK parent needed by
  154), `mock_exam_assignments` (154), `courses` (175), `class_lessons` (176),
  `speaking_lesson_sets` and `speaking_lesson_set_questions` (183),
  `speaking_progress_marks` (185), and `class_action_log` (198).
  The two helpers are `is_current_user_admin()` (033) and
  `is_current_user_instructor()` (106), with the original 108 client EXECUTE
  revokes. RLS is enabled on these tables and on existing `access_codes`,
  `cohorts`, `students`, `writing_assignments`, `writing_drafts`,
  `writing_essays`, `writing_feedback`, `class_assignments` and
  `class_assignment_items`. History setup enables RLS on the existing
  `writing_assignment_requests` immediately after creating it; it is not
  created twice.
- Resume base: preserved `6435665c1` and `c4607afea`, then normally merged
  staging `b565663013f705e4a1e282ae7cb60d033de3531a` without conflicts.
- Repaired fixture plus migration 344 tests, local PG17.11, `REQUIRE_PG=1`:
  **53 passed, 0 skipped** (30 invariant + 23 migration cases), 29.51 seconds.
  Command: `pytest tests/test_client_write_invariant_postgres.py
  tests/test_migration_344_rls_policy_cleanup.py -q --tb=short`.
  Evidence: `/workspace/cc-jobs/job-q-cx-1m9-resume-1m0-j131r-pre320-history-rls.log.d/invariant-pg17.result`.
- First repaired full PG17.11 run: **15,128 passed, 46 skipped, 1 failed**
  in 1,263.86 seconds. The 28 original fixture errors are gone. The sole
  failure was an unchanged 10-second `psql` subprocess wait in
  `test_mock_attempt_flags_postgres.py::test_overlapping_clients_preserve_other_questions_and_conflict_same_question[True]`.
  Its entire unchanged module passed on a fresh cluster: **11 passed** in
  21.77 seconds. No timeout or assertion was altered. The failure is retained
  in `backend-full-pg17.result`; the module rerun is `mock-flags-recheck.result`
  in this resume job's log directory. It is not counted as a passing full run.
- Second full PG17.11 run: **15,128 passed, 46 skipped, 1 failed** in
  1,354.55 seconds. The first run's failing test passed unchanged. This run
  hit a different loopback PostgreSQL connection timeout in
  `test_migration_337_class_archive.py::test_light_rollback_keeps_the_old_backend_working_then_337_reapplies`
  (`psql: connection ... timeout expired`, at the restore call).
  Evidence: `backend-full-pg17-recheck.result` in the resume job directory.
  All non-skipped cases passed in at least one full run; neither full run is
  claimed green. The entire unchanged 337 module passed on a fresh cluster:
  **38 passed** in 45.81 seconds (`migration337-recheck.result`). No assertion,
  timeout or CI check was changed to obtain either module recheck. PostgreSQL
  16 is unavailable locally; CI must provide its result.
- No hosted database was contacted. Staging apply/catalog comparison, real
  test JWT probes, Next-native and Staging E2E remain T003/T004 release work.

## UI evidence

- N/A (`ui-states.md`).

## Release evidence

- T002 implementation is prepared with the local results above; exact-head CI
  and PG16 verification remain required. Neither full local PG17 invocation
  was clean. T003/T004 staging acceptance and T005 production at promotion
  remain pending, with separate authorization.
