# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_356_class_action_log_no_truncate.py (owner and service_role TRUNCATE refused; owner UPDATE/DELETE and isolated service_role re-grants reach the 198 trigger's P0001, default service_role ACL gives 42501; rows unchanged, second apply, no-trigger negative control) plus the staging `pg_trigger` postcheck (T002); not written yet | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_356_class_action_log_no_truncate.py and backend/tests/test_class_action_log_postgres.py (service_role matrix is SELECT/INSERT only and both succeed, UPDATE/DELETE absent, MAINTAIN on PG 17 only, no GRANT in 356 via the #2041 static guard) plus the staging `has_table_privilege` postcheck (T002); not written yet | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_356_class_action_log_no_truncate.py (both policies unchanged, `cal_admin_append` comment present) plus the staging postcheck (T002); not written yet | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_migration_356_class_action_log_no_truncate.py (SET LOCAL ROLE/current_user confirms non-owner, non-superuser service_role: UPDATE and DELETE each 42501 before trigger, also with row trigger disabled in an isolated control; ACCESS EXCLUSIVE LOCK and SELECT FOR UPDATE each 42501; INSERT/SELECT succeed; after down UPDATE/DELETE remain denied for service_role/PUBLIC/anon/authenticated, no direct UPDATE/DELETE grant or GRANT ALL) plus the staging ACL postcheck (T002); not written yet | PENDING |

## Contract evidence

- OpenAPI/type drift: none expected; no route or response change.
- Backward compatibility: backend INSERT and SELECT on the log keep working;
  service_role UPDATE/DELETE now fail earlier with ACL `42501`; owner or
  deliberately re-granted test privileges still reach the 198 `P0001` error.
  anon/authenticated keep their SELECT-only matrix.
- PC-J347 backend audit at base #2045 `5d9296ec2`: only INSERT/SELECT
  consumers, no UPDATE/DELETE dependency found (`research.md`). This is code
  inspection evidence, not a completed FR-004 runtime test.

## Data evidence

- Pre-356 staging state (read-only, `reviews/PR-2022.md`, staging
  `4c9becc28`, PG 17.6): `service_role` = SELECT, INSERT, UPDATE, DELETE,
  REFERENCES, TRIGGER, MAINTAIN (no TRUNCATE); anon/authenticated = SELECT;
  no PUBLIC entry; one row trigger, no `BEFORE TRUNCATE` trigger.
- Postcheck after 356 on staging: pending T002.

## UI evidence

- No UI change (`ui-states.md`).

## Spec amendment validation (PC-J347)

- `python3 backend/scripts/validate_specs.py`: 43 feature specs validated.
- From `backend/`, project venv `python -m pytest tests/test_validate_specs.py -q`:
  88 passed; no skipped tests.
- Local Markdown links, changed-file scope, approval provenance,
  FR-001..FR-004 coverage and base ancestry (`5d9296ec2`): checked.
- These checks validate the spec amendment; all implementation and deployed
  database acceptance evidence above remains PENDING for T001/T002.

## Release evidence

- Staging SHA, ledger row and postcheck: pending T002.
- Production: pending T003 (owner authorization at promotion).
