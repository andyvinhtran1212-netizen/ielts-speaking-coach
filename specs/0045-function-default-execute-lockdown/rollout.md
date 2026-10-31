# Rollout and rollback

## Preconditions

- FNEXEC-0045 `approved` (T000), with Q-J364-1..6 answered.
- `NNN` merged with its `pending_feature` forward-policy row
  (`function_execute_lockdown`); CI green on PG 16, and the PG 17 advisory job
  green.
- T001's registry cross-check re-run on the exact merge base (no new client
  caller since `research.md` §1).

## Staging

1. Read-only pre-apply (Management API `"read_only": true`):
   - DRIFT-1 and DRIFT-2 below. Expected today: DRIFT-1 = 4 `postgres` rows +
     2 `supabase_admin` rows; DRIFT-2 = 81 rows (R1 for anon, N02–N17 and
     T01–T24 for both roles).
   - The FR-003 dry-run list (same `WHERE` as DRIFT-2 minus the registry,
     with `has_function_privilege('service_role', …)`), saved to the job log
     directory and compared with `research.md` §2.2. Any function a client
     really calls must become a registry row **before** apply.
   - `SELECT rolsuper, pg_has_role(current_user, 'supabase_admin', 'MEMBER')
     FROM pg_roles WHERE rolname = current_user;`
2. Apply `NNN` under advisory lock `(173204,1)` with the job-rules
   SENDING/RESULT logging; record the WARNING lines.
3. Postchecks: DRIFT-2 = 0 rows; DRIFT-1 = `supabase_admin` rows only;
   ledger row present; no advisory lock left.
4. Smoke (Scenarios 2, 3, 5, 6): learner flashcard review, learner add-word,
   inactive learner add-word rejected, admin dashboard load, Speaking session
   create and one graded response, quiz bank error-rate view; anon-key and
   learner-JWT `POST /rest/v1/rpc/fn_total_grading_minutes` → 42501.
5. 24 h Railway log watch for `permission denied for function`.
6. SA retest: re-runs DRIFT-1/DRIFT-2 and the anon RPC probe.

## Production

