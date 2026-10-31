# Rollout and rollback

## Preconditions

- SVCPRIV-0042 approved on `staging` (Q-J357-1 answered by Vinh through the
  Leader). T001 is merged with CI green on PG 16, with PG 17 evidence in the
  PR.
- PR #2055 plus PC-J350's schema grant follow-up are merged: the clone uses
  USAGE only for API roles, never CREATE/ALL on schema public (FR-007).
- Every rollback passes FR-006, including a corrected down of 356 under F5.
  No older-number rollback exemption is allowed.
- Migration 358 (FR-010, T004) is merged and held by its `pending_feature`
  entry; it is applied after 357 (PC-J365). Until 358 is applied and SA's
  358 retest passes, the temp-view-shadow path (P2-R2-1) stays open and
  blocks production promotion.
- No STAGING_FREEZE or STAGING_MERGE_HOLD. The Leader applies under the
  advisory-locked runner.
- The runner is `postgres`. Record, read-only, `SELECT rolsuper,
  pg_has_role(current_user,'supabase_admin','MEMBER')`, as for 320.
- Read-only pre-apply catalog (SA or Leader, staging), saved to the job log:
  - the count of `public` relations where
    `has_table_privilege('service_role', oid, 'TRIGGER')` is true. SA saw
    150 of 169 in the later PR #2060 snapshot (historical, not a current check);
  - `pg_default_acl` entries for namespace 0 and `public`, run through
    `aclexplode`;
  - schema public owner, `nspacl`, and effective CREATE for service_role,
    anon and authenticated, plus PUBLIC's CREATE ACL. Repeat on production
    before apply; staging CREATE may come from the clone script;
  - public relations owned by any targeted role. Must be 0, or FR-004 aborts.
    List all non-postgres owners too, on staging and production:

    ```sql
    SELECT n.nspname, c.relname, pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
       AND c.relowner <> 'postgres'::regrole;
    ```

    If postgres cannot revoke on an existing relation owned by a hosted
    admin, resolve through Supabase support before apply; a warning/no-op
    REVOKE does not satisfy FR-001 and the postcondition must abort;
  - every trigger on a `public` relation whose name is not created by any
    repository migration, or whose function is in `pg_temp_*` or not owned
    by the relation owner. If any exists, SA triages it before the apply;
    removing it needs separate authorization;
  - public functions owned by targeted roles and suspicious overloads of
    pg_catalog builtins. Revoking CREATE does not remove functions already
    planted. Untriaged objects block Q-J357-3.

## Staging

1. The Leader applies `NNN` on `ielts-coach-staging` with the
   advisory-locked runner, following the job-rules A logging steps
   (`SENDING` / `RESULT`).
2. Read-only postcheck (drift query). Expect 0 rows:

   ```sql
   WITH privileges(priv) AS (
     SELECT unnest(ARRAY['TRIGGER', 'REFERENCES', 'TRUNCATE']::text[] ||
       CASE WHEN current_setting('server_version_num')::int >= 170000
            THEN ARRAY['MAINTAIN']::text[] ELSE ARRAY[]::text[] END)
   ), relations AS (
     SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
   )
   SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, r.rolname, p.priv
     FROM relations c
    CROSS JOIN (VALUES ('service_role'), ('anon'), ('authenticated')) r(rolname)
    CROSS JOIN privileges p
    WHERE has_table_privilege(r.rolname, c.oid, p.priv)
   UNION ALL
   SELECT c.relname, pg_get_userbyid(c.relowner), 'PUBLIC', a.privilege_type
     FROM relations c
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,
      acldefault('r', c.relowner))) a
     JOIN privileges p ON p.priv = a.privilege_type
    WHERE a.grantee = 0;
   ```

   The version-dependent array contains no MAINTAIN row on PG16, so
   `has_table_privilege` never receives an unrecognized privilege there.
   Run the same query in both PG16 and PG17 harnesses.

   Also expect 0 rows from `pg_default_acl` (namespace 0 or `public`, objtype
   `r`, actable owners) where `aclexplode` has one of the four privileges for
   `service_role`, anon, authenticated or PUBLIC. Record the warned
   `supabase_admin` entries separately, with owner and scope. Use the same
   version-dependent privilege list. Staging's SA snapshot has no
   supabase_admin public default ACL; test that warning branch on the harness.

   Schema CREATE drift (also expect 0 rows, including PUBLIC):

   ```sql
   SELECT n.nspname, pg_get_userbyid(n.nspowner) AS owner, r.rolname, 'CREATE' AS priv
     FROM pg_namespace n
    CROSS JOIN (VALUES ('service_role'), ('anon'), ('authenticated')) r(rolname)
    WHERE n.nspname = 'public'
      AND has_schema_privilege(r.rolname, n.oid, 'CREATE')
   UNION ALL
   SELECT n.nspname, pg_get_userbyid(n.nspowner), 'PUBLIC', a.privilege_type
     FROM pg_namespace n
    CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,
      acldefault('n', n.nspowner))) a
    WHERE n.nspname = 'public' AND a.grantee = 0
      AND a.privilege_type = 'CREATE';
   ```
   After 358 (FR-010), also expect 0 rows:

   ```sql
   SELECT p.oid::regprocedure AS routine, pg_get_userbyid(p.proowner) AS owner
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c
         WHERE c LIKE 'search_path=%');
   ```
