-- Migration: 364_service_role_table_maintenance_revoke.sql
-- mig 364 (PC-J544). Spec: SVCPRIV-0042 T001, FR-001..FR-008, approved by Vinh
-- 2026-11-02 06:37 UTC+7 (t1246u; number from APPROVED-20261102, card
-- t1298s4085). The spec writes this migration as `NNN`.
--
-- SECURITY (SA P2-SA-1, reviews/PR-2050.md). A trigger function without
-- SECURITY DEFINER runs as whoever fires the trigger. When owner-run code (a
-- SECURITY DEFINER RPC, a definer trigger, an FK CASCADE/SET NULL, an owner
-- session) writes a table, every trigger on it runs as the owner. With
-- TRIGGER on public.users, service_role created pg_temp.x(), attached it with
-- CREATE TRIGGER, and the next fn_set_staff_privilege call ran it as postgres.
-- SA's catalog closure reaches >= 139 staging tables through FK actions, so
-- every public relation is in scope, not a named group. TRUNCATE skips RLS and
-- row triggers; REFERENCES lets a role add FKs that block owner deletes;
-- MAINTAIN (PG 17) allows ACCESS EXCLUSIVE locks, VACUUM FULL, CLUSTER and
-- REINDEX. No backend path uses any of the four (research.md section 3).
--
-- Change: REVOKE TRIGGER, REFERENCES, TRUNCATE and, on PG 17+, MAINTAIN on
-- every public relation (r, p, v, m, f) FROM PUBLIC, anon, authenticated,
-- service_role, and the same four from every table default ACL (global and
-- IN SCHEMA public) whose owner the runner can act for. SELECT, INSERT,
-- UPDATE, DELETE (table and column level), schema USAGE, owners, RLS,
-- policies, functions, triggers and data stay. No GRANT. The only object
-- created is public._svcpriv_default_probe, dropped in the same transaction;
-- the snapshot lives in pg_temp and is gone at COMMIT.
--
-- Order: 357 (FR-009, REVOKE CREATE ON SCHEMA public) is applied before 364 on
-- every target. 364 does not revoke schema CREATE; its postcondition re-checks
-- FR-009 and aborts with svcpriv_schema_create_remains when 357 is missing.
-- 364 does not need 341 or 356 and is a no-op where they already revoked.
--
-- Precondition: schema public exists and neither it nor any public relation
-- is owned by service_role, anon or authenticated (owner rights cannot be
-- revoked).
-- Postconditions (any failure rolls back the whole migration):
--   * FR-001: has_table_privilege is false for the four privileges (MAINTAIN
--     only on PG 17+) for service_role, anon, authenticated and every role
--     they are a member of (inherited or SET ROLE), on every public relation,
--     plus no column-level REFERENCES; no PUBLIC entry in relacl or attacl;
--     the priority-1 tables are checked by name, a missing one is a NOTICE;
--   * FR-002: the normalised SELECT/INSERT/UPDATE/DELETE snapshot (table and
--     column ACLs, grantor and grant option) and schema USAGE are unchanged;
--   * FR-003: no actable default ACL grants the four privileges to these
--     grantees, and a table the runner creates now does not get them;
--     entries of owners the runner cannot act for are a WARNING with the
--     exact statement for Supabase support (rollout.md);
--   * FR-009 re-check: no CREATE on schema public for PUBLIC or the three
--     roles, directly or through membership.
--   NOTICEs list other non-owner grantees that keep one of the four
--   privileges or schema CREATE, and triggers whose function is in pg_temp_*
--   or not owned by the relation owner. REVOKE does not drop a trigger that
--   was planted before this migration; SA triages them before apply.
--
-- Rollout: pending_feature group service_role_table_maintenance_revoke. Merging
-- does not apply it (merge KHÔNG áp). The Leader applies it on staging after
-- 357, with MIGRATION_FEATURES=service_role_table_maintenance_revoke under the
-- advisory-locked runner; production only at a promotion Vinh approves
-- (rollout.md, T002/T003). No backend deploy is needed. Read-only check after
-- apply (expect 0 rows): the drift queries in rollout.md, Staging step 2.
--
-- Rollback: none. rollback/364_service_role_table_maintenance_revoke.sql is a
-- documented no-op. A blanket re-grant reopens P2-SA-1 on every table. If a
-- legitimate path is refused with 42501, re-grant only that privilege on that
-- table to service_role through a new forward migration under a spec revision
-- (rollout.md, Rollback and repair). The FR-006 guard
-- (test_service_role_table_privilege_guard.py) rejects such grants in later
-- migrations, every rollback file and the scripts.

