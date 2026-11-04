# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_338_paper_updated_at_triggers.py (visibility RPC, raw update, explicit stale value and child-table updates advance updated_at; insert keeps its value) plus the staging visibility probe; ci=Tests run 40784593322 on staging `56a8c344f`, 29 passed, 0 skipped; the staging visibility probe is not run | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_338_paper_updated_at_triggers.py (policy_revision, release event and mock_content_revision unchanged in behaviour; guard refusal still aborts; guards fire first) plus test_mock_paper_policy_postgres.py and test_mock_private_draft_postgres.py; ci=Tests run 40784593322 on staging `56a8c344f`: 29 passed, test_mock_paper_policy_postgres.py 50 passed, test_mock_private_draft_postgres.py 13 passed, 0 skipped | PASS |
| FR-003 | kind=test; ref=backend/tests/test_migration_338_paper_updated_at_triggers.py (static contract, double apply, precondition and postcondition failures) plus the staging catalog query; ci=Tests run 40784593322 on staging `56a8c344f`, 29 passed; staging catalog query returns 5 triggers enabled O on 2026-10-29 06:15 UTC+7 (/workspace/qa/pcj60/postchecks.out.json) | PASS |
| FR-004 | kind=test; ref=frontend/tests/react/mock-public-source-hide-warning.test.tsx (public source warns, private/empty/Writing do not); ci=Tests run 40784593322 on staging `56a8c344f`, 2 passed | PASS |
| FR-005 | kind=test; ref=frontend/tests/react/mock-private-draft-create.test.tsx (payload unchanged) and backend/tests/test_migration_338_paper_updated_at_triggers.py (copy still hides the source); ci=Tests run 40784593322 on staging `56a8c344f`: mock-private-draft-create.test.tsx 2 passed, test_migration_338_paper_updated_at_triggers.py 29 passed | PASS |
| FR-006 | kind=test; ref=backend/migrations/353_listening_package_status_revision.sql; backend/tests/test_migration_338_paper_updated_at_triggers.py (`test_package_status_transition_with_real_306_advances_timestamp_and_policy[status-update]`, `[package-publish-rpc]`, PC-J242 asserts unchanged; fixture applies 353 twice and checks no row changed) and backend/tests/test_migration_353_listening_package_status_revision.py (publish then archive through the real RPC: policy_revision +1 and one release event per transition; other package-row changes and raw edits still refused; rollback negative control); local PG 16.2 and 17.11 (PC-J512, 2026-11-02): test_migration_353 13 passed and test_migration_338 72 passed on each; staging CI and the staging apply are pending | PENDING |
| FR-007 | kind=test; ref=backend/migrations/353_listening_package_status_revision.sql; backend/tests/test_migration_353_listening_package_status_revision.py (publish/archive keep mock_content_revision and the overlap grant; status-only UPDATE on both Listening child tables keeps the revision, attempts and dependencies; status plus a content column bumps once; other columns, INSERT and DELETE still bump; source guard pinned and service-role only; re-run and no-row-change via the 338 fixture); local PG 16.2 and 17.11 (PC-J512, 2026-11-02): test_migration_353 13 passed and test_migration_338 72 passed on each; staging CI and the staging apply are pending | PENDING |

## Known gap — Q-J252-IMPORT (OPEN)

Importing a new package with migration 306 active can still raise SQLSTATE
55000: INSERT into `listening_content` fires the source trigger, whose UPDATE
of `listening_tests` requires the package transition GUC. Source: job 1dh,
`audit/import-base.result`; FD question
`handoff/leader/20261102-0950-fd-questions-vinh.md`, Q-J252-IMPORT.
The question remains OPEN with Vinh. J252 option 1 does not decide it;
migration 353 covers FR-006 and FR-007 only. Import remediation is outside
PC-J536 and remains pending a separate decision.

## Contract evidence

- OpenAPI/type drift: none; FastAPI is unchanged.
- Database: UPDATE on the five tables now returns an advanced `updated_at`.

## Data evidence

- Migration writes no row. Staging catalog query after apply (read-only,
  2026-10-29 06:15 UTC+7): 5 rows (`listening_content`, `listening_tests`,
  `reading_passages`, `reading_questions`, `reading_tests`), all
  `tgenabled = 'O'` (`/workspace/qa/pcj60/postchecks.out.json`).

## UI evidence

- React test for the warning (2 passed in CI run 40784593322). Content Manager
  wording review (T006): PASS on 2026-10-29 09:37 UTC+7 (PC-1029-12; optional
  rewording deferred). Staging visual check of the warning: not recorded.

## Release evidence

- Staging SHA and checks (reconciled 2026-10-29): #1877 merged as
  `c0593213db019c7f3ec6758a77bdc4f4c54c5c10` (2026-10-29 02:15 UTC+7). Ledger:
  `338_reading_listening_paper_updated_at.sql` applied 2026-10-28 19:44:25Z
  (2026-10-29 02:44:25 UTC+7) (`/workspace/qa/pcj60/ledger.out.tsv`). Staging
  `56a8c344f` contains #1877: Tests run 40784593322 and Staging release smoke
  run 40784593282 are green. Pending: the visibility-toggle probe (T005).
- Production verification (2026-10-29, owner Vinh 10:53 UTC+7, option A): 338
  applied to production under `pg_advisory_lock(173204,1)`, one request, before
  promotion PR #1906 merged. Read-only postcheck: 5 enabled triggers
  (`update_{reading_tests,listening_tests,reading_passages,reading_questions,listening_content}_updated_at`,
  `tgenabled = 'O'`) on `update_updated_at_column()`, ordered after the
  existing `trg_mock_paper_*`/`trg_protect_*` BEFORE-row triggers. Source:
  `/workspace/cc-jobs/release-1029.md`, `/workspace/cc-jobs/rel1029/out/apply-338.json`,
  `q00b-post338.json`. Railway production deployment `ab70b603` and
  Vercel production deployment 7404494270 are SUCCESS on the merge SHA. No production write probe
  (rollout). Pending: the staging visibility-toggle probe (T005, not assigned).

| Migration | Staging apply (ledger) | Production apply (ledger) | Merge to `main` |
| --- | --- | --- | --- |
| `338_reading_listening_paper_updated_at.sql` | 2026-10-28 19:44:25Z (2026-10-29 02:44:25 UTC+7), `/workspace/qa/pcj60/ledger.out.tsv` | 2026-10-29 04:52:39Z (11:52:39 UTC+7), `rel1029/out/apply-338.json` | #1906 `584b7e418e38a0be869933538fe78e9737c4f30b`, 2026-10-29 12:01:31 UTC+7 |
