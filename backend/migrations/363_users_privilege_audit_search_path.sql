-- Migration: 363_users_privilege_audit_search_path.sql
--
-- PC-J538 (Security Auditor SA-2180-R3-2, P2; spec ADMINAAL2-0032 FR-009 and
-- FR-011). Number 363 allocated by the Leader on 2026-11-02. 332, 341 and 361
-- are never edited: this forward file pins the search_path of the users
-- audit trigger chain.
--
--   SA-2180-R3-2  fn_users_privilege_audit is SECURITY DEFINER with
--         search_path = public, pg_temp and calls jsonb_build_object,
--         gen_random_uuid, current_setting and pg_current_xact_id without a
--         schema. A role with CREATE on public (service_role on staging) can
--         add an exact typed overload such as
--         public.jsonb_build_object(text,text,text,boolean,text,timestamptz);
--         it beats the catalog's VARIADIC "any" version, so the next users
--         update runs that code as the function owner (SA probe C). The 361
--         precondition only looks at public at apply time; a shadow planted
--         later is not seen.
--   Callee  The audit calls public.fn_staff_security_record, a SECURITY
--         INVOKER function that runs with the definer's identity and sets its
--         own search_path = public, pg_temp. Its 22-argument
--         jsonb_build_object (the owner alert payload) is open to the same
--         typed overload, so pinning the audit alone would not close the
--         path. 363 pins both.
--
-- Both functions are recreated with their current bodies (361 for the audit,
-- 332 for the writer), unchanged except for SET search_path = pg_catalog,
-- pg_temp and pg_catalog.<fn> for every catalog function they call. Tables and
-- functions in public were already written as public.<name>. Owner, SECURITY
-- DEFINER/INVOKER and the owner-only ACL stay as they are; the REVOKEs restate
-- them. Operators in the bodies need no qualification: with public off the
-- path no schema but pg_catalog can supply one. The DO blocks run under the
-- same pinned path and also qualify every function and operator.
--
-- Not in this file (other definers with search_path = public, pg_temp):
-- fn_set_staff_privilege, fn_ai_model_override_audit and the 332/336/341
-- guards and bootstrap. They need their own review and migration.
--
-- Order and compatibility. Needs 361 in public._schema_migrations and its
-- objects (`migration_361_missing`), and no function or operator in public
-- named like one the file or the two bodies use
-- (`catalog_name_shadowed_in_public`): a shadow already planted is an
-- incident to remove before this runs. The advisory-locked runner records 361
-- before it opens 363, so on production 341, 361 and 363 run back to back at
-- one promotion; on staging 363 runs on top of the 361 applied there. Held by
-- forward-policy.tsv as pending_feature admin_aal2: apply only with
-- MIGRATION_FEATURES=admin_aal2 through the advisory-locked runner, staging
-- first after SA review, production only at an explicitly authorised
-- staging -> main promotion after 361. No backend change. One transaction,
-- lock_timeout 5s, re-runnable (a second run changes nothing), runs as the
-- NOSUPERUSER owner, no business data read or written. Re-running 332, 341 or
-- 361 after 363 restores search_path = public on the function it replaces:
-- re-run 363 after it.
--
-- ROLLBACK: backend/migrations/rollback/363_users_privilege_audit_search_path.sql
-- restores the 361 audit body and the 332 writer body verbatim, reopens
-- SA-2180-R3-2 and grants nothing. It refuses to run while public holds a
-- shadow of a name those bodies call.

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';

-- 0. Preconditions: 361 is recorded and its objects exist; nothing in public
-- shadows a catalog name this file or the two bodies use.
DO $$
DECLARE
    catalog_functions CONSTANT text[] := ARRAY[
        'aclexplode', 'array_to_string', 'current_setting', 'gen_random_uuid', 'has_function_privilege',
        'jsonb_build_object', 'now', 'pg_current_xact_id', 'string_agg', 'strpos', 'to_regclass',
        'to_regprocedure'];
    catalog_operators CONSTANT text[] := ARRAY['=', '<>', '>', '~', '->>'];
    v_wrong text;