BEGIN;
SET LOCAL lock_timeout = '5s';
-- Builtins below resolve in pg_catalog only (SA-R4-3).
SET LOCAL search_path = pg_catalog, pg_temp;

-- ── 1. Precondition (FR-004) ────────────────────────────────────────────────
DO $pre$
DECLARE
    v_wrong text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'public') THEN
        RAISE EXCEPTION 'svcpriv_public_schema_missing';
    END IF;
    SELECT pg_catalog.string_agg(o.description, ', ' ORDER BY o.description) INTO v_wrong
      FROM (
        SELECT pg_catalog.format('schema %s owner %s', n.nspname,
                                 pg_catalog.pg_get_userbyid(n.nspowner)) AS description,
               pg_catalog.pg_get_userbyid(n.nspowner) AS owner
          FROM pg_catalog.pg_namespace n
         WHERE n.nspname = 'public'
        UNION ALL
        SELECT pg_catalog.format('relation %s owner %s', c.oid::regclass,
                                 pg_catalog.pg_get_userbyid(c.relowner)),
               pg_catalog.pg_get_userbyid(c.relowner)
          FROM pg_catalog.pg_class c
         WHERE c.relnamespace = 'public'::regnamespace
           AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      ) o
     WHERE o.owner IN ('service_role', 'anon', 'authenticated');
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'svcpriv_owned_by_api_role: %', v_wrong;
    END IF;
END $pre$;

-- ── 2. Snapshot of the privileges that must not change (FR-002) ─────────────
-- NULL relacl is normalised to the owner default and NULL attacl to no entry, so
-- a REVOKE that materialises implicit owner rights compares equal.
CREATE TEMP VIEW mig364_kept_privileges AS
SELECT 'relation'::text AS kind, c.oid::regclass::text AS object, 0::int2 AS attnum,
       a.grantor, a.grantee, a.privilege_type, a.is_grantable
  FROM pg_catalog.pg_class c
 CROSS JOIN LATERAL pg_catalog.aclexplode(
       COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
   AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
UNION ALL
SELECT 'column', c.oid::regclass::text, att.attnum,
       a.grantor, a.grantee, a.privilege_type, a.is_grantable
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_attribute att ON att.attrelid = c.oid
 CROSS JOIN LATERAL pg_catalog.aclexplode(att.attacl) a
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
   AND att.attnum > 0 AND NOT att.attisdropped AND att.attacl IS NOT NULL
   AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
UNION ALL
SELECT 'schema', n.nspname::text, 0::int2,
       a.grantor, a.grantee, a.privilege_type, a.is_grantable
  FROM pg_catalog.pg_namespace n
 CROSS JOIN LATERAL pg_catalog.aclexplode(
       COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
 WHERE n.nspname = 'public' AND a.privilege_type = 'USAGE';

CREATE TEMP TABLE mig364_kept_before ON COMMIT DROP AS
SELECT * FROM pg_temp.mig364_kept_privileges;

-- ── 3. Every public relation (FR-001) ───────────────────────────────────────
-- ALL TABLES covers tables, partitioned tables, views, materialized views and
-- foreign tables; the postcondition proves it relation by relation.
REVOKE TRIGGER, REFERENCES, TRUNCATE ON ALL TABLES IN SCHEMA public
    FROM PUBLIC, anon, authenticated, service_role;

DO $maintain$
BEGIN
    -- PG 16 (CI) has no MAINTAIN privilege; PG 17 (Supabase) includes it in ALL.
    IF pg_catalog.current_setting('server_version_num')::int >= 170000 THEN
        EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public '
                'FROM PUBLIC, anon, authenticated, service_role';
    END IF;
END $maintain$;

-- ── 4. Tables created later (FR-003) ────────────────────────────────────────
-- ALTER DEFAULT PRIVILEGES changes only the ACL of the role in FOR ROLE, and
-- only a superuser or a member of that role may name it (320 pattern). A
-- schema-scoped REVOKE cannot remove a global grant, so both scopes are done.
DO $defaults$
DECLARE
    has_maintain CONSTANT boolean :=
        pg_catalog.current_setting('server_version_num')::int >= 170000;
    v_super CONSTANT boolean :=
        (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user);
    v_privs text[] := ARRAY['TRIGGER', 'REFERENCES', 'TRUNCATE'];
    v_entry record;
    v_grant record;
    v_scope text;
BEGIN
    IF has_maintain THEN
        v_privs := pg_catalog.array_append(v_privs, 'MAINTAIN');
    END IF;
    FOR v_entry IN
        SELECT d.oid, d.defaclrole, pg_catalog.pg_get_userbyid(d.defaclrole) AS owner,
               d.defaclnamespace
          FROM pg_catalog.pg_default_acl d
         WHERE d.defaclobjtype = 'r'
           AND d.defaclnamespace IN (0, 'public'::regnamespace::oid)
         ORDER BY 3, 4
    LOOP
        v_scope := CASE WHEN v_entry.defaclnamespace = 0 THEN '' ELSE ' IN SCHEMA public' END;
        IF v_super OR pg_catalog.pg_has_role(current_user, v_entry.defaclrole, 'MEMBER') THEN
            EXECUTE pg_catalog.format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE %s ON TABLES '
                'FROM service_role, PUBLIC, anon, authenticated',
                v_entry.owner, v_scope, pg_catalog.array_to_string(v_privs, ', '));
        ELSE
            FOR v_grant IN
                SELECT CASE a.grantee WHEN 0 THEN 'PUBLIC'
                            ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END AS grantee,
                       a.privilege_type
                  FROM pg_catalog.pg_default_acl d
                 CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
                 WHERE d.oid = v_entry.oid
                   AND a.privilege_type = ANY (v_privs)
                   AND (a.grantee = 0 OR pg_catalog.pg_get_userbyid(a.grantee)
                        IN ('service_role', 'anon', 'authenticated'))
                 ORDER BY 1, 2
            LOOP
                RAISE WARNING 'svcpriv_default_acl_not_actable: owner=% scope=% grantee=% privilege=% (Supabase support: %)',
                    v_entry.owner, CASE WHEN v_entry.defaclnamespace = 0 THEN 'global' ELSE 'public' END,
                    v_grant.grantee, v_grant.privilege_type,
                    pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE %s ON TABLES FROM %s;',
                        v_entry.owner, v_scope, v_grant.privilege_type,
                        CASE v_grant.grantee WHEN 'PUBLIC' THEN 'PUBLIC'
                             ELSE pg_catalog.quote_ident(v_grant.grantee) END);
            END LOOP;
        END IF;
    END LOOP;
