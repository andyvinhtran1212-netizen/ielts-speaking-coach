-- Rollback for 365_staff_security_chain_search_path.sql (PC-J603). Manual
-- only, never run by the migration runner; a rollback is applied as a new
-- forward migration after SA review.
--
-- It restores, verbatim, the 341 bodies of public.fn_users_suspension_guard,
-- public.fn_users_suspension_role_guard, public.fn_set_staff_privilege and
-- public.fn_bootstrap_admin_recovery and the 332 body of
-- public.fn_staff_security_audit_append_only, all with
-- search_path = public, pg_temp, and sets that path again on
-- public.fn_ai_model_override_audit. That REOPENS SA-2209 for these six
-- functions: a typed overload in public (for example jsonb_build_object) runs
-- as the function owner on the next fn_set_staff_privilege call while any
-- role holds CREATE on public. 363 is not touched. Owner, security mode and
-- the ACLs are kept (service_role keeps EXECUTE on the RPC only); it grants
-- nothing. It refuses to run while public already holds a function named
-- like one the restored bodies call, because that code would run at once.

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
           'btrim', 'char_length', 'current_setting', 'format', 'gen_random_uuid', 'has_table_privilege',
           'jsonb_build_object', 'now', 'pg_advisory_xact_lock', 'pg_current_xact_id']);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'catalog_name_shadowed_in_public: %', v_wrong;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_users_suspension_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF (NEW.is_active AND NOT OLD.is_active AND OLD.suspended_at IS NOT NULL)
       OR (NEW.suspended_at, NEW.suspended_by, NEW.suspension_reason)
          IS DISTINCT FROM (OLD.suspended_at, OLD.suspended_by, OLD.suspension_reason) THEN
        IF has_table_privilege('public.staff_privilege_evidence', 'SELECT') THEN
            IF EXISTS (SELECT 1 FROM public.staff_privilege_evidence e
                        WHERE e.xact_id = pg_current_xact_id() AND e.target_user_id = OLD.id
                          AND e.kind IN ('rpc', 'bootstrap')) THEN
                RETURN NEW;
            END IF;
        END IF;
    END IF;
    IF NEW.is_active AND NOT OLD.is_active AND OLD.suspended_at IS NOT NULL THEN
        RAISE EXCEPTION 'account_suspended'
            USING ERRCODE = 'P0001',
                  DETAIL = OLD.id::text,
                  HINT = 'Only PATCH /admin/users/{id}/active (fn_set_staff_privilege) reactivates a suspended account.';
    END IF;
    IF (NEW.suspended_at, NEW.suspended_by, NEW.suspension_reason)
       IS DISTINCT FROM (OLD.suspended_at, OLD.suspended_by, OLD.suspension_reason) THEN
        RAISE EXCEPTION 'account_suspended_marker_protected'
            USING ERRCODE = 'P0001',
                  DETAIL = OLD.id::text,
                  HINT = 'The suspension marker is written only by fn_set_staff_privilege.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_users_suspension_role_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role AND OLD.suspended_at IS NOT NULL THEN
        IF has_table_privilege('public.staff_privilege_evidence', 'SELECT') THEN
            IF EXISTS (SELECT 1 FROM public.staff_privilege_evidence e
                        WHERE e.xact_id = pg_current_xact_id() AND e.target_user_id = OLD.id
                          AND e.kind = 'bootstrap') THEN
                RETURN NEW;
            END IF;
        END IF;
        RAISE EXCEPTION 'account_suspended_role_change'
            USING ERRCODE = 'P0001',
                  DETAIL = OLD.id::text,
                  HINT = 'Reactivate the account first (PATCH /admin/users/{id}/active), then change its role.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_set_staff_privilege(
    p_actor      uuid,
    p_target     uuid,
    p_role       text,
    p_is_active  boolean,
    p_reason     text,
    p_request_id text
) RETURNS TABLE (changed boolean, audit_id uuid, before jsonb, after jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
    v_old        public.users%ROWTYPE;
    v_actor      public.users%ROWTYPE;
    v_role       text;
    v_active     boolean;
    v_suspend    boolean;
    v_clear      boolean;
    v_before     jsonb;
    v_after      jsonb;
    v_audit      uuid := gen_random_uuid();
BEGIN
    IF p_role IS NULL AND p_is_active IS NULL THEN
        RAISE EXCEPTION 'invalid_privilege_change' USING ERRCODE = 'P0001';
    END IF;
    IF p_role IS NOT NULL AND p_role NOT IN ('admin', 'instructor', 'student') THEN
        RAISE EXCEPTION 'invalid_role' USING ERRCODE = 'P0001';
    END IF;
    IF (p_reason IS NOT NULL AND char_length(p_reason) > 500)
       OR (p_is_active IS NOT NULL
           AND (p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 3 AND 500)) THEN
        RAISE EXCEPTION 'invalid_reason' USING ERRCODE = 'P0001';
    END IF;
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'actor_not_admin' USING ERRCODE = 'P0001';
    END IF;
    IF p_actor = p_target THEN
        RAISE EXCEPTION 'self_change_forbidden' USING ERRCODE = 'P0001';
    END IF;

    -- One lock order for every caller, so concurrent calls serialize instead
    -- of deadlocking, and the checks below see the committed state.
    PERFORM 1 FROM public.users
      WHERE id IN (p_actor, p_target) OR (role = 'admin' AND is_active)
      ORDER BY id FOR UPDATE;

    SELECT * INTO v_old FROM public.users WHERE id = p_target;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'target_not_found' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_actor FROM public.users WHERE id = p_actor;
    IF NOT FOUND OR v_actor.role IS DISTINCT FROM 'admin' OR NOT v_actor.is_active
       OR v_actor.suspended_at IS NOT NULL THEN
        RAISE EXCEPTION 'actor_not_admin' USING ERRCODE = 'P0001';
    END IF;
    IF p_is_active IS NOT NULL AND v_old.role NOT IN ('admin', 'instructor') THEN
        RAISE EXCEPTION 'target_not_staff' USING ERRCODE = 'P0001';
    END IF;

    v_role    := COALESCE(p_role, v_old.role);
    v_active  := COALESCE(p_is_active, v_old.is_active);
    v_suspend := p_is_active IS FALSE AND v_old.suspended_at IS NULL;
    v_clear   := p_is_active IS TRUE AND v_old.suspended_at IS NOT NULL;
    v_before  := jsonb_build_object('role', v_old.role, 'is_active', v_old.is_active,
                                    'suspended_at', v_old.suspended_at);

    IF v_role = v_old.role AND v_active = v_old.is_active AND NOT v_suspend AND NOT v_clear THEN
        RETURN QUERY SELECT false, NULL::uuid, v_before, v_before;
        RETURN;
    END IF;

    -- Defence in depth: the actor (a different active admin) stays an admin,
    -- so this fires only if the actor rule above is ever weakened.
    IF v_old.role = 'admin' AND v_old.is_active AND NOT (v_role = 'admin' AND v_active)
       AND NOT EXISTS (SELECT 1 FROM public.users
                        WHERE role = 'admin' AND is_active AND id <> p_target) THEN
        RAISE EXCEPTION 'last_admin' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.staff_privilege_evidence
        (target_user_id, kind, audit_id, actor_user_id, reason, request_id)
    VALUES (p_target, 'rpc', v_audit, p_actor, NULLIF(btrim(p_reason), ''), NULLIF(p_request_id, ''));

    UPDATE public.users
       SET role = v_role,
           is_active = v_active,
           suspended_at      = CASE WHEN v_suspend THEN now()          WHEN v_clear THEN NULL ELSE suspended_at END,
           suspended_by      = CASE WHEN v_suspend THEN p_actor        WHEN v_clear THEN NULL ELSE suspended_by END,
           suspension_reason = CASE WHEN v_suspend THEN btrim(p_reason) WHEN v_clear THEN NULL ELSE suspension_reason END
     WHERE id = p_target
     RETURNING jsonb_build_object('role', role, 'is_active', is_active, 'suspended_at', suspended_at)
          INTO v_after;

    -- The AFTER trigger has consumed the evidence; never leave it for a later
    -- statement of the caller's transaction.
    DELETE FROM public.staff_privilege_evidence e
     WHERE e.xact_id = pg_current_xact_id() AND e.target_user_id = p_target;
    -- Only after the 332 header's partial rollback (trg_users_privilege_audit
    -- dropped) is the row missing; write the same row here instead.
    IF NOT EXISTS (SELECT 1 FROM public.staff_security_audit a WHERE a.id = v_audit) THEN
        PERFORM public.fn_staff_security_record(
            v_audit, CASE WHEN v_role IS DISTINCT FROM v_old.role THEN 'role_changed' ELSE 'active_changed' END,
            p_target, p_actor, 'admin_api', v_before, v_after, NULLIF(btrim(p_reason), ''),
            NULLIF(p_request_id, ''), '{}'::jsonb, v_old.role = 'admin' OR v_role = 'admin');
    END IF;

    RETURN QUERY SELECT true, v_audit, v_before, v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bootstrap_admin_recovery(
    p_target   uuid,
    p_operator text,
    p_reason   text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_old    public.users%ROWTYPE;
    v_before jsonb;
    v_after  jsonb;
    v_audit  uuid := gen_random_uuid();
BEGIN
    IF p_operator IS NULL OR char_length(btrim(p_operator)) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'bootstrap_operator_required' USING ERRCODE = 'P0001';
    END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
        RAISE EXCEPTION 'invalid_reason' USING ERRCODE = 'P0001';
    END IF;

    -- With no admin row at all, two bootstraps on different targets lock
    -- disjoint rows, so the row locks below cannot serialize them. One
    -- transaction-level key does (class 332; 173204 is the migration runner's,
    -- 306 the grammar quiz's). The waiter's next statement sees the committed
    -- admin only under READ COMMITTED: a REPEATABLE READ snapshot predates the
    -- wait.
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'bootstrap_requires_read_committed' USING ERRCODE = 'P0001';
    END IF;
    PERFORM pg_advisory_xact_lock(332, 1);
    PERFORM 1 FROM public.users WHERE role = 'admin' OR id = p_target ORDER BY id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.users WHERE role = 'admin' AND is_active) THEN
        RAISE EXCEPTION 'admins_exist' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_old FROM public.users WHERE id = p_target;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'target_not_found' USING ERRCODE = 'P0001';
    END IF;
    v_before := jsonb_build_object('role', v_old.role, 'is_active', v_old.is_active,
                                   'suspended_at', v_old.suspended_at);

    INSERT INTO public.staff_privilege_evidence (target_user_id, kind, audit_id, reason, operator)
    VALUES (p_target, 'bootstrap', v_audit, btrim(p_reason), btrim(p_operator));
    UPDATE public.users
       SET role = 'admin', is_active = true,
           suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL
     WHERE id = p_target
     RETURNING jsonb_build_object('role', role, 'is_active', is_active, 'suspended_at', suspended_at)
          INTO v_after;
    DELETE FROM public.staff_privilege_evidence e
     WHERE e.xact_id = pg_current_xact_id() AND e.target_user_id = p_target;
    -- The 332 header rollback keeps this function but drops the audit
    -- trigger; it stays audited by writing the same row here.
    IF NOT EXISTS (SELECT 1 FROM public.staff_security_audit a WHERE a.id = v_audit) THEN
        PERFORM public.fn_staff_security_record(
            v_audit, 'bootstrap_recovery', p_target, NULL, 'out_of_band', v_before, v_after,
            btrim(p_reason), NULL, jsonb_build_object('operator', btrim(p_operator)), true);
    END IF;
    RETURN v_audit;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_staff_security_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'staff_security_audit_append_only'
        USING ERRCODE = 'P0001',
              DETAIL = format('%s on staff_security_audit is not allowed.', TG_OP);
END;
$$;

ALTER FUNCTION public.fn_ai_model_override_audit() SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.fn_users_suspension_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_users_suspension_role_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_set_staff_privilege(uuid, uuid, text, boolean, text, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_bootstrap_admin_recovery(uuid, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_staff_security_audit_append_only() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ai_model_override_audit() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