BEGIN
    -- Two statements: PL/pgSQL plans a whole condition, so the ledger
    -- query must not be parsed when the table is missing.
    IF pg_catalog.to_regclass('public._schema_migrations') IS NULL THEN
        RAISE EXCEPTION 'migration_361_missing: no ledger row';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public._schema_migrations m
                    WHERE m.filename OPERATOR(pg_catalog.=) '361_staff_privilege_evidence_commit_guard.sql') THEN
        RAISE EXCEPTION 'migration_361_missing: no ledger row';
    END IF;
    IF pg_catalog.to_regclass('public.staff_privilege_evidence') IS NULL
       OR pg_catalog.to_regclass('public.staff_security_audit') IS NULL
       OR pg_catalog.to_regclass('public.owner_alert_outbox') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_users_privilege_audit()') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_staff_security_record(uuid,text,uuid,uuid,text,jsonb,jsonb,text,text,jsonb,boolean)') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_staff_privilege_evidence_consumed()') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g
                       WHERE g.tgrelid OPERATOR(pg_catalog.=) 'public.users'::regclass
                         AND g.tgname OPERATOR(pg_catalog.=) 'trg_users_privilege_audit') THEN
        RAISE EXCEPTION 'migration_361_missing: objects';
    END IF;
    SELECT pg_catalog.string_agg(k.kind OPERATOR(pg_catalog.||) ' ' OPERATOR(pg_catalog.||) k.name, ', '
                                 ORDER BY k.kind, k.name) INTO v_wrong
      FROM (SELECT 'function'::text, p.proname::text FROM pg_catalog.pg_proc p
             WHERE p.pronamespace OPERATOR(pg_catalog.=) 'public'::regnamespace
               AND p.proname::text OPERATOR(pg_catalog.=) ANY (catalog_functions)
            UNION
            SELECT 'operator'::text, o.oprname::text FROM pg_catalog.pg_operator o
             WHERE o.oprnamespace OPERATOR(pg_catalog.=) 'public'::regnamespace
               AND o.oprname::text OPERATOR(pg_catalog.=) ANY (catalog_operators)) k(kind, name);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'catalog_name_shadowed_in_public: %', v_wrong;
    END IF;
END $$;