- Only with Vinh's explicit authorization at a staging → main promotion.
- Read-only pre-apply: DRIFT-1, DRIFT-2, the FR-003 dry-run list (production
  set is a subset of staging's because of staging-only feature groups), the
  `supabase_admin` membership query, and whether `supabase_admin` holds an
  `f` row in `public` (expected: WARNING, Q-J364-5).
- Apply under the advisory lock; same postchecks and smoke; record the SHA.

## Rollback and repair

- **Preferred (forward):** if a client path fails with `permission denied for
  function <f>`, add `<f>` to `client-callable-functions.tsv` with its caller,
  and grant only that function to only the needed role in a new migration.
- **Manual full reversal (not recommended; re-opens the SA finding):**

  ```sql
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  ```

  Verified locally: this restores the staging `pg_default_acl` pre-state, and
  the global row disappears because it equals the built-in default again.
  Residue functions would be re-granted one by one from the T002 dry-run
  list. Never re-grant anon/authenticated on a SECURITY DEFINER function.
- **After any restore or DR drill** (`scripts/backup/restore_into_project.sh`,
  `restore_drill.sh`): run DRIFT-1 and DRIFT-2. A restore into a project with
  stock defaults re-opens client EXECUTE on every function and drops the
  default change (`research.md` §3). Re-apply `NNN` (idempotent) and 320, then
  re-run both queries (Q-J364-6).

## Observability

DRIFT-1 and DRIFT-2 are read-only, return an `owner` column, and run
unchanged on PG 15, 16 and 17. They contain no `MAINTAIN`, so they need no
version gate. Both run as the SA's recurring check on staging and production
and after every function-creating migration (FR-007). Exact text, also in
`/workspace/qa/pcj364/staging/d1_default_drift.sql` and
`d2_function_drift.sql`:

```sql
-- DRIFT-1: grantees that a NEW function created by an owner in public would
-- give EXECUTE to anon/authenticated (global layer, built-in when no global
-- row, plus the per-schema public layer). Expected after NNN: only owners the
-- runner cannot act for (supabase_admin).
WITH owners AS (
    SELECT p.proowner AS oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    UNION SELECT r.oid FROM pg_roles r WHERE r.rolname IN ('postgres', 'supabase_admin')
    UNION SELECT d.defaclrole FROM pg_default_acl d
           WHERE d.defaclobjtype = 'f' AND d.defaclnamespace IN (0, 'public'::regnamespace)
), layers AS (
    SELECT o.oid AS owner, 'global' AS layer,
           COALESCE((SELECT d.defaclacl FROM pg_default_acl d
                      WHERE d.defaclrole = o.oid AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f'),
                    acldefault('f', o.oid)) AS acl,
           NOT EXISTS (SELECT 1 FROM pg_default_acl d
                        WHERE d.defaclrole = o.oid AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f') AS builtin
      FROM owners o
    UNION ALL
    SELECT d.defaclrole, 'schema public', d.defaclacl, false
      FROM pg_default_acl d
     WHERE d.defaclobjtype = 'f' AND d.defaclnamespace = 'public'::regnamespace
)
SELECT pg_get_userbyid(l.owner) AS owner, l.layer || CASE WHEN l.builtin THEN ' (built-in)' ELSE '' END AS layer,
       CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
       c.rolname AS reaches
  FROM layers l
 CROSS JOIN LATERAL aclexplode(l.acl) a
  JOIN pg_roles c ON c.rolname IN ('anon', 'authenticated')
 WHERE a.privilege_type = 'EXECUTE'
   AND (a.grantee = 0 OR pg_has_role(c.oid, a.grantee, 'USAGE'))
 ORDER BY 1, 2, 3, 4;

-- DRIFT-2: every app function anon or authenticated can EXECUTE (directly,
-- through PUBLIC or through membership) outside the registry. Expected after
-- NNN: zero rows. Keep the VALUES list equal to client-callable-functions.tsv.
WITH registry(sig, rolname) AS (VALUES
    ('fn_apply_srs_review_idempotent(uuid,uuid,text,integer,real,integer,timestamp with time zone,timestamp with time zone)', 'authenticated'),
    ('app_private.is_current_user_active()', 'authenticated'))
SELECT pg_get_userbyid(p.proowner) AS owner, n.nspname AS schema, p.oid::regprocedure::text AS signature,
       p.prokind AS kind, p.prosecdef AS security_definer, (p.prorettype = 'trigger'::regtype) AS is_trigger,
       r.rolname AS client_role,
       EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS via_public
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
 WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'auth', 'storage', 'realtime',
                         'extensions', 'graphql', 'graphql_public', 'vault', 'pgsodium', 'pgsodium_masks',
                         'net', 'cron', 'supabase_functions', 'supabase_migrations', 'pgbouncer', 'pgtle',
                         '_realtime', '_analytics')
   AND n.nspname NOT LIKE 'pg\_temp%' AND n.nspname NOT LIKE 'pg\_toast\_temp%'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
                      AND d.objid = p.oid AND d.deptype = 'e')
   AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
   AND (p.oid::regprocedure::text, r.rolname) NOT IN (SELECT sig, rolname FROM registry)
 ORDER BY 1, 2, 3, 7;
```

- Baseline (staging, 2026-10-31, read-only): DRIFT-1 6 rows (`postgres`:
  global built-in PUBLIC → anon/authenticated, `public` anon, `public`
  authenticated; `supabase_admin`: global built-in PUBLIC → anon/authenticated).
  DRIFT-2 81 rows (41 functions).
- Railway logs: `permission denied for function` count per hour after apply;
  any non-zero count is a P1 for the release owner (Leader) with the function
  name.
