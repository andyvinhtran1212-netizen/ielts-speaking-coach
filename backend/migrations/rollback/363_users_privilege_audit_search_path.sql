-- Rollback for 363_users_privilege_audit_search_path.sql (PC-J538). Manual
-- only, never run by the migration runner; a rollback is applied as a new
-- forward migration after SA review.
--
-- It restores, verbatim, the 332 body of public.fn_staff_security_record and
-- the 361 body of public.fn_users_privilege_audit, both with
-- search_path = public, pg_temp. That REOPENS SA-2180-R3-2: a typed overload
-- in public (for example jsonb_build_object) runs as the function owner on the
-- next users update while any role holds CREATE on public. Owner, security
-- mode and the owner-only ACL are kept; it grants nothing. It refuses to run
-- while public already holds a function named like one the restored bodies
-- call, because that code would run at once.

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    v_wrong text;
BEGIN
    SELECT pg_catalog.string_agg(DISTINCT p.proname::text, ', ') INTO v_wrong
      FROM pg_catalog.pg_proc p
     WHERE p.pronamespace OPERATOR(pg_catalog.=) 'public'::regnamespace
       AND p.proname::text OPERATOR(pg_catalog.=) ANY (ARRAY[
           'current_setting', 'gen_random_uuid', 'jsonb_build_object', 'now', 'pg_current_xact_id']);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'catalog_name_shadowed_in_public: %', v_wrong;
    END IF;
END $$;

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
SET search_path = public, pg_temp
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
        VALUES (p_audit_id, p_event, jsonb_build_object(
            'audit_id',       p_audit_id,
            'event',          p_event,
            'occurred_at',    now(),
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

COMMIT;
