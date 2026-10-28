# Verification

## Requirement coverage

Tests are in #1727's `backend/tests/test_migration_321_writing_grade_ratings_feedback_version.py`.
They are not on `staging` yet, so every row stays PENDING until #1727 is merged and
the migration is applied.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=#1727 `test_drifted_table_converges_and_the_service_upsert_works` (column becomes `integer`) | PENDING |
| FR-002 | kind=test; ref=#1727 `test_legacy_rows_take_their_essays_current_version` | PENDING |
| FR-003 | kind=test; ref=#1727 `test_drifted_table_converges_and_the_service_upsert_works` (`NOT NULL`) | PENDING |
| FR-004 | kind=test; ref=#1727 `test_differently_named_single_essay_unique_is_dropped`, `test_existing_equivalent_constraint_is_reused_not_duplicated`, `test_composite_constraint_name_matches_a_fresh_116` | PENDING |
| FR-005 | kind=test; ref=#1727 `test_fresh_116_shape_is_left_unchanged`, `test_drifted_table_converges_and_the_service_upsert_works` (applied twice) | PENDING |
| FR-006 | kind=test; ref=#1727 `test_migration_is_one_transaction_with_a_postcondition`, `test_postcondition_aborts_and_rolls_back_when_a_single_essay_unique_index_survives` | PENDING |
| FR-007 | kind=test; ref=#1727 `test_migration_adds_no_client_access_and_leaves_rls_alone`, `test_drifted_table_converges_and_the_service_upsert_works` (RLS still enabled) | PENDING |
| FR-008 | kind=test; ref=#1727 `test_drifted_table_converges_and_the_service_upsert_works` (42703 before, upsert after), `test_service_keys_ratings_on_the_composite` | PENDING |
| FR-009 | kind=query; ref=rollout.md read-only shape queries on staging then production, plus a staging admin rating round trip | PENDING |

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

- Staging SHA and checks: pending.
- Production verification: pending.
