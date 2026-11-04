# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_364_service_role_table_maintenance_revoke.py (migration 364 = `NNN`, PC-J544: every relkind r/p/v/m/f incl. view, partition, matview and foreign table; drift query of rollout.md returns 0 rows on the synthetic database and on the real 320+ chain; priority-1 tables checked by name, missing ones reported as NOTICE; column REFERENCES and PUBLIC entries; second apply; PG16/17) plus table/PUBLIC drift checks after the staging apply (T002, pending) | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_364_service_role_table_maintenance_revoke.py (normalised CRUD + column ACL + grant option + schema USAGE snapshot equal before/after on the synthetic database and the real chain; NULL relacl fixture; no GRANT in 364; every CRUD/USAGE drift seam aborts) plus before/after record (T002, pending) | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_364_service_role_table_maintenance_revoke.py (schema-scoped and global default ACL of the runner revoked, table created after 364 has CRUD only, probe dropped, re-grant before the probe aborts; un-actable owner and the chain's supabase_admin entry WARN with the exact support statement) plus staging `pg_default_acl` postcheck (T002, pending) | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_migration_364_service_role_table_maintenance_revoke.py (second apply; aborts with nothing committed on API-role relation/schema ownership, inherited and SET ROLE privileges, a grant by another grantor, table/PUBLIC/column/default re-grant seams, and the FR-009 re-check: missing 357 per grantee or inherited CREATE; NOTICEs for other grantees and suspect triggers, none for internal FK triggers) plus pre-apply overload triage (T002, pending) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_migration_364_service_role_table_maintenance_revoke.py (genuine roles, P3-SA-8: CREATE TRIGGER/TRUNCATE/FK REFERENCES 42501 for all three roles; PG17 ACCESS EXCLUSIVE on SELECT-only activation_attempts 42501 with a MAINTAIN red control; P2-SA-1 repro red before/42501 after; FK CASCADE/SET NULL child triggers run as owner before 364, planting refused after and the FK actions still work; real chain: 15 priority tables refused, planted students trigger runs as owner via fn_archive_student before 364, and fn_set_staff_privilege, fn_archive_student, fn_restore_student, fn_add/remove_student_cohort_membership, fn_archive/restore_cohort return the same results and write the same rows before and after 364) plus SA retest (T002, pending) | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_service_role_table_privilege_guard.py (forward > 364; ALL rollback files and *_rollback.sql regardless of number incl. a down of 356; backend/scripts and scripts incl. scripts/backup; every forbidden family: table/default grants, pg_maintain/pg_write_all_data/postgres membership, OWNER TO an API role, schema CREATE/ALL, EXECUTE format and string concatenation; .sql/.sh/.py mutation fixtures with mixed case, multiline and quoted names; CRUD/USAGE/other-object and comment controls; repository scan clean) | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_service_role_table_privilege_guard.py (clone files grant USAGE only; mandatory pending_feature row; apply_migrations.sh --baseline refuses an inherited MIGRATION_FEATURES before touching the database) and backend/tests/test_migration_364_service_role_table_maintenance_revoke.py (scenario 11 on the real chain through apply_migrations.sh: refused baseline with the group selected, baseline leaves 357 and 364 pending, a plain apply skips them, the explicit selection runs 357 then 364 and the drift/schema postchecks pass; 364 alone without 357 aborts and records nothing) | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_migration_364_service_role_table_maintenance_revoke.py (real chain with 341, 344, 356 and 357 then 364; scenario 10 checks: policies absent, no anon/authenticated table or column privilege, genuine service_role UPDATE/DELETE/CREATE TRIGGER/CREATE FUNCTION 42501; every `rollback/356_*.sql` is run and re-checked once it exists (none on staging yet, CALAPPEND-0041 T001); a re-grant down as negative control is caught by the check and by the FR-006 guard; no object change besides the dropped probe) and backend/tests/test_service_role_table_privilege_guard.py (below-364 rollback mutation rejected) plus backend/tests/test_migration_358_function_search_path_pin.py (358 changes only proconfig: bodies, owners, ACLs, triggers unchanged) | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_migration_357_*.py (primary FR-009 tests, T005 / migration 357, PC-J365/job 1h1: PG16/17 genuine roles cannot plant lower(varchar) or jsonb_build_object(text,uuid,text,text); negative control with table rights revoked but CREATE retained records postgres; postcondition aborts on re-grant/inheritance; USAGE unchanged) and backend/tests/test_migration_364_service_role_table_maintenance_revoke.py (364 re-check only under FR-004: abort on missing 357 per grantee or inherited CREATE; 357 then 364 from the staging schema shape) plus schema ACL read-only checks separately on staging/production and Q-J357-3 resolution | PENDING |
| FR-010 | kind=test; ref=backend/tests/test_migration_358_function_search_path_pin.py ((a) Scenario 12: PG16/17 temp-view shadow through grammar_content_releases FK CASCADE, red before 358 with has_table_privilege('service_role','public.users','TRIGGER') true, green after 358; (b) temp-view/temp-domain shadow against one fn_admin_* definer and one former '' routine, negative control before 358; P3-SA-8 session checks; owner-path negative control; precondition unpinned_function_not_owned_by_runner; postcondition: zero public/app_private routines whose proconfig lacks search_path, has search_path = '' or does not end with pg_temp; bodies/owners/ACLs/volatility/triggers unchanged) plus backend/tests/test_migration_function_search_path_guard.py (new CREATE [OR REPLACE] FUNCTION|PROCEDURE fails without SET search_path, with '' or with pg_temp not last) and SA staging retest after 358 (T002); implementation for the four 283 functions on branch q/001iv-mig358-pin-search-path @ 02ccd1392, not merged, to be widened under PGTEMP option a (T004) | PENDING |

