# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_NNN_service_role_table_maintenance_revoke.py (all relkinds incl. view/partition/matview, priority-1 names, PG 16 without MAINTAIN, PG 17 with) plus the staging drift query (T002); not written yet | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_NNN_service_role_table_maintenance_revoke.py (SELECT/INSERT/UPDATE/DELETE snapshot equal incl. a column grant; no GRANT in NNN) plus the staging before/after record (T002); not written yet | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_NNN_service_role_table_maintenance_revoke.py (schema-scoped and global default ACL, table created after NNN, probe dropped, un-actable owner warns) plus staging `pg_default_acl` postcheck (T002); not written yet | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_migration_NNN_service_role_table_maintenance_revoke.py (second apply; abort on a service_role-owned relation and on a re-grant seam; NOTICE for pg_temp triggers and other grantees); not written yet | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_migration_NNN_service_role_table_maintenance_revoke.py (genuine service_role 42501 on CREATE TRIGGER/TRUNCATE/FK/LOCK; P2-SA-1 repro; negative control; listed RPCs unchanged) plus SA rerun of sa2050_probe.py "== P" (T002); not written yet | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_service_role_table_privilege_guard.py (migrations > NNN, rollback/, backend/scripts; .sql and .sh mutation fixtures); not written yet | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_service_role_table_privilege_guard.py over backend/scripts/staging_clone_schema_from_prod.sh after PR #2055, plus the post-clone postcheck rule in rollout.md; not written yet | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_migration_NNN_service_role_table_maintenance_revoke.py (applied with and without 341/356 fixtures where available; no function/trigger/policy/table change besides the dropped probe); not written yet | PENDING |

## Contract evidence

- OpenAPI/type drift: none expected; no route or response change.
- Backward compatibility: the backend uses only SELECT/INSERT/UPDATE/DELETE
  and RPC EXECUTE as `service_role` (`research.md` §3); all are unchanged.

## Data evidence

- Pre-NNN staging state (SA, `reviews/PR-2050.md`, 2026-10-30): 147/166
  public tables grant `service_role` TRIGGER; default ACL `arwdDxtm` for
  `service_role`. Repository scan: `research.md`.
- Post-NNN staging postcheck: pending T002.

## UI evidence

- No UI change (`ui-states.md`).

## Release evidence

- Staging SHA, ledger row and postcheck: pending T002.
- Production: pending T003 (owner authorization at promotion).
