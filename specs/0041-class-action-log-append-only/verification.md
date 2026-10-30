# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_356_class_action_log_no_truncate.py (owner and service_role TRUNCATE refused, UPDATE/DELETE refused with the 198 message, rows unchanged, second apply, no-trigger negative control) plus the staging `pg_trigger` postcheck (T002); not written yet | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_356_class_action_log_no_truncate.py and backend/tests/test_class_action_log_postgres.py (privilege matrix, service_role INSERT succeeds, MAINTAIN on PG 17 only, no GRANT in 356 via the #2041 static guard) plus the staging `has_table_privilege` postcheck (T002); not written yet | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_356_class_action_log_no_truncate.py (both policies unchanged, `cal_admin_append` comment present) plus the staging postcheck (T002); not written yet | PENDING |

## Contract evidence

- OpenAPI/type drift: none expected; no route or response change.
- Backward compatibility: backend INSERT and SELECT on the log keep working;
  UPDATE/DELETE keep their 198 error; anon/authenticated privileges unchanged.

## Data evidence

- Pre-356 staging state (read-only, `reviews/PR-2022.md`, staging
  `4c9becc28`, PG 17.6): `service_role` = SELECT, INSERT, UPDATE, DELETE,
  REFERENCES, TRIGGER, MAINTAIN (no TRUNCATE); anon/authenticated = SELECT;
  no PUBLIC entry; one row trigger, no `BEFORE TRUNCATE` trigger.
- Postcheck after 356 on staging: pending T002.

## UI evidence

- No UI change (`ui-states.md`).

## Release evidence

- Staging SHA, ledger row and postcheck: pending T002.
- Production: pending T003 (owner authorization at promotion).
