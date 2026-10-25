# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (role/activation/definer-wrapper cases); staging exploit replay pending | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (profile columns row-scoped; grant equals ProfileUpdate) | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (scores, sessions, writable view) | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (anon writes nothing) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (learner tables under owner RLS; allowlist equals learner-JWT writes) | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (tables created later) | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (service role and owner) | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (applied twice; postcondition) | PENDING |

## Contract evidence

- OpenAPI/type drift: none; no route or schema change.
- Backward compatibility: the browser has no direct PostgREST writes; learner-JWT routers keep their tables.

## Data evidence

- Migration/schema query: read-only query in the migration 320 header must return zero rows on staging and production.
- Immediate state versus full reload: privilege state is persistent; no data rewrite.

## UI evidence

- Viewports/themes/input methods: N/A — no UI change.

## Release evidence

- Staging SHA and checks: pending.
- Production verification: pending.
