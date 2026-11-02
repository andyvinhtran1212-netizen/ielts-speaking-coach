-- Migration: 361_staff_privilege_evidence_commit_guard.sql
--
-- PC-J358 (Security Auditor P3-2, P3-7, SA-R4-1/2/3 and SA-2180-1 on the
-- 341 follow-up; spec ADMINAAL2-0032 FR-009/FR-011/FR-019, AIOPS-0024
-- FR-003). Number 361 allocated by the Leader on 2026-11-02. 341 is applied
-- on staging (2026-11-02 06:40:15Z) and is never edited: this forward file
-- adds the hardening that 341 lacks.
--
--   P3-2  341 relied on fn_set_staff_privilege / fn_bootstrap_admin_recovery
--         deleting their evidence before they return. A row the owner wrote
--         directly could still commit and later be matched by a reused
--         transaction id after a dump/restore. Now the owner-only definer
--         fn_staff_privilege_evidence_consumed (search_path pg_catalog,
--         pg_temp, no EXECUTE for any role but the owner) runs as the
--         deferred constraint trigger trg_staff_privilege_evidence_consumed
--         and rejects COMMIT with `staff_privilege_evidence_not_consumed`
--         while any row remains, including one whose key was changed. It is a
--         definer because the deferred event runs after the RPC has returned
--         to service_role, which cannot read the table.
--   P3-7  341's fn_users_privilege_audit consumed evidence by NEW.id while
--         both guards look it up by OLD.id. It now consumes by OLD.id; the
--         rest of the 341 body is unchanged (same header, owner, ACL,
--         SECURITY DEFINER and search_path = public, pg_temp).
--   SA-R4-1/2  The postconditions also refuse column INSERT/UPDATE/REFERENCES,
--         client INSERT/UPDATE/DELETE and any users privilege reachable
--         through a role membership, even with INHERIT FALSE (MEMBER is
--         deliberately fail-closed).
--   SA-R4-3 / SA-2180-1  Every statement runs under SET LOCAL search_path =
--         pg_catalog, pg_temp, so no function or operator in public is
--         visible to the migration owner. Catalog functions are also called
--         as pg_catalog.<fn>, and the array operators are written
--         OPERATOR(pg_catalog.||) / OPERATOR(pg_catalog.@>): their pg_catalog
--         versions take anyarray, so an exact text[] copy would win overload
--         resolution even with pg_catalog first on the path. The precondition
--         aborts if public holds a function or operator named like one this
--         file uses.
--   Known gaps (SA P3-5, AIOPS-0024 FR-003), unchanged here: service_role can
--         supply any updated_by on ai_model_overrides, so changed_by is not
--         independently authenticated, and an owner TRUNCATE of that parent
--         table writes no audit row.
--   SA P3-6: the 341 header rollback ends with a client GRANT on the 322
--         identity sequences. That line only restores the 322 state: DO NOT
--         RUN it. Keep client sequence access closed.
--   Manual dumps: pg_dump --exclude-table-data=public.staff_privilege_evidence;
--         the table holds transient transaction evidence, never audit data.
--
-- Order and compatibility. Needs 341 in public._schema_migrations and its
-- objects (`migration_341_missing`), an empty evidence table and no shadowing
-- name in public (`catalog_name_shadowed_in_public`). The advisory-locked
-- runner records 341 before it opens 361, so on production 341 and 361 run
-- back to back at one promotion; on staging 361 runs on top of the 341 applied
-- there. Held by forward-policy.tsv as pending_feature admin_aal2: apply only
-- with MIGRATION_FEATURES=admin_aal2 through the advisory-locked runner,
-- staging first after SA review, production only at an explicitly authorised
-- staging -> main promotion after 341. No backend change. One transaction,
-- lock_timeout 5s, re-runnable (a second run changes nothing), runs as the
-- NOSUPERUSER owner, no business data read or written. Re-running 341 after
-- 361 restores the NEW.id audit body: re-run 361 after it.
--
-- ROLLBACK (a new forward migration, never an edit of this file). It reopens
-- P3-2 and P3-7 only and grants nothing:
--   BEGIN;
--   SET LOCAL search_path = pg_catalog, pg_temp;
--   SET LOCAL lock_timeout = '5s';
--   DROP TRIGGER IF EXISTS trg_staff_privilege_evidence_consumed ON public.staff_privilege_evidence;
--   DROP FUNCTION IF EXISTS public.fn_staff_privilege_evidence_consumed();
--   -- <the 341 fn_users_privilege_audit block, verbatim>
--   COMMIT;

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';

