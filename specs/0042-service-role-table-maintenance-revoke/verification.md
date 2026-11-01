# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_NNN_service_role_table_maintenance_revoke.py (mandatory all-relations coverage; named checks incl. access_codes/user_code_assignments; missing names reported; PG16/17) plus table/PUBLIC drift checks (T002); not written yet | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_NNN_service_role_table_maintenance_revoke.py (normalized CRUD snapshot incl. NULL relacl, column grant and grant options; schema USAGE unchanged; no GRANT in NNN) plus before/after record (T002); not written yet | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_NNN_service_role_table_maintenance_revoke.py (schema-scoped and global default ACL, table created after NNN, probe dropped, un-actable owner warns) plus staging `pg_default_acl` postcheck (T002); not written yet | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_migration_NNN_service_role_table_maintenance_revoke.py (second apply; abort on targeted-role ownership, table/schema re-grant and inherited CREATE; NOTICE for triggers/other grantees) plus pre-apply overload triage; not written yet | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_migration_NNN_service_role_table_maintenance_revoke.py (genuine service_role 42501 on CREATE TRIGGER/TRUNCATE/FK/LOCK; direct DELETE/UPDATE FK CASCADE/SET NULL negative controls; P2-SA-1 repro; RPCs unchanged) plus SA retest (T002); not written yet | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_service_role_table_privilege_guard.py (forward > NNN; ALL rollback files incl. down 356/below NNN; backend/scripts; every forbidden family: table/default grants, pg_maintain/pg_write_all_data/postgres membership, OWNER TO service_role, schema CREATE/ALL, EXECUTE format; .sql/.sh/.py mutations, safe/comment controls); not written yet | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_service_role_table_privilege_guard.py (clone after #2055 AND schema-USAGE-only follow-up) plus synthetic clone/baseline/explicit-feature-apply scenario 11 proving pending_feature excludes NNN from baseline and NNN really executes, with table/default/schema postchecks; not written yet | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_migration_NNN_service_role_table_maintenance_revoke.py (with/without 341/356; corrected down 356 after NNN does not restore rights; after down 356 genuine service_role UPDATE/DELETE on class_action_log gets 42501, with a re-grant mutation as negative control; below-NNN rollback mutation rejected; no object change besides dropped probe) plus backend/tests/test_migration_358_function_search_path_pin.py (358 changes only proconfig: bodies, owners, ACLs, triggers unchanged); not written yet | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_migration_NNN_service_role_table_maintenance_revoke.py (PG16/17 genuine roles cannot plant lower(varchar) or jsonb_build_object(text,uuid,text,text); negative control with table rights revoked but CREATE retained records postgres; postcondition aborts on re-grant/inheritance; USAGE unchanged) plus schema ACL read-only checks separately on staging/production and Q-J357-3 resolution; not written yet | PENDING |
| FR-010 | kind=test; ref=backend/tests/test_migration_358_function_search_path_pin.py (Scenario 12: PG16/17 temp-view shadow through grammar_content_releases FK CASCADE, red before 358 with has_table_privilege('service_role','public.users','TRIGGER') true, green after 358; P3-SA-8 session checks; owner-path negative control; zero unpinned public functions postcondition) plus backend/tests/test_migration_function_search_path_guard.py (new unpinned CREATE [OR REPLACE] FUNCTION fails) and SA staging retest after 358 (T002); implementation on branch q/001iv-mig358-pin-search-path @ 02ccd1392, not merged | PENDING |

## Contract evidence

- OpenAPI/type drift: none expected; no route or response change.
- Backward compatibility: the backend uses only SELECT/INSERT/UPDATE/DELETE
  and RPC EXECUTE as `service_role` (`research.md` §3); all are unchanged.
  Runtime public DDL is absent; the clone schema grant requires the J350
  follow-up.

## Data evidence

- Supplied pre-NNN staging evidence (SA, PR #2060, 2026-10-30):
  `/workspace/qa/pr2060/staging-catalog-20261030.txt` records 150/169 public
  relations granting service_role TRIGGER and public schema CREATE=true.
  `staging-owner-write-reach-20261030.txt` records 132 reachable tables,
  replacing the incomplete 83-table repository count. SA round 2
  (`/workspace/qa/pr2060/r2/reach-reconcile-20261030.txt`) corrects this to
  ≥139 on staging once FK parents outside `public` (`auth.users`) count. `research.md` records
  the query reconstruction and its limits; no live query was run here.
- `probe_overload.out` confirms owner execution through both public overloads
  after table rights are revoked; schema CREATE revoke blocks planting.
  `probe_fk_cascade.out` confirms owner identity in both entitlement-table
  child triggers from a direct service_role DELETE. These supplied probes
  establish the findings; they do not prove the future NNN implementation.
- `/workspace/qa/pr2060/r2/unpinned-trigger-fk-20261030.txt` and
  `probe_temp_shadow.out` record the 4 unpinned 283 trigger functions and
  the post-NNN temp-view shadow that grants `TRIGGER ON public.users` back;
  pinning `search_path` or revoking TEMP stops it (FR-010, P2-R2-1).
- Post-NNN staging postcheck: pending T002. Post-358 zero-unpinned check and
  SA temp-shadow retest: pending T002 after T004.

## UI evidence

- No UI change (`ui-states.md`).

## Release evidence

- Staging SHA, ledger row and postcheck: pending T002.
- Production: pending T003 (owner authorization at promotion); read-only
  schema ACL and non-postgres-owner inventory required before apply.
- Q-J357-3: **UNRESOLVED / BLOCKING** for production promotion and closing
  P2-SA-1/PC-J357. A staging retest alone cannot close it. P2-R2-1 stays
  blocking until SA's 358 retest passes.
