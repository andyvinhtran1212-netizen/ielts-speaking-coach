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
- Full backend suite, `REQUIRE_PG=1`, local PostgreSQL 17.11 with the same
  local integration URL settings as CI:
  `pytest tests/ -q --tb=short` reports **14,694 passed, 46 skipped,
  28 errors** in 1,044.36 seconds. All 28 errors are the shared invariant
  fixture failure below; there are no other test failures. The 46 skipped
  cases are not acceptance evidence. Full log:
  `/workspace/cc-jobs/job-q-1kf-j131r-rls-admin-mig344.log.d/backend-full-pg17.result`.
  No assertion, skip, timeout or CI check was weakened. No push/PR while the
  required local invariant remains red; the proposed PR body is retained
  outside the patch in the same log directory as `pr-body.md`.
- Blocking regression check: with `REQUIRE_PG=1`,
  `pytest tests/test_client_write_invariant_postgres.py -q --tb=short`
  reports **2 passed, 28 errors**. Every error originates from the shared
  `chain` fixture applying 344: `rls344_rls_disabled: access_codes`.
  `_pre_320()` in that file creates `access_codes` without RLS and omits
  other 344 prerequisite tables/helpers. The migration correctly aborts;
  making it skip missing/unguarded tables would violate FR-003/FR-004.
  Minimal proposed follow-up: extend only that fixture to include the
  pre-344 table/RLS/helper shape, keeping all assertions intact, then rerun
  the invariant and full backend suite on PG16 and PG17. This job is
  explicitly forbidden to edit that test file, so it remains unchanged.
- No hosted database was contacted. Staging apply/catalog comparison, real
  test JWT probes, Next-native and Staging E2E remain T003/T004 release work.

## UI evidence

- N/A (`ui-states.md`).

## Release evidence

- Pending T002 (PC-J131), T003 (staging apply) and T005 (production at
  promotion).
