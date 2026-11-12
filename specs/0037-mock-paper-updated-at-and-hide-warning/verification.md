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
| FR-008 | kind=test; ref=backend/migrations/379_listening_import_source_skip.sql; backend/tests/test_migration_379_listening_import_source_skip.py (T010): the real 295 import of a new package with 306 active and every guard enabled returns `created`, no 55000, `mock_content_revision` and `policy_revision` 0, re-run `reused`; after the import, package child UPDATE/DELETE/INSERT still fail with 55000 and nothing persists, and with the 295 guard suspended in a rolled-back transaction the source guard bumps once per content write, not for a status-only write, and still once while the setting names another package; publish then archive of the imported package keep the revision with `policy_revision` +1 and one release event per transition; a hand-set setting naming a published, archived, published_at-only, status-only, attempted or other package fails with 55000 and leaves child rows and the revision unchanged; the validated, unattempted control is the only skip; a package-less paper in the same transaction commits its usual bump; `anon`/`authenticated` with a forged setting get privilege errors; the 338/353 package tests re-run on the 379 stack; 379 applied twice changes no row; rollback restores the 353 body and the 55000 (negative control); the prerequisite refuses the 306 body and an empty schema. Local PG 17.11 (PC-J562, 2026-11-11): see T010 for the command; CI on head `c88a1252f` (run 42989335690): PostgreSQL 16 shard 1/4 (job 130418116778) and PostgreSQL 17 shard 1/3 (job 130418116747) 44 passed, 0 skipped each. Rollback fail-closed (SA-2284-F1, R2): rollback/379 refuses with 55000 and changes nothing unless 379's exact source guard body is installed (353, 306, a one-byte-different body, an empty schema and a second run are refused), then checks 353's exact body, SECURITY DEFINER, `search_path=pg_catalog, public, pg_temp`, no PUBLIC/anon/authenticated EXECUTE and the five enabled 306 `trg_mock_paper_source` triggers (a disabled or dropped one aborts with 55000), local PG 17.11 2026-11-12. The staging apply plus the WM read-only SELECT (T011) are pending | PENDING |

## Import path — required check (FR-008)

Before FR-008, importing a new package with migration 306 active raised SQLSTATE
55000: INSERT into `listening_content` fires the source trigger, whose UPDATE
of `listening_tests` requires the package transition GUC (job 1dh,
`audit/import-base.result`; FD question
`handoff/leader/done/20261102-0950-fd-questions-vinh.md`, Q-J252-IMPORT).
Vinh chose "IMPORT a" (t1312u, 2026-11-03 02:16 UTC+7, Leader báo). Required
to pass:

- Local PostgreSQL 17: import a new Listening package through the real 295 RPC
  with 306 active (353 and NNN applied); no 55000, `mock_content_revision`
  unchanged during the import, re-run `reused` (T010).
- Staging, after the Leader applies NNN: WM imports one new QA package and runs
  a read-only SELECT of that package's `mock_content_revision` and of the
  trigger function catalog (T011).

Until both pass the import stays failing on staging; migration 353 covers
FR-006 and FR-007 only.
Migration 379 implements FR-008 (T010, local PostgreSQL 17 check above done
2026-11-11); the staging check (T011) waits for the Leader's apply.

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
