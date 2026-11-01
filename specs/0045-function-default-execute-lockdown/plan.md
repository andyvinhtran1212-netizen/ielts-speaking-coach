# Implementation plan

## Architecture impact

- Database privileges only: `pg_default_acl` function rows of the actable
  owner roles, and `pg_proc.proacl` of the registry functions (FR-002) and of
  the residue functions (FR-003). No backend, frontend, route, response shape
  or RLS policy changes.
- New repository artefact: `backend/migrations/client-callable-functions.tsv`
  (FR-002), read by the migration test, the static guard and the PC-J94
  invariant, so all three share one registry.
- New CI guard `backend/tests/test_function_execute_acl_guard.py` (FR-005),
  separate from the SVCPRIV-0042 guards
  (`test_service_role_table_privilege_guard.py`,
  `test_migration_function_search_path_guard.py`) because it owns a different
  rule set. T001 may share their comment-stripping/tokenising helper, but
  must not merge the rule sets.

## Data and contracts

`NNN` (one transaction, `pending_feature` forward-policy group
`function_execute_lockdown`):

1. Record the runner (`current_user`) and the `service_role` executable-set
   snapshot (all functions in non-platform schemas, extension members
   excluded) in a temp table or `DO`-local variable for FR-004 (d).
2. FR-002: for each registry row, `REVOKE ALL … FROM PUBLIC, anon` and
   `GRANT EXECUTE … TO <listed roles>`. Keep `service_role` where the step 1
   snapshot had it.
3. FR-003 (if Q-J364-2 = yes): loop over the catalog set described in the FR;
   preserve `service_role` explicitly, then `REVOKE EXECUTE … FROM PUBLIC,
   anon, authenticated`. Order by `regprocedure` text for a stable log.
4. FR-001: loop over the actable owner roles; global `REVOKE … FROM PUBLIC`,
   `public` `REVOKE … FROM PUBLIC, anon, authenticated`, `public` `GRANT …
   TO service_role`.
5. FR-004 postcondition (a)–(d) and the WARNING. Restore the runner role by
   name after each probe.

Header: the 320-style read-only verification block (DRIFT-1/DRIFT-2 from
`rollout.md`), the production pre-check, the manual rollback statements
(`rollout.md` §Rollback) and the restore note. There is no
`backend/migrations/rollback/NNN_*.sql`, because FR-005 rule (3) forbids
rollback files that grant client EXECUTE.

Compatibility: existing functions keep working, because the default only
affects functions created later (`probe_a.out` case B), and the two needed
functions are re-granted explicitly. The residue revoke removes access no
client path uses (`research.md` §2.2). PG 16 and 17 behave identically; no
statement names `MAINTAIN`.

## UI and interaction

- None (`ui-states.md`).

## Work decomposition

- T001 owns the migration, the registry file, the forward-policy row, the
  migration test, the static guard and the PC-J94 extension. These files are
  disjoint from SVCPRIV-0042 T001/T004, except
  `backend/tests/test_client_write_invariant_postgres.py`, which 0042 T004
  (358) also lists. If both are open at once, the Leader orders them and the
  second rebases by `git merge origin/staging`.
- `NNN` has no ordering dependency on 341, 356, 357 or 358. It must be
  numbered after every migration merged before it, so that FR-003's apply-time
  set includes their functions (the T001 cross-check is re-run on its base).

## Rollout and rollback

- See `rollout.md`. Staging first under the advisory lock with job-rules
  logging; production only at an authorised staging → main promotion.
- Rollback is forward-only by default: if a client path breaks, add a registry
  row and grant that one function in a new migration. The full manual
  reversal is documented but not recommended.

## Verification strategy

- `backend/tests/test_migration_NNN_function_execute_lockdown.py` on PG 16
  (CI) and PG 17 (advisory job), using the 334/PC-J94 hosted-Supabase harness
  (NOSUPERUSER runner, `supabase_admin` default ACL the runner cannot change).
  Scenarios 1, 4, 7, 8, 9 and the FR-004 (a)–(d) negative controls; FR-008
  before/after catalog snapshot (bodies, owners, `proconfig`, `prosecdef`,
  triggers, relation/sequence/schema ACLs, non-function default ACL rows);
  genuine client sessions (`SET LOCAL ROLE anon|authenticated`, `ASSERT
  current_user = …`, `rolsuper = false`, the P3-SA-8 pattern) for SQLSTATE
  42501 on a residue RPC and for success on R1 and R2.
- FR-005 guard with mutation fixtures; FR-006 invariant with new negative
  controls.
- Staging: DRIFT-1/DRIFT-2 before and after, smoke journeys of Scenarios 2,
  3, 5 and 6, and Railway logs for `permission denied for function` over 24 h.
