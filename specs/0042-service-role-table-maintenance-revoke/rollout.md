# Rollout and rollback

## Preconditions

- SVCPRIV-0042 approved on `staging` (Q-J357-1 answered by Vinh through the
  Leader). T001 is merged with CI green on PG 16, with PG 17 evidence in the
  PR.
- PR #2055 (PC-J350) is merged into `staging`, so the clone script no longer
  re-grants (FR-007).
- No STAGING_FREEZE or STAGING_MERGE_HOLD. The Leader applies under the
  advisory-locked runner.
- The runner is `postgres`. Record, read-only, `SELECT rolsuper,
  pg_has_role(current_user,'supabase_admin','MEMBER')`, as for 320.
- Read-only pre-apply catalog (SA or Leader, staging), saved to the job log:
  - the count of `public` relations where
    `has_table_privilege('service_role', oid, 'TRIGGER')` is true. SA saw
    147 of 166;
  - `pg_default_acl` entries for namespace 0 and `public`, run through
    `aclexplode`;
  - `public` relations owned by `service_role`. Must be 0, or the migration
    aborts (FR-004);
  - every trigger on a `public` relation whose name is not created by any
    repository migration, or whose function is in `pg_temp_*` or not owned
    by the relation owner. If any exists, SA triages it before the apply;
    removing it needs separate authorization.

## Staging

1. The Leader applies `NNN` on `ielts-coach-staging` with the
   advisory-locked runner, following the job-rules A logging steps
   (`SENDING` / `RESULT`).
2. Read-only postcheck (drift query). Expect 0 rows:

   ```sql
   SELECT c.relname, r.rolname, p.priv
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    CROSS JOIN (VALUES ('service_role'), ('anon'), ('authenticated')) r(rolname)
    CROSS JOIN (VALUES ('TRIGGER'), ('REFERENCES'), ('TRUNCATE'), ('MAINTAIN')) p(priv)
    WHERE c.relkind IN ('r','p','v','m','f')
      AND c.relowner <> 'service_role'::regrole
      AND has_table_privilege(r.rolname, c.oid, p.priv);
   ```

   Also expect 0 rows from `pg_default_acl` (namespace 0 or `public`, objtype
   `r`, actable owners) where `aclexplode` has one of the four privileges for
   `service_role`, anon, authenticated or PUBLIC. Record the warned
   `supabase_admin` entries separately.
3. `has_table_privilege('service_role','public.users','TRIGGER')` is false,
   and SELECT/INSERT/UPDATE/DELETE on `public.users` and
   `public.student_cohort_memberships` are unchanged from the pre-apply
   record.
4. SA retest, read-only plus SA's own disposable PG: rerun
   `sa2050_probe.py` section "== P"; expect `42501` at `CREATE TRIGGER`.
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

1. Read-only ledger and pre-apply catalog.
2. Apply `NNN` under the advisory lock.
3. Run the same read-only postcheck.

No production write probes. If production has `supabase_admin` default ACLs
the runner cannot change (expected, as for 320), file the Supabase-support
request with the exact ALTER DEFAULT PRIVILEGES text from the migration's
WARNING.

## Rollback and repair

- No data changes, so there is nothing to repair.
- If a legitimate path is refused with `42501` (none is known,
  `research.md` §3):
  1. Capture the statement and table from the logs.
  2. Re-grant **only that privilege on that table** to `service_role`
     through a new forward migration, under a spec revision with owner
     approval.

  Do not run a blanket `GRANT ALL` or a full down script: that reopens
  P2-SA-1 on every table.
- If the clone script is run after `NNN` (FR-007), repeat the Staging step 2
  postcheck before staging is used for evidence. If the clone source lacks
  `NNN`, the baselined ledger shows `NNN` unapplied; apply it again.
- If the postcheck fails at apply time, the transaction rolls back by itself
  (FR-004). Read the message, fix the cause (for example a relation owned by
  `service_role` or an inherited grant), and re-apply.

## Observability

- A refused statement surfaces as `42501` / `permission denied for table …`
  in the caller's log: Railway backend logs for `service_role`, or the
  operator's session. Watch Railway staging logs for 24 h after the apply,
  then production after its apply.
- The drift query in Staging step 2 is the standing check. SA reruns it on
  every retest and after any Supabase dashboard action that can re-grant
  privileges, such as exposing a schema or resetting API permissions.
- Owner: product owner. The Leader reports T002/T003 on the PR and SA closes
  PC-J357 after the retest.