-- 0. Preconditions: 341 is recorded and its objects exist; nothing in public
-- shadows a catalog name this file uses; no evidence is left over.
DO $$
DECLARE
    catalog_functions CONSTANT text[] := ARRAY[
        'aclexplode', 'current_setting', 'format', 'gen_random_uuid', 'has_any_column_privilege',
        'has_function_privilege', 'has_sequence_privilege', 'has_table_privilege', 'jsonb_build_object',
        'pg_current_xact_id', 'pg_get_serial_sequence', 'pg_get_triggerdef', 'pg_has_role',
        'string_agg', 'to_regclass', 'to_regprocedure', 'unnest'];
    catalog_operators CONSTANT text[] := ARRAY['||', '@>', '=', '<>', '>=', '~', '~~', '->>'];
    v_wrong text;
BEGIN
    -- Two statements: PL/pgSQL plans a whole condition, so the ledger
    -- query must not be parsed when the table is missing.
    IF pg_catalog.to_regclass('public._schema_migrations') IS NULL THEN
        RAISE EXCEPTION 'migration_341_missing: no ledger row';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public._schema_migrations m
                    WHERE m.filename = '341_staff_guc_and_ai_override_hardening.sql') THEN
        RAISE EXCEPTION 'migration_341_missing: no ledger row';
    END IF;
    IF pg_catalog.to_regclass('public.staff_privilege_evidence') IS NULL
       OR pg_catalog.to_regclass('public.staff_security_audit') IS NULL
       OR pg_catalog.to_regclass('public.ai_model_override_audit') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_users_suspension_guard()') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_users_suspension_role_guard()') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_users_privilege_audit()') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_set_staff_privilege(uuid,uuid,text,boolean,text,text)') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_bootstrap_admin_recovery(uuid,text,text)') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_staff_security_record(uuid,text,uuid,uuid,text,jsonb,jsonb,text,text,jsonb,boolean)') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_ai_model_override_audit()') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_trigger g
                       WHERE g.tgrelid = 'public.ai_model_override_audit'::regclass
                         AND g.tgname = 'trg_ai_model_override_audit_no_truncate') THEN
        RAISE EXCEPTION 'migration_341_missing: objects';
    END IF;
    SELECT pg_catalog.string_agg(k.kind OPERATOR(pg_catalog.||) ' ' OPERATOR(pg_catalog.||) k.name, ', '
                                 ORDER BY k.kind, k.name) INTO v_wrong
      FROM (SELECT 'function'::text, p.proname::text FROM pg_proc p
             WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (catalog_functions)
            UNION
            SELECT 'operator'::text, o.oprname::text FROM pg_operator o
             WHERE o.oprnamespace = 'public'::regnamespace AND o.oprname = ANY (catalog_operators)) k(kind, name);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'catalog_name_shadowed_in_public: %', v_wrong;
    END IF;
    IF EXISTS (SELECT 1 FROM public.staff_privilege_evidence) THEN
        RAISE EXCEPTION 'staff_privilege_evidence_not_empty';
    END IF;
END $$;

-- 1. SA P3-2: the RPC/bootstrap normally consume their row, but even an owner
-- must not commit leftover evidence. A definer is needed because the deferred
-- event runs after the RPC has returned to service_role. Check the whole table
-- so changing a planted row's key cannot evade the commit check.
CREATE OR REPLACE FUNCTION public.fn_staff_privilege_evidence_consumed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.staff_privilege_evidence) THEN
        RAISE EXCEPTION 'staff_privilege_evidence_not_consumed'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_staff_privilege_evidence_consumed() FROM PUBLIC, anon, authenticated, service_role;