END $defaults$;

-- A table the runner creates now must come out without the four privileges.
CREATE TABLE public._svcpriv_default_probe (id int);
ALTER TABLE public._svcpriv_default_probe ENABLE ROW LEVEL SECURITY;

DO $probe$
DECLARE
    v_privs text[] := ARRAY['TRIGGER', 'REFERENCES', 'TRUNCATE'];
    v_wrong text;
BEGIN
    IF pg_catalog.current_setting('server_version_num')::int >= 170000 THEN
        v_privs := pg_catalog.array_append(v_privs, 'MAINTAIN');
    END IF;
    SELECT pg_catalog.string_agg(s.description, ', ' ORDER BY s.description) INTO v_wrong
      FROM (
        SELECT pg_catalog.format('%s %s', t.rolname, p.priv) AS description
          FROM pg_catalog.unnest(v_privs) p(priv)
         CROSS JOIN (VALUES ('service_role'), ('anon'), ('authenticated')) t(rolname)
         WHERE pg_catalog.has_table_privilege(t.rolname, 'public._svcpriv_default_probe', p.priv)
        UNION ALL
        SELECT pg_catalog.format('PUBLIC %s', a.privilege_type)
          FROM pg_catalog.pg_class c
         CROSS JOIN LATERAL pg_catalog.aclexplode(
               COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
         WHERE c.oid = 'public._svcpriv_default_probe'::regclass
           AND a.grantee = 0 AND a.privilege_type = ANY (v_privs)
      ) s;
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'svcpriv_default_probe_privilege: %', v_wrong;
    END IF;
END $probe$;

DROP TABLE public._svcpriv_default_probe;

-- ── 5. Postcondition (FR-001..FR-004, FR-009 re-check) ──────────────────────
DO $post$
DECLARE
    priority_relations CONSTANT text[] := ARRAY[
        'users', 'students', 'student_cohort_memberships', 'student_lifecycle_audit',
        'cohorts', 'class_lifecycle_audit', 'access_codes', 'user_code_assignments',
        'vocab_curated_cohort_events', 'staff_security_audit', 'owner_alert_outbox',
        'activation_attempts', 'staff_mfa_status_throttle', 'ai_model_overrides',
        'ai_model_override_audit', 'staff_privilege_evidence', 'class_action_log'];
    v_super CONSTANT boolean :=
        (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user);
    v_privs text[] := ARRAY['TRIGGER', 'REFERENCES', 'TRUNCATE'];
    v_name text;
    v_wrong text;
    v_row record;
BEGIN
    IF pg_catalog.current_setting('server_version_num')::int >= 170000 THEN
        v_privs := pg_catalog.array_append(v_privs, 'MAINTAIN');
    END IF;

    -- Priority-1 tables by name; a missing one is reported, never skipped silently.
    FOREACH v_name IN ARRAY priority_relations LOOP
        IF pg_catalog.to_regclass(pg_catalog.format('%I.%I', 'public', v_name)) IS NULL THEN
            RAISE NOTICE 'svcpriv_priority_relation_missing: %', v_name;
            CONTINUE;
        END IF;
        SELECT pg_catalog.string_agg(DISTINCT pg_catalog.format('%s via %s', p.priv, m.rolname), ', ')
          INTO v_wrong
          FROM pg_catalog.unnest(v_privs) p(priv)
         CROSS JOIN (VALUES ('service_role'), ('anon'), ('authenticated')) t(rolname)
          JOIN pg_catalog.pg_roles m ON pg_catalog.pg_has_role(t.rolname, m.oid, 'MEMBER')
         WHERE pg_catalog.has_table_privilege(
                   m.oid, pg_catalog.to_regclass(pg_catalog.format('%I.%I', 'public', v_name)), p.priv);
        IF v_wrong IS NOT NULL THEN
            RAISE EXCEPTION 'svcpriv_priority_relation_privilege: % %', v_name, v_wrong;
        END IF;
    END LOOP;

    -- FR-001, every public relation. Effective privilege, fail closed: PUBLIC,
    -- inherited grants and roles reachable through SET ROLE (MEMBER ignores
    -- INHERIT; self included). Column REFERENCES alone would still allow an FK.
    SELECT pg_catalog.string_agg(DISTINCT pg_catalog.format('%s %s via %s', c.oid::regclass, p.priv, m.rolname), ', ')
      INTO v_wrong
      FROM pg_catalog.pg_class c
     CROSS JOIN pg_catalog.unnest(v_privs) p(priv)
     CROSS JOIN (VALUES ('service_role'), ('anon'), ('authenticated')) t(rolname)
      JOIN pg_catalog.pg_roles m ON pg_catalog.pg_has_role(t.rolname, m.oid, 'MEMBER')
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND (pg_catalog.has_table_privilege(m.oid, c.oid, p.priv)
            OR (p.priv = 'REFERENCES'
                AND pg_catalog.has_any_column_privilege(m.oid, c.oid, 'REFERENCES')));
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'svcpriv_relation_privilege_remains: %', v_wrong;
    END IF;

    SELECT pg_catalog.string_agg(DISTINCT pg_catalog.format('%s %s', c.oid::regclass, a.privilege_type), ', ')
      INTO v_wrong
      FROM pg_catalog.pg_class c
     CROSS JOIN LATERAL (
           SELECT COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner)) AS acl
           UNION ALL
           SELECT att.attacl FROM pg_catalog.pg_attribute att
            WHERE att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped
              AND att.attacl IS NOT NULL) x
     CROSS JOIN LATERAL pg_catalog.aclexplode(x.acl) a
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND a.grantee = 0 AND a.privilege_type = ANY (v_privs);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'svcpriv_public_grantee_privilege_remains: %', v_wrong;
    END IF;

    -- FR-002: SELECT/INSERT/UPDATE/DELETE and schema USAGE unchanged.
    SELECT pg_catalog.string_agg(pg_catalog.format('%s %s %s %s grantee=%s grantor=%s grantable=%s',
               d.change, d.kind, d.object, d.privilege_type,
               CASE d.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(d.grantee)::text END,
               pg_catalog.pg_get_userbyid(d.grantor), d.is_grantable), ', ')
      INTO v_wrong
      FROM (
        (SELECT 'missing' AS change, * FROM pg_temp.mig364_kept_before
         EXCEPT SELECT 'missing', * FROM pg_temp.mig364_kept_privileges)
        UNION ALL
        (SELECT 'new', * FROM pg_temp.mig364_kept_privileges
         EXCEPT SELECT 'new', * FROM pg_temp.mig364_kept_before)
      ) d;
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'svcpriv_kept_privileges_changed: %', v_wrong;
    END IF;

    -- FR-003: no actable default ACL hands the four privileges out again.
    SELECT pg_catalog.string_agg(pg_catalog.format('owner %s scope %s grantee %s %s',
               pg_catalog.pg_get_userbyid(d.defaclrole),
               CASE WHEN d.defaclnamespace = 0 THEN 'global' ELSE 'public' END,
               CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END,
               a.privilege_type), ', ')
      INTO v_wrong
      FROM pg_catalog.pg_default_acl d
     CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
     WHERE d.defaclobjtype = 'r'
       AND d.defaclnamespace IN (0, 'public'::regnamespace::oid)
       AND (v_super OR pg_catalog.pg_has_role(current_user, d.defaclrole, 'MEMBER'))
       AND a.privilege_type = ANY (v_privs)
       AND (a.grantee = 0 OR pg_catalog.pg_get_userbyid(a.grantee)
            IN ('service_role', 'anon', 'authenticated'));
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'svcpriv_default_acl_remains: %', v_wrong;
    END IF;

    -- FR-009 re-check (set by 357, never revoked here).
    SELECT pg_catalog.string_agg(pg_catalog.format('%s (grantor %s)',
               CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END,
               pg_catalog.pg_get_userbyid(a.grantor)), ', ')
      INTO v_wrong
      FROM pg_catalog.pg_namespace n
     CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
     WHERE n.nspname = 'public' AND a.privilege_type = 'CREATE'
       AND (a.grantee = 0 OR pg_catalog.pg_get_userbyid(a.grantee)
            IN ('service_role', 'anon', 'authenticated'));
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'svcpriv_schema_create_remains: % (apply 357 first)', v_wrong;
    END IF;
    SELECT pg_catalog.string_agg(DISTINCT pg_catalog.format('%s via %s', t.rolname, m.rolname), ', ')
      INTO v_wrong
      FROM (VALUES ('service_role'), ('anon'), ('authenticated')) t(rolname)
      JOIN pg_catalog.pg_roles m ON pg_catalog.pg_has_role(t.rolname, m.oid, 'MEMBER')
     WHERE pg_catalog.has_schema_privilege(m.oid, 'public', 'CREATE');
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'svcpriv_schema_create_effective: %', v_wrong;
    END IF;

    -- Reported, not revoked: other non-owner grantees and suspicious triggers.
    FOR v_row IN
        SELECT pg_catalog.pg_get_userbyid(a.grantee)::text AS grantee, a.privilege_type,
               pg_catalog.count(*) AS relations
          FROM pg_catalog.pg_class c
         CROSS JOIN LATERAL pg_catalog.aclexplode(
               COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
         WHERE c.relnamespace = 'public'::regnamespace
           AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
           AND a.grantee <> c.relowner AND a.grantee <> 0
           AND a.privilege_type = ANY (v_privs)
         GROUP BY 1, 2
         ORDER BY 1, 2
    LOOP
        RAISE NOTICE 'svcpriv_other_grantee: grantee=% privilege=% relations=%',
            v_row.grantee, v_row.privilege_type, v_row.relations;
    END LOOP;
    FOR v_row IN
        SELECT pg_catalog.pg_get_userbyid(a.grantee)::text AS grantee
          FROM pg_catalog.pg_namespace n
         CROSS JOIN LATERAL pg_catalog.aclexplode(
               COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
         WHERE n.nspname = 'public' AND a.privilege_type = 'CREATE'
           AND a.grantee <> n.nspowner AND a.grantee <> 0
         ORDER BY 1
    LOOP
        RAISE NOTICE 'svcpriv_other_schema_create: grantee=%', v_row.grantee;
    END LOOP;
    FOR v_row IN
        SELECT t.tgname, t.tgrelid::regclass::text AS relation,
               p.oid::regprocedure::text AS routine,
               pg_catalog.pg_get_userbyid(p.proowner)::text AS routine_owner,
               pg_catalog.pg_get_userbyid(c.relowner)::text AS relation_owner
          FROM pg_catalog.pg_trigger t
          JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
          JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
          JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
         WHERE c.relnamespace = 'public'::regnamespace
           AND NOT t.tgisinternal
           AND (pn.nspname LIKE 'pg\_temp\_%' OR p.proowner <> c.relowner)
         ORDER BY 2, 1
    LOOP
        RAISE NOTICE 'svcpriv_suspect_trigger: % on % function % owner % (relation owner %)',
            v_row.tgname, v_row.relation, v_row.routine, v_row.routine_owner, v_row.relation_owner;
    END LOOP;
END $post$;

DROP VIEW pg_temp.mig364_kept_privileges;

COMMIT;
