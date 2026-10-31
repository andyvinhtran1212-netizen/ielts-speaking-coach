# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (role/activation for authenticated and anon; definer wrapper); staging exploit replay pending | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (no users grant; policy authenticated-only with WITH CHECK; profile through service role) | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (scores, sessions, writable view, D1 results, user_d1_questions is_active only) | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (anon writes nothing; sequences lose setval) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (learner tables under owner RLS; allowlist equals learner-JWT writes; finalize as service role); backend/tests/test_d1_session.py (D1 flow with a read-only learner client) | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (objects created later by postgres and supabase_admin; re-apply restores a hand re-grant; non-superuser runner revokes its own defaults and warns about an owner it cannot act for) | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (service role and owner) | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (applied twice; postcondition rejects a client-executable definer, and a client-writable existing relation even when another owner's default ACL only warns) | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_migration_320_client_write_lockdown.py (definer triggers not callable by clients and still fire for authenticated and service_role) | PENDING |
| FR-010 | kind=test; ref=backend/tests/test_speaking_entitlement_guard.py (guard decisions; generate/custom/cue-card/grading/pronunciation wiring) | PENDING |
| FR-011 | kind=test; ref=backend/tests/test_migration_351_dashboard_rpcs_client_revoke.py (PG16/17: client EXECUTE denied with 42501 on the four functions after 351, service_role still returns data, exact ACL, applied twice, other-grantor grant aborts, rollback round trip); command=git grep -n fn_dashboard -- frontend returns 0 lines (no client caller); staging catalog query from the 351 header after the Leader/RM apply pending | PENDING |
| FR-012 | kind=test; ref=backend/tests/test_migration_349_rls_zero_policy_client_revoke.py (PG16/17: no PUBLIC/anon/authenticated table or column privilege on any listed table, broad USING (true) policy denied with 42501, service_role privileges unchanged, applied twice, other-grantor grant aborts, missing table aborts, rollback round trip); query=global catalog check (RLS enabled, 0 policies, any client privilege) returns 0 rows after 347 and 349 on staging, pending | PENDING |

## Contract evidence

- OpenAPI/type drift: none; no route, request or response schema change. The
  Speaking endpoints can now return 403 with the same detail strings as
  POST `/sessions`.
- Backward compatibility: the browser has no direct PostgREST writes; learner
  Vocabulary/flashcard routers keep their tables; D1 writes move to the service
  role in the same release as the migration.

## Data evidence

- Migration/schema query: the read-only queries in the migration 320
  header must return zero rows on staging and production.
- Local: applied twice to `public` of a scratch PostgreSQL 16 database with
  Supabase-like roles, `auth.uid()` and `postgres` default ACLs; and twice in
  the disposable schema of the migration test.
- Local PostgreSQL 17 (after the first staging apply aborted on
  `postgres:r:anon:MAINTAIN`): the migration test module on a scratch 17
  cluster, and 320 applied twice to `public` of a scratch 17 cluster shaped
  like hosted Supabase (superuser `supabase_admin`, non-superuser runner
  `postgres`, both default ACLs granting ALL incl. `MAINTAIN`): exit 0 both
  times, `postgres` defaults reduced to SELECT, zero relations with client
  `MAINTAIN`, one WARNING per run listing only `supabase_admin` entries.
- Immediate state versus full reload: privilege state is persistent; no data rewrite.

## UI evidence

- Viewports/themes/input methods: N/A — no UI change.

## Release evidence

- Staging SHA and checks: pending.
- Production verification: pending.