## Amendment acceptance — PC-J530

- Ordering: 357 → NNN is explicit in `spec.md`, `plan.md` (Ordering),
  `tasks.md` (T001 depends on T005 applied on the target) and `rollout.md`.
- NNN re-checks FR-009; the schema revoke and primary tests belong to 357.
- The FR-010 staging-example correction is recorded outside the unchanged
  requirement text in `spec.md` (Amendment): five `fn_admin_*` routines from
  297–302; 334/335 are the item-3 routines with an empty `search_path`.
- SA and FD confirmation of this amendment: **PENDING** on the follow-up PR.
  This documentation change does not supply migration/runtime evidence.

## T001 — migration 364 (PC-J544)

- The Leader's number for `NNN` is **364** (APPROVED-20261102, card
  t1298s4085). Files: `backend/migrations/364_service_role_table_maintenance_revoke.sql`,
  its no-op down in `rollback/`, the `pending_feature` row
  `service_role_table_maintenance_revoke`, the README paragraph, the two test
  files above and the `--baseline` refusal in `backend/scripts/apply_migrations.sh`.
- Local evidence (disposable SCRAM clusters, PG 17.11 and 16.2): the two test
  files pass on both; on PG 16 the two MAINTAIN cases skip with
  `pytest.skip`. CI evidence: pending on the PR.
- Prerequisites at T001: #2196 (357) merged and 357 applied on staging
  2026-11-04T01:07:42Z (job 1sd); #2200 (PC-J530 amendment) merged; #2055 and
  the schema-USAGE-only clone follow-up are on staging. **Open:** the down
  of 356 (CALAPPEND-0041 T001) does not exist yet; the Scenario 10 test runs
  every `rollback/356_*.sql` as soon as one is added.
- **364 chờ apply (pending apply):** not applied on staging or production.
  Staging after the Leader's go (T002), production only at a Vinh-approved
  promotion (T003).

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
- Staging routine catalog for FR-010, read-only, 2026-11-02 (PC-J509,
  Management API `read_only: true`; query and result in
  `/workspace/cc-jobs/job-q-1om-pc-j509-spec0042-approve-amend.log.d/ro-ledger-catalog.{sql,result}`).
  Ledger: 283, 297–302, 334 and 335 are applied; **345, 357 and 358 are
  not** (no `_schema_migrations` row), so 345 Part B has not pinned the 283
  trigger functions on staging. Routines in `public`/`app_private` (not
  extension members, `prokind IN ('f','p')`) whose `search_path` is
  missing, `''` or does not end with `pg_temp`: 11, matching SA's count
  (PC-J455). All are owned by `postgres`.

  | Routine | Defined by | `search_path` now | After 358 |
  | --- | --- | --- | --- |
  | `prevent_grammar_release_content_mutation()` | 283 | none | `public, pg_temp` |
  | `prevent_validated_grammar_release_rewrite()` | 283 | none | `public, pg_temp` |
  | `prevent_grammar_evidence_mutation()` | 283 | none | `public, pg_temp` |
  | `prevent_completed_grammar_session_mutation()` | 283 | none | `public, pg_temp` |
  | `fn_admin_writing_queue_page(…)` | 297, 300 | `pg_catalog, public` | `pg_catalog, public, pg_temp` |
  | `fn_admin_mock_actionable_review_exam_ids(uuid[])` | 298 | `pg_catalog, public` | `pg_catalog, public, pg_temp` |
  | `fn_admin_exam_content_page_ids(…)` | 299, 301 | `pg_catalog, public` | `pg_catalog, public, pg_temp` |
  | `fn_admin_exam_content_levels(text)` | 299 | `pg_catalog, public` | `pg_catalog, public, pg_temp` |
  | `fn_admin_mock_exams_with_review_eligibility()` | 302 | `pg_catalog, public` | `pg_catalog, public, pg_temp` |
  | `fn_activate_attempt_check(uuid)` | 334 | `''` | `pg_catalog, pg_temp` |
  | `app_private.is_current_user_active()` | 335 | `''` | `pg_catalog, pg_temp` |

  `quiz_start_timed_course_session` (263/264, `public`) is not in the set:
  migrations 265/266/270 redefined it and staging already ends its
  `search_path` with `pg_temp`. FR-010's scope is every routine in those
  schemas, not this list; the 358 job re-reads the catalog at build time.
- Post-NNN staging postcheck: pending T002. Post-358 check (zero routines
  whose `search_path` is missing, `''` or not ending with `pg_temp`) and SA
  temp-shadow retest: pending T002 after T004.

## UI evidence

- No UI change (`ui-states.md`).

## Release evidence

- Staging SHA, ledger row and postcheck: pending T002.
- Production: pending T003 (owner authorization at promotion); read-only
  schema ACL and non-postgres-owner inventory required before apply.
- Q-J357-3: **UNRESOLVED / BLOCKING** for production promotion and closing
  P2-SA-1/PC-J357. A staging retest alone cannot close it. P2-R2-1 stays
  blocking until SA's 358 retest passes.
