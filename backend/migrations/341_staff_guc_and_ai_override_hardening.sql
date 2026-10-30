-- Migration: 341_staff_guc_and_ai_override_hardening.sql
--
-- STAFF-GUC-BYPASS + MIG322-HARDEN (PC-J88; Security Auditor PC-J74 F1, F2,
-- F3, 2026-10-29; specs ADMINAAL2-0032 FR-009/FR-011/FR-019 and AIOPS-0024
-- FR-003). Number 341 assigned by the Leader on 2026-10-29. 322, 332 and 336
-- are applied and never edited: this forward file replaces function bodies
-- with the same names, arguments, return types, owner, security mode, pinned
-- search_path and ACL, except fn_ai_model_override_audit, which becomes
-- SECURITY DEFINER (F3).
--
--   F1 (P2) Session settings opened the staff guards. Any direct SQL session
--       (owner, or service_role on a direct connection; PostgREST cannot set
--       custom settings) could run
--         SET LOCAL aver.bootstrap = 'on'; SET LOCAL aver.staff_privilege = 'on';
--         UPDATE users SET role = 'admin', is_active = true, suspended_at = NULL, ...
--       and turn a suspended account into an active admin with no audit row and
--       no owner alert: the audit trigger returned NULL under aver.bootstrap
--       (332 :342-344), the suspension guard let aver.staff_privilege through
--       (332 :153-155), the role freeze let aver.bootstrap through (336
--       :81-83), and aver.actor_id / aver.audit_id / aver.reason /
--       aver.request_id let the session pick the source, actor and labels of
--       the row (332 :330-331, :369, :375-376). Reproduced on PG16/17
--       (qa/pcj-audits/pcj74/repro/repro_guc_bypass.py). Now:
--       - public.staff_privilege_evidence (new, owner-only: RLS on, no grant
--         to PUBLIC, anon, authenticated or service_role) holds one row per
--         (transaction id, target user) that fn_set_staff_privilege
--         ('rpc') or fn_bootstrap_admin_recovery ('bootstrap') writes right
--         before its single UPDATE, with the labels (audit id, actor, reason,
--         request id, operator). The audit trigger consumes the row; the
--         function deletes any leftover before it returns, so the table is
--         empty outside those calls and a row never outlives its transaction;
--       - no trigger reads a session setting any more. fn_users_privilege_audit
--         always writes exactly one row per change of role, is_active or
--         suspended_at (and the bootstrap's row even when nothing changed):
--         with 'rpc' evidence it is admin_api with the RPC's actor and labels;
--         with 'bootstrap' evidence it is the bootstrap_recovery row (source
--         out_of_band, operator in detail) that the bootstrap used to write
--         itself; otherwise it is `service` only when the session really runs
--         as service_role (current_setting('role') = 'service_role', as
--         PostgREST sets it) with a service_role JWT claim, and out_of_band
--         for everything else, with no actor, reason or request id and a
--         fresh audit id. Admin-relevant rows still get one outbox row. There
--         is no RETURN NULL path for a change any more;
--       - fn_users_suspension_guard admits a reactivation or marker change of
--         a suspended account only with 'rpc' or 'bootstrap' evidence for
--         that row, and fn_users_suspension_role_guard (336) a role change of
--         a suspended account only with 'bootstrap' evidence (FR-019: the RPC
--         stays refused). Both stay SECURITY INVOKER and look the evidence up
--         only when they would refuse, and only when the current role can read
--         the table, so service_role and client writes keep their 332/336
--         errors and no new EXECUTE grant is needed;
--       - fn_set_staff_privilege and fn_bootstrap_admin_recovery keep their
--         checks, locks, errors and return values; they write evidence
--         instead of session settings. If their audit row is missing after
--         the UPDATE (only possible after the 332 header's rollback dropped
--         trg_users_privilege_audit, which keeps the bootstrap), they write
--         that same single row themselves, as the 332 bootstrap did.
--       Residual (owner level, unchanged): the table owner can still write an
--       evidence row, call the RPC with any p_actor, replace a function or
--       drop a trigger. Each is an explicit write to an internal object or
--       DDL, not a session setting.
--   F2 (P3) The identity sequences ai_model_override_audit_id_seq and
--       ai_provider_failures_id_seq kept Supabase's default anon/authenticated
--       USAGE + SELECT (322 :37, :53). Revoked from PUBLIC, anon and
--       authenticated. service_role keeps its grant (identity inserts do not
--       need it, the FastAPI writes are unchanged).
--   F3 (P3) ai_model_override_audit was "written only by trigger" (322
--       header, 0024 FR-003), but service_role held INSERT (322 :226) because
--       the trigger function ran as the caller, and there was no TRUNCATE
--       guard. Now fn_ai_model_override_audit is SECURITY DEFINER with the
--       same body and search_path (no API role may execute it), service_role
--       keeps SELECT only, and trg_ai_model_override_audit_no_truncate (BEFORE
--       TRUNCATE, 322's append-only function) refuses TRUNCATE even for the
--       owner. services/ai_model_overrides.py upserts ai_model_overrides as
--       service_role and never writes the audit, so a PATCH still writes one
--       audit row.
--   F5 (P3) is not in this file: 345 (PC-J119) drops the six inline admin
--       read policies instead of adding the active-account check, and its
--       postcondition forbids any 'admin' literal in a policy.
--
-- Order and compatibility. Needs 322, 332 and 336 (the precondition aborts
-- with `migration_322_missing` / `migration_332_missing` /
-- `migration_336_missing`). 341 changes DB-level staff security guards and is
-- held by forward-policy.tsv as pending_feature admin_aal2. Apply it only with
-- MIGRATION_FEATURES=admin_aal2 through the advisory-locked runner, staging
-- first after SA review, then production at an explicitly authorised
-- staging -> main promotion. No backend
-- change: the deployed backend calls fn_set_staff_privilege with the same
-- arguments, never calls the bootstrap, never sets a custom setting and never
-- writes ai_model_override_audit. One transaction, lock_timeout 5s,
-- re-runnable, runs as the NOSUPERUSER owner, no business data read or
-- written. Re-running 332, 336 or 322 after 341 restores the weak bodies:
-- re-run 341 after it.
--
-- ROLLBACK (a new forward migration, never an edit of this file). It REOPENS
-- F1 (and F2/F3): the session-setting bypass works again. Paste, verbatim,
-- 332 sections 0 (fn_users_suspension_guard), 4 (fn_users_privilege_audit),
-- 5 (fn_set_staff_privilege) and 5b (fn_bootstrap_admin_recovery), 336
-- section 1 (fn_users_suspension_role_guard) and the 322 fn_ai_model_override_audit
-- block (SECURITY INVOKER again: a CREATE OR REPLACE without SECURITY DEFINER
-- resets it). CREATE OR REPLACE keeps owner and ACL. Re-grant INSERT before
-- that function runs as the caller again:
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   GRANT INSERT ON TABLE public.ai_model_override_audit TO service_role;
--   GRANT TRIGGER, REFERENCES, TRUNCATE ON public.users TO service_role;
--   DO $$ BEGIN
--       IF current_setting('server_version_num')::int >= 170000 THEN
--           EXECUTE 'GRANT MAINTAIN ON public.users TO service_role';
--       END IF;
--   END $$;
--   -- <the six function blocks, verbatim>
--   DROP TRIGGER IF EXISTS trg_ai_model_override_audit_no_truncate ON public.ai_model_override_audit;
--   GRANT USAGE, SELECT ON SEQUENCE public.ai_model_override_audit_id_seq, public.ai_provider_failures_id_seq TO anon, authenticated;
--   DROP TABLE IF EXISTS public.staff_privilege_evidence;
--   COMMIT;
-- The sequence GRANT only restores the 322 state; skip it unless that exact
-- state is required. Without the sequence and TRUNCATE parts the rollback
-- reopens F1 only.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 0. Preconditions: 322, 332 and 336 are applied.
DO $$
BEGIN
    IF to_regclass('public.ai_model_override_audit') IS NULL
       OR to_regclass('public.ai_provider_failures') IS NULL
       OR to_regprocedure('public.fn_ai_model_override_audit()') IS NULL
       OR to_regprocedure('public.fn_ai_model_override_audit_append_only()') IS NULL
       OR to_regclass('public.ai_model_override_audit_id_seq') IS NULL
       OR to_regclass('public.ai_provider_failures_id_seq') IS NULL THEN
        RAISE EXCEPTION 'migration_322_missing';
    END IF;
    IF to_regclass('public.staff_security_audit') IS NULL
       OR to_regclass('public.owner_alert_outbox') IS NULL
       OR to_regprocedure('public.fn_staff_security_record(uuid,text,uuid,uuid,text,jsonb,jsonb,text,text,jsonb,boolean)') IS NULL
       OR to_regprocedure('public.fn_set_staff_privilege(uuid,uuid,text,boolean,text,text)') IS NULL
       OR to_regprocedure('public.fn_bootstrap_admin_recovery(uuid,text,text)') IS NULL
       OR (SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'users'
              AND column_name IN ('suspended_at', 'suspended_by', 'suspension_reason')) <> 3 THEN
        RAISE EXCEPTION 'migration_332_missing';
    END IF;
    IF to_regprocedure('public.fn_users_suspension_role_guard()') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_trigger
                       WHERE tgrelid = 'public.users'::regclass
                         AND tgname = 'trg_users_suspension_role_guard') THEN
        RAISE EXCEPTION 'migration_336_missing';
    END IF;
END $$;

-- P2-SA-1 (PC-J356): a service_role trigger on users would execute as the
-- owner inside fn_set_staff_privilege and could forge evidence or replace a
-- guard. Keep ordinary row access; remove table-level control privileges.
REVOKE TRIGGER, REFERENCES, TRUNCATE ON public.users FROM service_role;
DO $$
BEGIN
    IF current_setting('server_version_num')::int >= 170000 THEN
        EXECUTE 'REVOKE MAINTAIN ON public.users FROM service_role';
    END IF;
END $$;

-- 1. F1: transaction-scoped evidence written only by the two functions.
CREATE TABLE IF NOT EXISTS public.staff_privilege_evidence (
    xact_id        xid8 NOT NULL DEFAULT pg_current_xact_id(),
    target_user_id uuid NOT NULL,
    kind           text NOT NULL CHECK (kind IN ('rpc', 'bootstrap')),
    audit_id       uuid NOT NULL,
    actor_user_id  uuid,
    reason         text,
    request_id     text,
    operator       text,
    PRIMARY KEY (xact_id, target_user_id)
);
ALTER TABLE public.staff_privilege_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staff_privilege_evidence FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.staff_privilege_evidence IS
    'ADMINAAL2-0032 (PC-J88): one row per (transaction, target) written by fn_set_staff_privilege / '
    'fn_bootstrap_admin_recovery just before their UPDATE and removed before they return. The users '
    'triggers trust only this, never a session setting. Owner-only; empty outside those calls.';

-- 332 section 0. SECURITY INVOKER: the lookup runs only when the guard would
-- refuse, and only for a role that can read the evidence (the RPC's definer
-- owner, the bootstrap's owner); any other caller is refused as before.
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

-- 336 section 1. Only the bootstrap's evidence opens the role freeze (FR-019).
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

-- 332 section 4. The definer reads (and consumes) the evidence for every
-- caller; without it the row is service or out_of_band with no labels.
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
         WHERE e.xact_id = pg_current_xact_id() AND e.target_user_id = NEW.id
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

-- 332 section 5. Same checks, locks, errors and result; evidence instead of
-- session settings.
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

-- 332 section 5b. Owner only, SECURITY INVOKER, same checks and result; the
-- audit trigger writes its one bootstrap_recovery row from the evidence.
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

-- The 332/336 ACLs, restated (CREATE OR REPLACE kept them).
REVOKE ALL ON FUNCTION public.fn_users_suspension_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_users_suspension_role_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_users_privilege_audit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_set_staff_privilege(uuid, uuid, text, boolean, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_set_staff_privilege(uuid, uuid, text, boolean, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_bootstrap_admin_recovery(uuid, text, text)
    FROM PUBLIC, anon, authenticated, service_role;

-- 2. F2: no client privilege on the 322 identity sequences.
REVOKE ALL ON SEQUENCE public.ai_model_override_audit_id_seq, public.ai_provider_failures_id_seq
    FROM PUBLIC, anon, authenticated;

-- 3. F3: the override audit is written by the definer trigger only.
CREATE OR REPLACE FUNCTION public.fn_ai_model_override_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.ai_model_override_audit (
            feature, action, new_preferred_provider, new_anthropic_model, changed_by)
        VALUES (NEW.feature, 'insert', NEW.preferred_provider, NEW.anthropic_model, NEW.updated_by);
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.preferred_provider IS NOT DISTINCT FROM NEW.preferred_provider
           AND OLD.anthropic_model IS NOT DISTINCT FROM NEW.anthropic_model
           AND OLD.feature = NEW.feature THEN
            RETURN NEW;
        END IF;
        INSERT INTO public.ai_model_override_audit (
            feature, action, old_preferred_provider, new_preferred_provider,
            old_anthropic_model, new_anthropic_model, changed_by)
        VALUES (NEW.feature, 'update', OLD.preferred_provider, NEW.preferred_provider,
                OLD.anthropic_model, NEW.anthropic_model, NEW.updated_by);
        RETURN NEW;
    END IF;
    -- DELETE: the deleting actor is unknown to the row; record NULL rather
    -- than attributing the change to the previous editor.
    INSERT INTO public.ai_model_override_audit (
        feature, action, old_preferred_provider, old_anthropic_model, changed_by)
    VALUES (OLD.feature, 'delete', OLD.preferred_provider, OLD.anthropic_model, NULL);
    RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_ai_model_override_audit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT ON TABLE public.ai_model_override_audit FROM service_role;

CREATE OR REPLACE TRIGGER trg_ai_model_override_audit_no_truncate
    BEFORE TRUNCATE ON public.ai_model_override_audit
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ai_model_override_audit_append_only();

-- 4. Postconditions: fail the release instead of leaving a silent hole.
DO $$
DECLARE
    -- MAINTAIN only exists on PG 17+; has_table_privilege rejects it on PG 16.
    all_privileges CONSTANT text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                            'REFERENCES', 'TRIGGER']
        || CASE WHEN current_setting('server_version_num')::int >= 170000
                THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END;
    v_wrong text;
BEGIN
    -- P2-SA-1: effective privileges include inherited and PUBLIC grants.
    SELECT string_agg(p.priv, ', ' ORDER BY p.priv) INTO v_wrong
      FROM unnest(ARRAY['TRIGGER', 'REFERENCES', 'TRUNCATE']
          || CASE WHEN current_setting('server_version_num')::int >= 170000
                  THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END) p(priv)
     WHERE has_table_privilege('service_role', 'public.users', p.priv);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'users_service_role_privileges_wrong: %', v_wrong;
    END IF;

    -- F1: the evidence table is owner-only, RLS on and empty.
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.staff_privilege_evidence'::regclass) THEN
        RAISE EXCEPTION 'staff_privilege_evidence_rls_off';
    END IF;
    SELECT string_agg(format('%s:%s', r.rolname, p.priv), ', ' ORDER BY r.rolname, p.priv) INTO v_wrong
      FROM (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
     CROSS JOIN unnest(all_privileges) p(priv)
     WHERE has_table_privilege(r.rolname, 'public.staff_privilege_evidence', p.priv);
    IF v_wrong IS NOT NULL
       OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
                   WHERE c.oid = 'public.staff_privilege_evidence'::regclass
                     AND a.grantee <> c.relowner) THEN
        RAISE EXCEPTION 'staff_privilege_evidence_privileges_wrong: %', v_wrong;
    END IF;
    IF EXISTS (SELECT 1 FROM public.staff_privilege_evidence) THEN
        RAISE EXCEPTION 'staff_privilege_evidence_not_empty';
    END IF;
    -- RLS is on with no policy, so a definer writes these tables only as
    -- their owner: a runner other than the 322/332 owner would break the RPC
    -- and the override PATCH instead of hardening them.
    SELECT string_agg(t.fn, ', ' ORDER BY t.fn) INTO v_wrong
      FROM (VALUES ('public.fn_set_staff_privilege(uuid,uuid,text,boolean,text,text)', 'public.staff_privilege_evidence'),
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
    SELECT string_agg(t.name, ', ' ORDER BY t.name) INTO v_wrong
      FROM (VALUES ('trg_users_suspension_guard', 'public.fn_users_suspension_guard()'),
                   ('trg_users_suspension_role_guard', 'public.fn_users_suspension_role_guard()'),
                   ('trg_users_privilege_audit', 'public.fn_users_privilege_audit()')) t(name, fn)
     WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g
                        WHERE g.tgrelid = 'public.users'::regclass AND g.tgname = t.name
                          AND g.tgenabled IN ('O', 'A') AND g.tgfoid = t.fn::regprocedure);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'staff_security_trigger_missing: %', v_wrong;
    END IF;
    SELECT string_agg(f.sig, ', ' ORDER BY f.sig) INTO v_wrong
      FROM (VALUES ('public.fn_users_suspension_guard()', false, false),
                   ('public.fn_users_suspension_role_guard()', false, false),
                   ('public.fn_users_privilege_audit()', true, false),
                   ('public.fn_set_staff_privilege(uuid,uuid,text,boolean,text,text)', true, true),
                   ('public.fn_bootstrap_admin_recovery(uuid,text,text)', false, false),
                   ('public.fn_ai_model_override_audit()', true, false)
           ) f(sig, definer, service_exec)
      JOIN pg_proc p ON p.oid = f.sig::regprocedure
     WHERE p.prosecdef IS DISTINCT FROM f.definer
        OR NOT (COALESCE(p.proconfig, '{}') @> ARRAY['search_path=public, pg_temp'])
        OR (f.sig NOT LIKE '%ai_model%' AND p.prosrc ~ 'current_setting\(''aver\.')
        OR has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM f.service_exec
        OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
        OR p.proacl IS NULL;   -- NULL = default ACL, which includes PUBLIC EXECUTE
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'staff_security_function_wrong: %', v_wrong;
    END IF;

    -- F2: the identity sequences grant nothing to PUBLIC or a client.
    SELECT string_agg(format('%s:%s:%s', s.seq, r.rolname, p.priv), ', ' ORDER BY s.seq, r.rolname, p.priv)
      INTO v_wrong
      FROM (VALUES ('public.ai_model_override_audit_id_seq', 'public.ai_model_override_audit'),
                   ('public.ai_provider_failures_id_seq', 'public.ai_provider_failures')) s(seq, tbl)
     CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
     CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) p(priv)
     WHERE pg_get_serial_sequence(s.tbl, 'id') IS DISTINCT FROM s.seq
        OR has_sequence_privilege(r.rolname, s.seq, p.priv)
        OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
                    WHERE c.oid = s.seq::regclass AND a.grantee = 0);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'ai_override_sequence_privileges_wrong: %', v_wrong;
    END IF;

    -- F3: service_role reads the audit only; clients get nothing; TRUNCATE
    -- is refused by a trigger for every role.
    SELECT string_agg(format('%s:%s', r.rolname, p.priv), ', ' ORDER BY r.rolname, p.priv) INTO v_wrong
      FROM (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
     CROSS JOIN unnest(all_privileges) p(priv)
     WHERE has_table_privilege(r.rolname, 'public.ai_model_override_audit', p.priv)
           IS DISTINCT FROM (r.rolname = 'service_role' AND p.priv = 'SELECT');
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'ai_model_override_audit_privileges_wrong: %', v_wrong;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger g
                    WHERE g.tgrelid = 'public.ai_model_override_audit'::regclass
                      AND g.tgname = 'trg_ai_model_override_audit_no_truncate' AND g.tgenabled IN ('O', 'A')
                      AND g.tgfoid = 'public.fn_ai_model_override_audit_append_only()'::regprocedure
                      AND pg_get_triggerdef(g.oid) LIKE '%BEFORE TRUNCATE ON %ai_model_override_audit FOR EACH STATEMENT%')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger g
                       WHERE g.tgrelid = 'public.ai_model_overrides'::regclass
                         AND g.tgname = 'trg_ai_model_override_audit' AND g.tgenabled IN ('O', 'A')
                         AND g.tgfoid = 'public.fn_ai_model_override_audit()'::regprocedure) THEN
        RAISE EXCEPTION 'ai_model_override_audit_trigger_missing';
    END IF;
END $$;

COMMIT;
