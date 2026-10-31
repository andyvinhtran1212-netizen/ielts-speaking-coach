# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_NNN_function_execute_lockdown.py (global + public layers per actable owner; probe function after NNN not client-executable, service_role yes; procedures; un-actable supabase_admin warns; PG16/17) plus staging DRIFT-1 (T002); not written yet | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_NNN_function_execute_lockdown.py (registry file parsed; R1/R2 executable by exactly authenticated; anon removed from R1; genuine authenticated session succeeds) plus staging Scenarios 2/3 smoke (T002); not written yet | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_NNN_function_execute_lockdown.py (residue set computed from catalog; service_role preserved only where it had EXECUTE; extension member untouched; genuine anon/authenticated get 42501) plus T002 dry-run list vs research.md §2.2; not written yet | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_migration_NNN_function_execute_lockdown.py (each of (a)–(d) fires on its negative control incl. the ticket per-schema-only wording; runner restored by name, not RESET ROLE; second apply passes); not written yet | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_function_execute_acl_guard.py (rules 1–5 with mutation fixtures: missing REVOKE, PUBLIC-only REVOKE, other-file REVOKE, commented REVOKE, prefix name, wrong overload, split REVOKE accepted, ALTER to definer, client GRANT without registry, registry recreate without GRANT, dynamic definer; no false positive above NNN); not written yet | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_client_write_invariant_postgres.py (client-executable set == registry after the whole chain; default probe; new negative controls); not written yet | PENDING |
| FR-007 | kind=query; ref=specs/0045-function-default-execute-lockdown/rollout.md DRIFT-1/DRIFT-2; staging baseline 2026-10-31 read-only (/workspace/qa/pcj364/staging/d1_default_drift.json 6 rows, d2_function_drift.json 81 rows); validated on local PG16.2 and PG17.11 before/after a prototype; post-NNN staging and production runs pending T002/T003 | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_migration_NNN_function_execute_lockdown.py (before/after snapshot of bodies, owners, proconfig, prosecdef, triggers, relation/sequence/schema ACLs and non-function default ACL rows; probe absent after commit; forward-policy pending_feature row); not written yet | PENDING |

## Contract evidence

- OpenAPI/type drift: none expected; no route or response change.
- Backward compatibility: the only client-side RPC
  (`fn_apply_srs_review_idempotent`, learner JWT) and the only client-evaluated
  helper (`app_private.is_current_user_active()`, RLS) keep `authenticated`
  EXECUTE. Every other backend RPC runs as `service_role`, whose executable set
  is asserted unchanged (FR-004 (d)). `research.md` §1–§2.

## Data evidence

- Staging catalog read-only, 2026-10-31 (`/workspace/qa/pcj364/staging/`):
  default ACL rows, 272 app functions, client-evaluated references through
  `pg_depend`, nested calls, DRIFT baselines. No write was sent.
- Local PG 16.2 / 17.11 probes (`/workspace/qa/pcj364/local-pg/`): the
  ticket's per-schema-only REVOKE is ineffective; global + per-schema works;
  contexts where EXECUTE is checked; prototype postcondition and negative
  controls; manual rollback; DR restore re-opening.
- Post-NNN staging postcheck: pending T002.

## UI evidence

- No UI change (`ui-states.md`).

## Release evidence

- Staging SHA and checks: pending T002.
- Production verification: pending T003.