-- Constraint triggers cannot be replaced with CREATE OR REPLACE; keep reapply
-- idempotent and validate the existing definition in the postcondition.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                    WHERE tgrelid = 'public.staff_privilege_evidence'::regclass
                      AND tgname = 'trg_staff_privilege_evidence_consumed') THEN
        CREATE CONSTRAINT TRIGGER trg_staff_privilege_evidence_consumed
            AFTER INSERT ON public.staff_privilege_evidence
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION public.fn_staff_privilege_evidence_consumed();
    END IF;
END $$;

-- 2. SA P3-7: the 341 section 4 body, consuming evidence by OLD.id like the
-- guards. CREATE OR REPLACE keeps owner and ACL; the REVOKE restates it.
CREATE OR REPLACE FUNCTION public.fn_users_privilege_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_evidence public.staff_privilege_evidence%ROWTYPE;
    v_actor    uuid;
    v_audit    uuid := gen_random_uuid();
    v_reason   text;
    v_request  text;
    v_detail   jsonb := '{}'::jsonb;
    jwt_role   text := NULLIF(current_setting('request.jwt.claim.role', true), '');
    claims     text := NULLIF(current_setting('request.jwt.claims', true), '');
    v_source   text;
    v_event    text;
    v_before   jsonb;
    v_after    jsonb;
    v_alert    boolean;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        DELETE FROM public.staff_privilege_evidence e
         WHERE e.xact_id = pg_current_xact_id() AND e.target_user_id = OLD.id
        RETURNING e.* INTO v_evidence;
        IF NEW.role IS NOT DISTINCT FROM OLD.role
           AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
           AND NEW.suspended_at IS NOT DISTINCT FROM OLD.suspended_at
           AND v_evidence.kind IS DISTINCT FROM 'bootstrap' THEN
            RETURN NULL;   -- not a change; the RPC never issues one
        END IF;
        v_before := jsonb_build_object('role', OLD.role, 'is_active', OLD.is_active,
                                       'suspended_at', OLD.suspended_at);
        v_event := CASE WHEN NEW.role IS DISTINCT FROM OLD.role
                        THEN 'role_changed' ELSE 'active_changed' END;
        v_alert := COALESCE(OLD.role = 'admin', false) OR COALESCE(NEW.role = 'admin', false);
    ELSE
        IF NEW.role IS NULL OR NEW.role NOT IN ('admin', 'instructor') THEN
            RETURN NULL;
        END IF;
        v_event := 'staff_row_inserted';
        v_alert := NEW.role = 'admin';
    END IF;
    v_after := jsonb_build_object('role', NEW.role, 'is_active', NEW.is_active,
                                  'suspended_at', NEW.suspended_at);

    IF v_evidence.kind = 'rpc' THEN
        v_source  := 'admin_api';
        v_actor   := v_evidence.actor_user_id;
        v_audit   := v_evidence.audit_id;
        v_reason  := v_evidence.reason;
        v_request := v_evidence.request_id;
    ELSIF v_evidence.kind = 'bootstrap' THEN
        v_source  := 'out_of_band';
        v_event   := 'bootstrap_recovery';
        v_audit   := v_evidence.audit_id;
        v_reason  := v_evidence.reason;
        v_detail  := jsonb_build_object('operator', v_evidence.operator);
        v_alert   := true;
    ELSE
        IF jwt_role IS NULL AND claims IS NOT NULL THEN
            jwt_role := claims::jsonb ->> 'role';
        END IF;
        -- A claim alone is a setting any session can write; PostgREST also
        -- switches the role, which a definer does not hide.
        v_source := CASE WHEN jwt_role = 'service_role'
                               AND current_setting('role', true) = 'service_role'
                         THEN 'service' ELSE 'out_of_band' END;
    END IF;

    PERFORM public.fn_staff_security_record(
        v_audit, v_event, NEW.id, v_actor, v_source, v_before, v_after,
        v_reason, v_request, v_detail, v_alert);
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_users_privilege_audit() FROM PUBLIC, anon, authenticated, service_role;

