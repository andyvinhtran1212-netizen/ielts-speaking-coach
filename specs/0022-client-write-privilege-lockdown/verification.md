# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (role/activation for authenticated and anon; definer wrapper); staging exploit replay pending | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (no users grant; policy authenticated-only with WITH CHECK; profile through service role) | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (scores, sessions, writable view, D1 results, user_d1_questions is_active only) | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (anon writes nothing; sequences lose setval) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (learner tables under owner RLS; allowlist equals learner-JWT writes; finalize as service role); backend/tests/test_d1_session.py (D1 flow with a read-only learner client) | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (objects created later by postgres and supabase_admin; re-apply restores a hand re-grant) | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (service role and owner) | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (applied twice; postcondition rejects a client-executable definer) | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (definer triggers not callable by clients and still fire for authenticated and service_role) | PENDING |
| FR-010 | kind=test; ref=backend/tests/test_speaking_entitlement_guard.py (guard decisions; generate/custom/cue-card/grading/pronunciation wiring) | PENDING |

## Contract evidence

- OpenAPI/type drift: none; no route, request or response schema change. The
  Speaking endpoints can now return 403 with the same detail strings as
  POST `/sessions`.
- Backward compatibility: the browser has no direct PostgREST writes; learner
  Vocabulary/flashcard routers keep their tables; D1 writes move to the service
  role in the same release as the migration.

## Data evidence

- Migration/schema query: the three read-only queries in the migration 320
  header must return zero rows on staging and production.
- Local: applied twice to `public` of a scratch PostgreSQL 16 database with
  Supabase-like roles, `auth.uid()` and `postgres` default ACLs; and twice in
  the disposable schema of the migration test.
- Immediate state versus full reload: privilege state is persistent; no data rewrite.

## UI evidence

- Viewports/themes/input methods: N/A — no UI change.

## Release evidence

- Staging SHA and checks: pending.
- Production verification: pending.