3. `has_table_privilege('service_role','public.users','TRIGGER')` is false,
   and SELECT/INSERT/UPDATE/DELETE on `public.users` and
   `public.student_cohort_memberships` are unchanged from the pre-apply
   record.
4. SA retest, read-only plus SA's own disposable PG: rerun
   `sa2050_probe.py` section "== P"; expect `42501` at `CREATE TRIGGER`.
   Rerun the synthetic overload and direct-DML FK controls from
   `/workspace/qa/pr2060/`: planted child triggers run as postgres without
   NNN; after NNN, planting triggers and both public overloads fails with 42501.
   After 358, rerun `/workspace/qa/pr2060/r2/probe_temp_shadow.sql` on SA's
   disposable PG: no attacker marker and `has_table_privilege(
   'service_role','public.users','TRIGGER')` stays false.
   These write probes use disposable synthetic objects only, never production.
5. Smoke on QA data:
   - archive and restore a QA student;
   - add and remove a QA cohort membership;
   - archive and restore a QA class;
   - activate a QA access code;
   - run the staff privilege flow, if T006 is live.

   Staging E2E stays green.

## Production

Only with Vinh's explicit authorization at the `staging` → `main` promotion,
as its own step:

1. Read-only ledger and pre-apply catalog, explicitly recording public schema
   ACL/effective CREATE and every non-postgres public relation owner. Staging
   evidence alone is insufficient. Record the pre-promotion part of Q-J357-3.
2. Apply `NNN` under the advisory lock.
3. Run the same read-only postcheck.
4. Q-J357-3 is a blocking gate for promotion and closing P2-SA-1/PC-J357:
   require FR-001/FR-003/FR-009/FR-010 evidence for the production apply,
   SA's 358 retest passed (P2-R2-1), and SA's
   written resolution of existing planted objects, TEMP/other-schema risks
   and un-actable defaults. No owner-execution path may remain unaddressed.

No production write probes. If production has `supabase_admin` default ACLs
the runner cannot change (expected, as for 320), file the Supabase-support
request with the exact ALTER DEFAULT PRIVILEGES text from the migration's
WARNING.

## Rollback and repair

- No data changes, so there is nothing to repair.
- Never run a down that re-grants TRIGGER, REFERENCES, TRUNCATE or MAINTAIN,
  schema CREATE, privileged role membership or ownership to an API role.
  This includes down 356: fix F5 before release and recheck privileges after
  exercising its corrected down in the harness. Its number being below NNN
  does not make it safe.
- If a legitimate path is refused with `42501` (none is known,
  `research.md` §3):
  1. Capture the statement and object from the logs.
  2. Re-grant **only that privilege on that table** to `service_role`
     through a new forward migration, under a spec revision with owner
     approval.

  Do not run a blanket `GRANT ALL` or a full down script: that reopens
  P2-SA-1 on every table. A request for public schema CREATE needs a revised
  security design and SA review; granting it back restores overload planting.
- If the clone script is run after `NNN` (FR-007), repeat the Staging step 2
  postcheck before staging is used for evidence. If the clone source lacks
  `NNN`, its mandatory `pending_feature` policy must leave NNN unapplied
  during `--baseline`; clear or refuse an inherited `MIGRATION_FEATURES`
  selection of NNN's group before baselining. Inspect the ledger and ACLs,
  then apply NNN through
  the authorized explicit feature selection. If a baseline falsely recorded
  it, stop and reconcile through the supported runner workflow; an ordinary
  apply would skip it. Scenario 11 proves the full synthetic sequence.
- After every restore or DR drill (including `scripts/backup/`
  `restore_into_project.sh`, which restores ACLs from the dump), re-run the
  FR-001/FR-003/FR-009/FR-010 read-only postchecks (Staging step 2) before
  the restored database is used. A dump taken before NNN or 358 brings back
  TRIGGER, schema CREATE or unpinned functions.
- If the postcheck fails at apply time, the transaction rolls back by itself
  (FR-004). Read the message, fix the cause (for example a relation owned by
  `service_role` or an inherited grant), and re-apply.

## Observability

- A refused statement surfaces as `42501` / `permission denied for table …`
  or `permission denied for schema public`
  in the caller's log: Railway backend logs for `service_role`, or the
  operator's session. Watch Railway staging logs for 24 h after the apply,
  then production after its apply.
- The table/default/schema drift checks in Staging step 2 are standing
  read-only checks: SA runs them daily, on every retest, after clone and after
  any Supabase dashboard action that can re-grant privileges. Save timestamp,
  environment, relation/default owner and result; any drift reopens the gate.
- Owner: product owner. The Leader reports T002/T003 on the PR and SA closes
  PC-J357/P2-SA-1 only after Q-J357-3 is resolved with the required evidence.
