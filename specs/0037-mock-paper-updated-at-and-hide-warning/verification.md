# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_338_paper_updated_at_triggers.py (visibility RPC, raw update, explicit stale value and child-table updates advance updated_at; insert keeps its value) plus the staging visibility probe; ci=Tests run 40784593322 on staging `56a8c344f`, 29 passed, 0 skipped; the staging visibility probe is not run | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_338_paper_updated_at_triggers.py (policy_revision, release event and mock_content_revision unchanged in behaviour; guard refusal still aborts; guards fire first) plus test_mock_paper_policy_postgres.py and test_mock_private_draft_postgres.py; ci=Tests run 40784593322 on staging `56a8c344f`: 29 passed, test_mock_paper_policy_postgres.py 50 passed, test_mock_private_draft_postgres.py 13 passed, 0 skipped | PASS |
| FR-003 | kind=test; ref=backend/tests/test_migration_338_paper_updated_at_triggers.py (static contract, double apply, precondition and postcondition failures) plus the staging catalog query; ci=Tests run 40784593322 on staging `56a8c344f`, 29 passed; staging catalog query returns 5 triggers enabled O on 2026-10-29 06:15 UTC+7 (/workspace/qa/pcj60/postchecks.out.json) | PASS |
| FR-004 | kind=test; ref=frontend/tests/react/mock-public-source-hide-warning.test.tsx (public source warns, private/empty/Writing do not); ci=Tests run 40784593322 on staging `56a8c344f`, 2 passed | PASS |
| FR-005 | kind=test; ref=frontend/tests/react/mock-private-draft-create.test.tsx (payload unchanged) and backend/tests/test_migration_338_paper_updated_at_triggers.py (copy still hides the source); ci=Tests run 40784593322 on staging `56a8c344f`: mock-private-draft-create.test.tsx 2 passed, test_migration_338_paper_updated_at_triggers.py 29 passed | PASS |
| FR-006 | kind=test; ref=backend/tests/test_migration_338_paper_updated_at_triggers.py (`test_package_status_transition_with_real_306_advances_timestamp_and_policy[status-update]`, `[package-publish-rpc]`, from PC-J242 commit c541cb9be) plus a 353 migration test; not implemented yet | PENDING |

## Contract evidence

- OpenAPI/type drift: none; FastAPI is unchanged.
- Database: UPDATE on the five tables now returns an advanced `updated_at`.

## Data evidence

- Migration writes no row. Staging catalog query after apply (read-only,
  2026-10-29 06:15 UTC+7): 5 rows (`listening_content`, `listening_tests`,
  `reading_passages`, `reading_questions`, `reading_tests`), all
  `tgenabled = 'O'` (`/workspace/qa/pcj60/postchecks.out.json`).

## UI evidence

- React test for the warning (2 passed in CI run 40784593322); staging check
  and the Content Manager wording review (T006) pending.

## Release evidence

- Staging SHA and checks (reconciled 2026-10-29): #1877 merged as
  `c0593213db019c7f3ec6758a77bdc4f4c54c5c10` (2026-10-29 02:15 UTC+7). Ledger:
  `338_reading_listening_paper_updated_at.sql` applied 2026-10-28 19:44:25Z
  (2026-10-29 02:44:25 UTC+7) (`/workspace/qa/pcj60/ledger.out.tsv`). Staging
  `56a8c344f` contains #1877: Tests run 40784593322 and Staging release smoke
  run 40784593282 are green. Pending: the visibility-toggle probe (T005).
- Production verification: pending T007. 338 is not on `main` yet.