-- 1. The 332 audit/outbox writer. It is SECURITY INVOKER: called from the
-- audit trigger it runs as the definer, called by the bootstrap as the owner.
CREATE OR REPLACE FUNCTION public.fn_staff_security_record(
    p_audit_id   uuid,
    p_event      text,
    p_target     uuid,
    p_actor      uuid,
    p_source     text,
    p_before     jsonb,
    p_after      jsonb,
    p_reason     text,
    p_request_id text,
    p_detail     jsonb,
    p_alert      boolean
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_target_email text;
    v_actor_email  text;
BEGIN
    INSERT INTO public.staff_security_audit
        (id, event, target_user_id, actor_user_id, source, before, after, reason, request_id, detail)
    VALUES (p_audit_id, p_event, p_target, p_actor, p_source, p_before, p_after,
            p_reason, p_request_id, p_detail);

    IF p_alert THEN
        SELECT email INTO v_target_email FROM public.users WHERE id = p_target;
        IF p_actor IS NOT NULL THEN
            SELECT email INTO v_actor_email FROM public.users WHERE id = p_actor;
        END IF;
        -- Email-safe fields only: no reason text, token, secret or request body.
        INSERT INTO public.owner_alert_outbox (audit_id, event, payload)
        VALUES (p_audit_id, p_event, pg_catalog.jsonb_build_object(
            'audit_id',       p_audit_id,
            'event',          p_event,
            'occurred_at',    pg_catalog.now(),
            'source',         p_source,
            'target_user_id', p_target,
            'target_email',   v_target_email,
            'actor_user_id',  p_actor,
            'actor_email',    v_actor_email,
            'before',         p_before,
            'after',          p_after,
            'operator',       p_detail ->> 'operator'));
    END IF;
    RETURN p_audit_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_staff_security_record(uuid, text, uuid, uuid, text, jsonb, jsonb, text, text, jsonb, boolean)
    FROM PUBLIC, anon, authenticated, service_role;

-- 2. SA-2180-R3-2: the 361 audit body (evidence consumed by OLD.id).
CREATE OR REPLACE FUNCTION public.fn_users_privilege_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_evidence public.staff_privilege_evidence%ROWTYPE;
    v_actor    uuid;
    v_audit    uuid := pg_catalog.gen_random_uuid();
    v_reason   text;
    v_request  text;
    v_detail   jsonb := '{}'::jsonb;
    jwt_role   text := NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), '');
    claims     text := NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '');
    v_source   text;
    v_event    text;
    v_before   jsonb;
    v_after    jsonb;
    v_alert    boolean;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        DELETE FROM public.staff_privilege_evidence e
         WHERE e.xact_id = pg_catalog.pg_current_xact_id() AND e.target_user_id = OLD.id
        RETURNING e.* INTO v_evidence;
        IF NEW.role IS NOT DISTINCT FROM OLD.role
           AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
           AND NEW.suspended_at IS NOT DISTINCT FROM OLD.suspended_at
           AND v_evidence.kind IS DISTINCT FROM 'bootstrap' THEN
            RETURN NULL;   -- not a change; the RPC never issues one
        END IF;
        v_before := pg_catalog.jsonb_build_object('role', OLD.role, 'is_active', OLD.is_active,
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
    v_after := pg_catalog.jsonb_build_object('role', NEW.role, 'is_active', NEW.is_active,
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
        v_detail  := pg_catalog.jsonb_build_object('operator', v_evidence.operator);
        v_alert   := true;
    ELSE
        IF jwt_role IS NULL AND claims IS NOT NULL THEN
            jwt_role := claims::jsonb ->> 'role';
        END IF;
        -- A claim alone is a setting any session can write; PostgREST also
        -- switches the role, which a definer does not hide.
        v_source := CASE WHEN jwt_role = 'service_role'
                               AND pg_catalog.current_setting('role', true) = 'service_role'
                         THEN 'service' ELSE 'out_of_band' END;
    END IF;

    PERFORM public.fn_staff_security_record(
        v_audit, v_event, NEW.id, v_actor, v_source, v_before, v_after,
        v_reason, v_request, v_detail, v_alert);
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_users_privilege_audit() FROM PUBLIC, anon, authenticated, service_role;

-- 3. Postconditions: fail the release instead of leaving a silent hole.
DO $$
DECLARE
    v_wrong text;
BEGIN
    -- Exactly the pinned path, no unqualified catalog call left in the body,
    -- the 332 security mode, the owner of the tables they write, and no
    -- EXECUTE for PUBLIC (grantee 0) or an API role.
    SELECT pg_catalog.string_agg(f.sig, ', ' ORDER BY f.sig) INTO v_wrong
      FROM (VALUES ('public.fn_users_privilege_audit()', true),
                   ('public.fn_staff_security_record(uuid,text,uuid,uuid,text,jsonb,jsonb,text,text,jsonb,boolean)', false)
           ) f(sig, definer)
      JOIN pg_catalog.pg_proc p ON p.oid OPERATOR(pg_catalog.=) f.sig::regprocedure
      JOIN pg_catalog.pg_class c ON c.oid OPERATOR(pg_catalog.=) 'public.staff_security_audit'::regclass
     WHERE p.prosecdef OPERATOR(pg_catalog.<>) f.definer
        OR p.proconfig IS NULL
        OR pg_catalog.array_to_string(p.proconfig, '|') OPERATOR(pg_catalog.<>) 'search_path=pg_catalog, pg_temp'
        OR p.prosrc OPERATOR(pg_catalog.~)
           '(^|[^.[:alnum:]_])(jsonb_build_object|gen_random_uuid|current_setting|pg_current_xact_id|now)\s*\('
        OR p.proowner OPERATOR(pg_catalog.<>) c.relowner
        OR p.proacl IS NULL   -- NULL = default ACL, which includes PUBLIC EXECUTE
        OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
                    WHERE a.grantee OPERATOR(pg_catalog.=) 0::oid)
        OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE');
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'staff_audit_search_path_wrong: %', v_wrong;
    END IF;

    -- 361's evidence key is kept (OLD.id, like both guards).
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid OPERATOR(pg_catalog.=) 'public.fn_users_privilege_audit()'::regprocedure
                      AND pg_catalog.strpos(p.prosrc, 'e.xact_id = pg_catalog.pg_current_xact_id() AND e.target_user_id = OLD.id')
                          OPERATOR(pg_catalog.>) 0
                      AND pg_catalog.strpos(p.prosrc, 'e.target_user_id = NEW.id') OPERATOR(pg_catalog.=) 0) THEN
        RAISE EXCEPTION 'staff_privilege_audit_evidence_key_wrong';
    END IF;

    -- The audit trigger is on and calls the function above.
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g
                    WHERE g.tgrelid OPERATOR(pg_catalog.=) 'public.users'::regclass
                      AND g.tgname OPERATOR(pg_catalog.=) 'trg_users_privilege_audit'
                      AND g.tgfoid OPERATOR(pg_catalog.=) 'public.fn_users_privilege_audit()'::regprocedure
                      AND g.tgenabled OPERATOR(pg_catalog.<>) 'D'
                      AND g.tgenabled OPERATOR(pg_catalog.<>) 'R') THEN
        RAISE EXCEPTION 'staff_security_trigger_missing: trg_users_privilege_audit';
    END IF;
END $$;

COMMIT;