-- 3. Postconditions: the 341 checks plus 361's, fail the release instead of
-- leaving a silent hole.
DO $$
DECLARE
    -- MAINTAIN only exists on PG 17+; has_table_privilege rejects it on PG 16.
    all_privileges CONSTANT text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                            'REFERENCES', 'TRIGGER']
        OPERATOR(pg_catalog.||) CASE WHEN pg_catalog.current_setting('server_version_num')::int >= 170000
                THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END;
    v_wrong text;
BEGIN
    -- SA-R4-1: include column REFERENCES and membership reachable by SET ROLE,
    -- even when INHERIT is false. MEMBER is deliberately fail-closed.
    SELECT pg_catalog.string_agg(pg_catalog.format('%s via %s', p.priv, m.rolname), ', ' ORDER BY p.priv, m.rolname) INTO v_wrong
      FROM pg_roles m
     CROSS JOIN pg_catalog.unnest(ARRAY['TRIGGER', 'REFERENCES', 'TRUNCATE']
          OPERATOR(pg_catalog.||) CASE WHEN pg_catalog.current_setting('server_version_num')::int >= 170000
                  THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END) p(priv)
     WHERE (m.rolname = 'service_role' OR pg_catalog.pg_has_role('service_role'::name, m.oid, 'MEMBER'))
       AND (pg_catalog.has_table_privilege(m.oid, 'public.users', p.priv)
            OR (p.priv = 'REFERENCES' AND pg_catalog.has_any_column_privilege(m.oid, 'public.users', p.priv)));
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'users_service_role_privileges_wrong: %', v_wrong;
    END IF;

    -- SA-R4-1/2: 320 removed client writes and table-control privileges.
    -- SELECT stays allowed. Check column I/U/R and non-inherited memberships.
    SELECT pg_catalog.string_agg(pg_catalog.format('%s:%s via %s', r.rolname, p.priv, m.rolname), ', '
                     ORDER BY r.rolname, p.priv, m.rolname) INTO v_wrong
      FROM (VALUES ('anon'), ('authenticated')) r(rolname)
      JOIN pg_roles m ON m.rolname = r.rolname OR pg_catalog.pg_has_role(r.rolname::name, m.oid, 'MEMBER')
     CROSS JOIN pg_catalog.unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRIGGER', 'REFERENCES', 'TRUNCATE']
          OPERATOR(pg_catalog.||) CASE WHEN pg_catalog.current_setting('server_version_num')::int >= 170000
                  THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END) p(priv)
     WHERE pg_catalog.has_table_privilege(m.oid, 'public.users', p.priv)
        OR (p.priv IN ('INSERT', 'UPDATE', 'REFERENCES')
            AND pg_catalog.has_any_column_privilege(m.oid, 'public.users', p.priv));
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'users_client_role_privileges_wrong: %', v_wrong;
    END IF;

    -- F1: the evidence table is owner-only, RLS on and empty.
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.staff_privilege_evidence'::regclass) THEN
        RAISE EXCEPTION 'staff_privilege_evidence_rls_off';
    END IF;
    SELECT pg_catalog.string_agg(pg_catalog.format('%s:%s', r.rolname, p.priv), ', ' ORDER BY r.rolname, p.priv) INTO v_wrong
      FROM (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
     CROSS JOIN pg_catalog.unnest(all_privileges) p(priv)
     WHERE pg_catalog.has_table_privilege(r.rolname, 'public.staff_privilege_evidence', p.priv);
    IF v_wrong IS NOT NULL
       OR EXISTS (SELECT 1 FROM pg_class c, pg_catalog.aclexplode(c.relacl) a
                   WHERE c.oid = 'public.staff_privilege_evidence'::regclass
                     AND a.grantee <> c.relowner) THEN
        RAISE EXCEPTION 'staff_privilege_evidence_privileges_wrong: %', v_wrong;
    END IF;
    IF EXISTS (SELECT 1 FROM public.staff_privilege_evidence) THEN
        RAISE EXCEPTION 'staff_privilege_evidence_not_empty';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger g
                    WHERE g.tgrelid = 'public.staff_privilege_evidence'::regclass
                      AND g.tgname = 'trg_staff_privilege_evidence_consumed'
                      AND g.tgfoid = 'public.fn_staff_privilege_evidence_consumed()'::regprocedure
                      AND g.tgtype = 5 AND g.tgconstraint <> 0
                      AND g.tgdeferrable AND g.tginitdeferred AND g.tgenabled IN ('O', 'A'))
       OR NOT EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = 'public.fn_staff_privilege_evidence_consumed()'::regprocedure
                         AND p.prosecdef AND p.proconfig OPERATOR(pg_catalog.@>) ARRAY['search_path=pg_catalog, pg_temp']
                         AND p.proacl IS NOT NULL
                         AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
                                          WHERE a.grantee <> p.proowner)) THEN
        RAISE EXCEPTION 'staff_privilege_evidence_commit_guard_wrong';
    END IF;
    -- P3-7: the audit consumes the row the guards look up (OLD.id). Re-running
    -- 341 after 361 brings NEW.id back.
    IF NOT EXISTS (SELECT 1 FROM pg_proc p
                    WHERE p.oid = 'public.fn_users_privilege_audit()'::regprocedure
                      AND p.prosrc LIKE '%e.xact_id = pg_current_xact_id() AND e.target_user_id = OLD.id%'
                      AND p.prosrc NOT LIKE '%e.target_user_id = NEW.id%') THEN
        RAISE EXCEPTION 'staff_privilege_audit_evidence_key_wrong';
    END IF;
    -- RLS is on with no policy, so a definer writes these tables only as
    -- their owner: a runner other than the 322/332 owner would break the RPC
    -- and the override PATCH instead of hardening them.
    SELECT pg_catalog.string_agg(t.fn, ', ' ORDER BY t.fn) INTO v_wrong
      FROM (VALUES ('public.fn_set_staff_privilege(uuid,uuid,text,boolean,text,text)', 'public.staff_privilege_evidence'),
                   ('public.fn_staff_privilege_evidence_consumed()', 'public.staff_privilege_evidence'),
                   ('public.fn_users_privilege_audit()', 'public.staff_privilege_evidence'),
                   ('public.fn_users_privilege_audit()', 'public.staff_security_audit'),
                   ('public.fn_ai_model_override_audit()', 'public.ai_model_override_audit')) t(fn, tbl)
      JOIN pg_proc p ON p.oid = t.fn::regprocedure
      JOIN pg_class c ON c.oid = t.tbl::regclass
     WHERE p.proowner <> c.relowner;
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'staff_definer_owner_mismatch: %', v_wrong;
    END IF;

    -- F1: the staff triggers are on and call these functions; no function
    -- reads a custom session setting; security mode, search_path and EXECUTE
    -- are the 332/336 ones (PUBLIC is grantee 0).
    SELECT pg_catalog.string_agg(t.name, ', ' ORDER BY t.name) INTO v_wrong
      FROM (VALUES ('trg_users_suspension_guard', 'public.fn_users_suspension_guard()'),
                   ('trg_users_suspension_role_guard', 'public.fn_users_suspension_role_guard()'),
                   ('trg_users_privilege_audit', 'public.fn_users_privilege_audit()')) t(name, fn)
     WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g
                        WHERE g.tgrelid = 'public.users'::regclass AND g.tgname = t.name
                          AND g.tgenabled IN ('O', 'A') AND g.tgfoid = t.fn::regprocedure);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'staff_security_trigger_missing: %', v_wrong;
    END IF;
    SELECT pg_catalog.string_agg(f.sig, ', ' ORDER BY f.sig) INTO v_wrong
      FROM (VALUES ('public.fn_users_suspension_guard()', false, false),
                   ('public.fn_users_suspension_role_guard()', false, false),
                   ('public.fn_users_privilege_audit()', true, false),
                   ('public.fn_set_staff_privilege(uuid,uuid,text,boolean,text,text)', true, true),
                   ('public.fn_bootstrap_admin_recovery(uuid,text,text)', false, false),
                   ('public.fn_ai_model_override_audit()', true, false)
           ) f(sig, definer, service_exec)
      JOIN pg_proc p ON p.oid = f.sig::regprocedure
     WHERE p.prosecdef IS DISTINCT FROM f.definer
        OR NOT (COALESCE(p.proconfig, '{}') OPERATOR(pg_catalog.@>) ARRAY['search_path=public, pg_temp'])
        OR (f.sig NOT LIKE '%ai_model%' AND p.prosrc ~ 'current_setting\(''aver\.')
        OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM f.service_exec
        OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
                    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
        OR p.proacl IS NULL;   -- NULL = default ACL, which includes PUBLIC EXECUTE
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'staff_security_function_wrong: %', v_wrong;
    END IF;

    -- F2: the identity sequences grant nothing to PUBLIC or a client.
    SELECT pg_catalog.string_agg(pg_catalog.format('%s:%s:%s', s.seq, r.rolname, p.priv), ', ' ORDER BY s.seq, r.rolname, p.priv)
      INTO v_wrong
      FROM (VALUES ('public.ai_model_override_audit_id_seq', 'public.ai_model_override_audit'),
                   ('public.ai_provider_failures_id_seq', 'public.ai_provider_failures')) s(seq, tbl)
     CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
     CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) p(priv)
     WHERE pg_catalog.pg_get_serial_sequence(s.tbl, 'id') IS DISTINCT FROM s.seq
        OR pg_catalog.has_sequence_privilege(r.rolname, s.seq, p.priv)
        OR EXISTS (SELECT 1 FROM pg_class c, pg_catalog.aclexplode(c.relacl) a
                    WHERE c.oid = s.seq::regclass AND a.grantee = 0);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'ai_override_sequence_privileges_wrong: %', v_wrong;
    END IF;

    -- F3: service_role reads the audit only; clients get nothing; TRUNCATE
    -- is refused by a trigger for every role.
    SELECT pg_catalog.string_agg(pg_catalog.format('%s:%s', r.rolname, p.priv), ', ' ORDER BY r.rolname, p.priv) INTO v_wrong
      FROM (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
     CROSS JOIN pg_catalog.unnest(all_privileges) p(priv)
     WHERE pg_catalog.has_table_privilege(r.rolname, 'public.ai_model_override_audit', p.priv)
           IS DISTINCT FROM (r.rolname = 'service_role' AND p.priv = 'SELECT');
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'ai_model_override_audit_privileges_wrong: %', v_wrong;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger g
                    WHERE g.tgrelid = 'public.ai_model_override_audit'::regclass
                      AND g.tgname = 'trg_ai_model_override_audit_no_truncate' AND g.tgenabled IN ('O', 'A')
                      AND g.tgfoid = 'public.fn_ai_model_override_audit_append_only()'::regprocedure
                      AND pg_catalog.pg_get_triggerdef(g.oid) LIKE '%BEFORE TRUNCATE ON %ai_model_override_audit FOR EACH STATEMENT%')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger g
                       WHERE g.tgrelid = 'public.ai_model_overrides'::regclass
                         AND g.tgname = 'trg_ai_model_override_audit' AND g.tgenabled IN ('O', 'A')
                         AND g.tgfoid = 'public.fn_ai_model_override_audit()'::regprocedure) THEN
        RAISE EXCEPTION 'ai_model_override_audit_trigger_missing';
    END IF;
END $$;

COMMIT;
