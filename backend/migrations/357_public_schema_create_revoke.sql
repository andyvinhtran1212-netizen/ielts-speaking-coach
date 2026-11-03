-- Migration: 357_public_schema_create_revoke.sql
-- mig 357 (PC-J365/1h1). Spec: SVCPRIV-0042 FR-009 (with FR-004), approved by
-- Vinh 2026-11-02 06:37 UTC+7 (t1246u). Not to be confused with PC-J357, the
-- ticket of spec PR #2060.
--
-- SECURITY (SA P2-1 on #2060 = P2-SA-2; also the root of SA-R4-3 on #2050).
-- A role with CREATE on schema public can plant a function whose argument
-- types match a call better than the pg_catalog builtin, e.g.
-- public.lower(varchar) or public.jsonb_build_object(text,uuid,text,text), or
-- public.has_table_privilege(text,text,text). Owner-run SECURITY DEFINER
-- code with public in its search_path (167 of 173 staging definers use
-- `public, pg_temp`) and migration DO blocks then run the planted body as the
-- owner (postgres). The better type match wins even when pg_catalog is listed
-- first in search_path.
--
-- Catalog read before this change (read-only):
--   staging 2026-10-31 (SA): public owner postgres,
--     nspacl {postgres=UC/postgres,anon=U/postgres,authenticated=U/postgres,
--             service_role=UC/postgres}; service_role CREATE = t (drift from
--     the old clone script, fixed by PC-J497/#2118); 0 public functions or
--     operators named like a pg_catalog one; no extension in public.
--   production 2026-10-30 16:09 (Leader): owner pg_database_owner,
--     nspacl {pg_database_owner=UC, PUBLIC/postgres/anon/authenticated/
--     service_role=U}; CREATE = f for all three roles, none of them a member
--     of any role. On production this migration is a no-op whose
--     postconditions pass.
--
-- Change: REVOKE CREATE ON SCHEMA public FROM service_role, anon,
-- authenticated, PUBLIC. USAGE, the owner's rights and every other ACL entry
-- stay. No function, table, policy or data changes. One transaction,
-- lock_timeout 5s, re-runnable.
--
-- Precondition: schema public exists and is not owned by an API role (owner
-- rights cannot be revoked).
-- Postconditions (any failure rolls back the whole migration):
--   * every remaining CREATE entry on public is reported (NOTICE) with its
--     grantor; one for service_role, anon, authenticated or PUBLIC raises,
--     naming the grantor (a grant by another grantor, e.g. supabase_admin,
--     is not removed by the runner's REVOKE and needs a support ticket);
--   * has_schema_privilege(<role>, 'public', 'CREATE') is false for the three
--     roles and for every role they are a member of (inherited or SET ROLE);
--   * no function or operator in public has the name of a pg_catalog one
--     unless that name is in shadow_allowlist (empty: staging has 0, and no
--     repository migration creates one). REVOKE does not remove an object
--     planted earlier; SA triages any hit before re-applying;
--   * public routines owned by an API role are reported (NOTICE).
--
-- Rollout: pending_feature group public_schema_create_revoke. Merging does not
-- apply it (merge KHÔNG áp). The Leader applies it on staging with
-- MIGRATION_FEATURES=public_schema_create_revoke under the advisory-locked
-- runner; production only at a promotion Vinh approves. Apply before 358
-- (FR-010 search_path pin), and on production before 341/341b (Q-J357-4).
-- No backend deploy is needed: no runtime path creates objects in public as
-- an API role. Read-only check after apply (expect f, f, f, f):
--   SELECT has_schema_privilege('service_role', 'public', 'CREATE'),
--          has_schema_privilege('anon', 'public', 'CREATE'),
--          has_schema_privilege('authenticated', 'public', 'CREATE'),
--          EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(COALESCE(n.nspacl,
--                  acldefault('n', n.nspowner))) a WHERE n.nspname = 'public'
--                  AND a.grantee = 0 AND a.privilege_type = 'CREATE');
--
-- Rollback: none. rollback/357_public_schema_create_revoke.sql is a
-- documented no-op; restoring CREATE to an API role needs a new spec and a
-- forward migration (same rule as F5 for 356). The FR-006 guard
-- (test_public_schema_create_guard.py) rejects such a grant in migrations,
-- rollback/ and scripts.

BEGIN;
SET LOCAL lock_timeout = '5s';
-- Builtins below resolve in pg_catalog only (SA-R4-3).
SET LOCAL search_path = pg_catalog, pg_temp;

DO $pre$
DECLARE
    v_owner text;
BEGIN
    SELECT pg_catalog.pg_get_userbyid(n.nspowner) INTO v_owner
      FROM pg_catalog.pg_namespace n WHERE n.nspname = 'public';
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'public_schema_missing';
    END IF;
    IF v_owner IN ('service_role', 'anon', 'authenticated') THEN
        RAISE EXCEPTION 'public_schema_owned_by_api_role: %', v_owner;
    END IF;
END $pre$;

REVOKE CREATE ON SCHEMA public FROM service_role, anon, authenticated, PUBLIC;

DO $post$
DECLARE
    -- Entries are 'function:<name>' or 'operator:<name>'; adding one needs SA triage.
    shadow_allowlist CONSTANT text[] := ARRAY[]::text[];
    v_grant record;
    v_wrong text;
BEGIN
    FOR v_grant IN
        SELECT CASE a.grantee WHEN 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END AS grantee,
               pg_catalog.pg_get_userbyid(a.grantor)::text AS grantor
          FROM pg_catalog.pg_namespace n
         CROSS JOIN LATERAL pg_catalog.aclexplode(
               COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
         WHERE n.nspname = 'public' AND a.privilege_type = 'CREATE'
         ORDER BY 1, 2
    LOOP
        RAISE NOTICE 'public_schema_create_grant: grantee=% grantor=%',
            v_grant.grantee, v_grant.grantor;
    END LOOP;

    SELECT pg_catalog.string_agg(pg_catalog.format('%s (grantor %s)',
               CASE a.grantee WHEN 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END,
               pg_catalog.pg_get_userbyid(a.grantor)), ', ')
      INTO v_wrong
      FROM pg_catalog.pg_namespace n
     CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
     WHERE n.nspname = 'public' AND a.privilege_type = 'CREATE'
       AND (a.grantee = 0 OR a.grantee IN (
           SELECT r.oid FROM pg_catalog.pg_roles r
            WHERE r.rolname IN ('service_role', 'anon', 'authenticated')));
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'public_schema_create_acl_remains: %', v_wrong;
    END IF;

    -- Effective privilege, fail closed: includes PUBLIC, inherited grants and
    -- roles reachable through SET ROLE (MEMBER ignores INHERIT; self included).
    SELECT pg_catalog.string_agg(DISTINCT pg_catalog.format('%s via %s', r.rolname, m.rolname), ', ')
      INTO v_wrong
      FROM (VALUES ('service_role'), ('anon'), ('authenticated')) r(rolname)
      JOIN pg_catalog.pg_roles m ON pg_catalog.pg_has_role(r.rolname, m.oid, 'MEMBER')
     WHERE pg_catalog.has_schema_privilege(m.oid, 'public', 'CREATE');
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'public_schema_create_effective: %', v_wrong;
    END IF;

    SELECT pg_catalog.string_agg(s.description, ', ' ORDER BY s.description) INTO v_wrong
      FROM (
        SELECT pg_catalog.format('function %s owner %s', p.oid::regprocedure,
                                 pg_catalog.pg_get_userbyid(p.proowner)) AS description,
               'function:' || p.proname AS entry
          FROM pg_catalog.pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc c
                        WHERE c.pronamespace = 'pg_catalog'::regnamespace
                          AND c.proname = p.proname)
        UNION ALL
        SELECT pg_catalog.format('operator %s owner %s', o.oid::regoperator,
                                 pg_catalog.pg_get_userbyid(o.oprowner)),
               'operator:' || o.oprname
          FROM pg_catalog.pg_operator o
         WHERE o.oprnamespace = 'public'::regnamespace
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_operator c
                        WHERE c.oprnamespace = 'pg_catalog'::regnamespace
                          AND c.oprname = o.oprname)
      ) s
     WHERE NOT (s.entry = ANY (shadow_allowlist));
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'public_pg_catalog_name_shadow: %', v_wrong;
    END IF;

    FOR v_grant IN
        SELECT p.oid::regprocedure::text AS routine,
               pg_catalog.pg_get_userbyid(p.proowner)::text AS owner
          FROM pg_catalog.pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND pg_catalog.pg_get_userbyid(p.proowner) IN ('service_role', 'anon', 'authenticated')
         ORDER BY 1
    LOOP
        RAISE NOTICE 'public_routine_owned_by_api_role: % owner=%', v_grant.routine, v_grant.owner;
    END LOOP;
END $post$;

COMMIT;
