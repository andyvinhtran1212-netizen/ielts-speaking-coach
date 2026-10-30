# Verification

## Requirement coverage

Tests are in `backend/tests/test_migration_321_writing_grade_ratings_feedback_version.py`.
They landed on `staging` through #1834 (replaces #1727, test file byte-identical;
merge `e79d589b88fbd2a022de2de8e5e811e18a5a5b40`). CI run 40784593322 on staging
`56a8c344f` ran the file on PostgreSQL 16: 10 passed, 0 skipped. #1834 records
10 passed on PostgreSQL 17.11 as well. Test names below are as written for #1727;
they are unchanged in that file.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_321_writing_grade_ratings_feedback_version.py `test_drifted_table_converges_and_the_service_upsert_works` (column becomes `integer`); ci=Tests run 40784593322 on staging `56a8c344f`, 10 passed | PASS |
| FR-002 | kind=test; ref=backend/tests/test_migration_321_writing_grade_ratings_feedback_version.py `test_legacy_rows_take_their_essays_current_version`; ci=Tests run 40784593322 on staging `56a8c344f`, 10 passed | PASS |
| FR-003 | kind=test; ref=backend/tests/test_migration_321_writing_grade_ratings_feedback_version.py `test_drifted_table_converges_and_the_service_upsert_works` (`NOT NULL`); ci=Tests run 40784593322 on staging `56a8c344f`, 10 passed | PASS |
| FR-004 | kind=test; ref=backend/tests/test_migration_321_writing_grade_ratings_feedback_version.py `test_differently_named_single_essay_unique_is_dropped`, `test_existing_equivalent_constraint_is_reused_not_duplicated`, `test_composite_constraint_name_matches_a_fresh_116`; ci=Tests run 40784593322 on staging `56a8c344f`, 10 passed | PASS |
| FR-005 | kind=test; ref=backend/tests/test_migration_321_writing_grade_ratings_feedback_version.py `test_fresh_116_shape_is_left_unchanged`, `test_drifted_table_converges_and_the_service_upsert_works` (applied twice); ci=Tests run 40784593322 on staging `56a8c344f`, 10 passed | PASS |
| FR-006 | kind=test; ref=backend/tests/test_migration_321_writing_grade_ratings_feedback_version.py `test_migration_is_one_transaction_with_a_postcondition`, `test_postcondition_aborts_and_rolls_back_when_a_single_essay_unique_index_survives`; ci=Tests run 40784593322 on staging `56a8c344f`, 10 passed | PASS |
| FR-007 | kind=test; ref=backend/tests/test_migration_321_writing_grade_ratings_feedback_version.py `test_migration_adds_no_client_access_and_leaves_rls_alone`, `test_drifted_table_converges_and_the_service_upsert_works` (RLS still enabled); ci=Tests run 40784593322 on staging `56a8c344f`, 10 passed | PASS |
| FR-008 | kind=test; ref=backend/tests/test_migration_321_writing_grade_ratings_feedback_version.py `test_drifted_table_converges_and_the_service_upsert_works` (42703 before, upsert after), `test_service_keys_ratings_on_the_composite`; ci=Tests run 40784593322 on staging `56a8c344f`, 10 passed | PASS |
| FR-009 | kind=query; ref=rollout.md read-only shape queries on staging then production, plus a staging admin rating round trip; staging shape queries pass (2026-10-29 06:15 UTC+7); production shape queries pass (2026-10-29 11:02 and 11:50 UTC+7, `rel1029/out/q00b-post321.json`); still open: the staging admin rating round trip (PC-1029-14, Web Manager) | PENDING |

## Contract evidence

- OpenAPI/type drift: none expected. No route, schema or response change.
- Backward compatibility: the service already targets the revised shape; a
  fresh 116 database is unchanged by 321.

## Data evidence

- Migration/schema query: the read-only `pg_attribute` / `pg_constraint`
  queries in [rollout.md](rollout.md), on staging and production.
- Immediate state versus full reload: a staging admin rating persists across
  reload.

## UI evidence

- Viewports/themes/input methods: N/A. No UI change (see
  [ui-states.md](ui-states.md)).

## Release evidence

- Staging SHA and checks: #1834 merged as `e79d589b88fbd2a022de2de8e5e811e18a5a5b40`
  (2026-10-28 20:46 UTC+7). Ledger: `321_writing_grade_ratings_feedback_version.sql`
  applied 2026-10-28 19:44:18Z (2026-10-29 02:44:18 UTC+7). Read-only shape
  queries at 2026-10-29 06:15 UTC+7: `feedback_version | t | integer` and
  `writing_grade_ratings_essay_id_feedback_version_key | UNIQUE (essay_id, feedback_version)`
  (`/workspace/qa/pcj60/`). Staging `56a8c344f` contains #1834; Tests run
  40784593322 and Staging release smoke run 40784593282 are green. Pending:
  the staging admin rating round trip (PC-1029-14).
- Production verification (2026-10-29, owner Vinh 10:53 UTC+7, option A): 321
  is in the production ledger at 03:59:06Z (10:59:06 UTC+7). It was sent as
  the generated request `rel1029/req/321.sql` (advisory lock, ledger re-check,
  file verbatim); the release job lost that tool call and first logged an
  unknown operator, see `/workspace/cc-jobs/rel1029/who-applied-321.md`. The
  Leader kept it as applied (not re-applied, not rolled back) and the release
  resumed from 322 at 11:37. Read-only shape queries, 11:02 and 11:50 UTC+7:
  `feedback_version` integer NOT NULL, only
  `writing_grade_ratings_essay_id_feedback_version_key UNIQUE (essay_id, feedback_version)`,
  0 rows, RLS on, 0 policies, same as staging
  (`/workspace/cc-jobs/rel1029/out/post321-foreign.json`, `q00b-post321.json`).
  Promotion PR #1906 then merged; Railway production deployment `ab70b603` and
  Vercel production deployment 7404494270 are SUCCESS on the merge SHA
  (`/workspace/cc-jobs/release-1029.md`). No production rating was written
  (the production rollout steps are read-only). Pending: the staging round trip
  (PC-1029-14).

| Migration | Staging apply (ledger) | Production apply (ledger) | Merge to `main` |
| --- | --- | --- | --- |
| `321_writing_grade_ratings_feedback_version.sql` | 2026-10-28 19:44:18Z (2026-10-29 02:44:18 UTC+7), `/workspace/qa/pcj60/ledger.out.tsv` | 2026-10-29 03:59:06Z (10:59:06 UTC+7), `rel1029/out/q00b-ledger-post.json` | #1906 `584b7e418e38a0be869933538fe78e9737c4f30b`, 2026-10-29 12:01:31 UTC+7 |
