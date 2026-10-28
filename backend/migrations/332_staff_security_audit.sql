-- Migration: 332_staff_security_audit.sql
--
-- ADMINAAL2-0032 (specs/0032-admin-aal2-staff-guard, plan.md "Migration 332",
-- task T002). Staff privilege changes had no audit, no durable suspension and no
-- concurrency guard: PATCH /admin/users/{id}/role wrote users.role directly,
-- SQL-editor changes left no trace, and an `is_active = false` lock was undone
-- by any later access-code activation or student restore. This migration adds:
--
--   0. public.users suspension marker (suspended_at / suspended_by /
--      suspension_reason, set and cleared together, never on an active row) and
--      the BEFORE UPDATE trigger trg_users_suspension_guard. It refuses, with
--      SQLSTATE P0001 and a message starting `account_suspended`, (a) any
--      is_active false → true while suspended_at is set and (b) any marker
--      change, unless the transaction-local `aver.staff_privilege` is `on`,
--      which only fn_set_staff_privilege and fn_bootstrap_admin_recovery set.
--      It covers /auth/activate Step 3, the admin-issued-code activation,
--      fn_restore_student(p_reactivate_account) (326) and SQL-editor updates.
--      Under READ COMMITTED an activation that waits on a suspension's row lock
--      re-reads the committed row and is refused (FR-018). true → false
--      without the marker stays allowed (learner archive, rollout S7 setup).
--   1. public.staff_security_audit: append-only (row UPDATE/DELETE and TRUNCATE
--      triggers refuse even the owner), RLS on, no client access, service_role
--      SELECT + INSERT only, no FK so it survives user deletion (FR-009).
--   2. public.owner_alert_outbox (FR-011), 3. public.staff_mfa_factor_snapshot
--      and public.staff_security_sweep_cursor (FR-010, used by the T007 sweep),
--      plus a unique index on detail->>'auth_log_entry_id' so a sweep re-run
--      cannot duplicate an Auth audit-log event.
--   4. trg_users_privilege_audit (AFTER INSERT OR UPDATE OF role, is_active,
--      suspended_at): exactly one audit row per changed users row, in the same
--      transaction, for every path. source = admin_api when `aver.actor_id` is
--      set (fn_set_staff_privilege), service under a service_role JWT
--      (PostgREST), out_of_band otherwise (SQL editor, runner). Admin-relevant
--      rows (role to/from admin, or any change on an admin) also get an outbox
--      row with email-safe fields only. Instructor/learner rows: audit only (Q4).
--   5. fn_set_staff_privilege (SECURITY DEFINER, service_role only): locks the
--      actor, the target and every active admin FOR UPDATE in id order,
--      re-checks the actor under the lock (actor_not_admin), refuses a self
--      change, a non-staff active change and last_admin, then applies the
--      change, the marker and the audit attribution in one UPDATE. A repeat is
--      a no-op with no second audit row.
--   5b. fn_bootstrap_admin_recovery (SECURITY INVOKER, owner only; EXECUTE is
--      revoked from service_role too): rollout path (e). Refuses admins_exist
--      while any admin is active; otherwise restores exactly the target and
--      writes one bootstrap_recovery audit row and one outbox row.
--   6. Postconditions over columns, CHECK, triggers, RLS, grants and function
--      ACLs; the transaction aborts on any mismatch.
--
-- Session revocation itself (research.md §9.2: ban, then DELETE FROM
-- auth.sessions) is not in this file: the backend runs it on its direct
-- `postgres` connection (lot 06), so no public function can reach auth.*.
--
-- Order and compatibility: additive and re-runnable. Apply under the
-- advisory-locked runner with MIGRATION_FEATURES=admin_aal2 (forward-policy
-- group) before the 0032 backend. The deployed (N-1) backend never calls the new
-- functions; its only change is one extra audit row per users write that
-- changes role/is_active (activation, archive). The trigger is SECURITY DEFINER,
-- so caller grants cannot make it fail. No account is suspended until the 0032
-- backend ships, so the suspension guard is dormant for N-1 code.
--
-- Invariants for later migrations: never drop or disable
-- trg_users_suspension_guard while any users.suspended_at is set, and never
-- UPDATE/DELETE staff_security_audit rows (the triggers refuse it).
--
-- ROLLBACK (a new forward migration, never an edit of this file; rollout.md
-- §Rollback and repair). Tables are kept: the audit is evidence.
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   DO $$
--   BEGIN
--       IF EXISTS (SELECT 1 FROM public.users WHERE suspended_at IS NOT NULL) THEN
--           RAISE EXCEPTION 'rollback_unsafe_suspended_accounts_exist';
--       END IF;
--   END $$;
--   DROP TRIGGER IF EXISTS trg_users_privilege_audit ON public.users;
--   DROP TRIGGER IF EXISTS trg_users_suspension_guard ON public.users;
--   DROP FUNCTION IF EXISTS public.fn_users_suspension_guard();
--   DROP FUNCTION IF EXISTS public.fn_users_privilege_audit();
--   DROP FUNCTION IF EXISTS public.fn_set_staff_privilege(uuid, uuid, text, boolean, text, text);
--   COMMIT;
-- With suspended accounts present, drop only trg_users_privilege_audit and its
-- function, and keep the guard, fn_set_staff_privilege (path (d)) and
-- fn_bootstrap_admin_recovery (path (e)). The bootstrap writes its own audit
-- row, so it stays audited without the trigger.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 0. Preconditions (abort if unsafe)
DO $$
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'
           AND ((column_name = 'id'        AND data_type = 'uuid')
             OR (column_name = 'email'     AND data_type = 'text')
             OR (column_name = 'role'      AND data_type = 'text')
             OR (column_name = 'is_active' AND data_type = 'boolean'))) <> 4 THEN
        RAISE EXCEPTION 'users_privilege_columns_unexpected';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'users'
                  AND ((column_name = 'suspended_at'      AND data_type <> 'timestamp with time zone')
                    OR (column_name = 'suspended_by'      AND data_type <> 'uuid')
                    OR (column_name = 'suspension_reason' AND data_type <> 'text'))) THEN
        RAISE EXCEPTION 'users_suspension_columns_conflict';
    END IF;
    IF to_regclass('public.staff_security_audit') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'staff_security_audit'
                          AND column_name = 'detail') THEN
        RAISE EXCEPTION 'staff_security_audit_conflict';
    END IF;
    -- Clients must not be able to write role/is_active or the new marker (320).
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.users'::regclass
                      AND tgname = 'trg_users_guard_privileged_columns' AND tgenabled = 'O') THEN
        RAISE EXCEPTION 'migration_320_guard_missing';
    END IF;
END $$;

-- 0. Suspension marker on public.users (FR-006, FR-018). No FK on suspended_by:
-- deleting the acting admin must not rewrite (and so trip) the marker.
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS suspended_at      timestamptz,
    ADD COLUMN IF NOT EXISTS suspended_by      uuid,
    ADD COLUMN IF NOT EXISTS suspension_reason text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.users'::regclass
                      AND conname = 'chk_users_suspension_marker') THEN
        ALTER TABLE public.users ADD CONSTRAINT chk_users_suspension_marker CHECK (
            (suspended_at IS NULL) = (suspended_by IS NULL)
            AND (suspended_at IS NULL) = (suspension_reason IS NULL)
            AND (suspended_at IS NULL OR NOT is_active));
    END IF;
END $$;

COMMENT ON COLUMN public.users.suspended_at IS
    'ADMINAAL2-0032: NULL = not suspended (an inactive account without it was never activated). '
    'Set and cleared only by fn_set_staff_privilege / fn_bootstrap_admin_recovery.';

-- SECURITY INVOKER: it reads only OLD/NEW and a transaction-local setting.
CREATE OR REPLACE FUNCTION public.fn_users_suspension_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF COALESCE(current_setting('aver.staff_privilege', true), '') = 'on' THEN
        RETURN NEW;
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

CREATE OR REPLACE TRIGGER trg_users_suspension_guard
    BEFORE UPDATE OF is_active, suspended_at, suspended_by, suspension_reason ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.fn_users_suspension_guard();

-- 1. Append-only staff security audit (FR-009, FR-010, FR-015)
CREATE TABLE IF NOT EXISTS public.staff_security_audit (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at    timestamptz NOT NULL DEFAULT now(),
    event          text NOT NULL CHECK (event IN (
                       'role_changed', 'active_changed', 'staff_row_inserted',
                       'sessions_revoked', 'sessions_revoke_failed',
                       'mfa_factor_enrolled', 'mfa_factor_verified', 'mfa_factor_deleted',
                       'bootstrap_recovery')),
    target_user_id uuid NOT NULL,
    actor_user_id  uuid,
    source         text NOT NULL CHECK (source IN ('admin_api', 'service', 'out_of_band', 'auth')),
    before         jsonb,
    after          jsonb,
    reason         text,
    request_id     text,
    detail         jsonb
);
CREATE INDEX IF NOT EXISTS idx_staff_security_audit_target
    ON public.staff_security_audit (target_user_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_security_audit_auth_log_entry
    ON public.staff_security_audit ((detail ->> 'auth_log_entry_id'))
    WHERE detail ->> 'auth_log_entry_id' IS NOT NULL;
ALTER TABLE public.staff_security_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_security_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.staff_security_audit TO service_role;

COMMENT ON TABLE public.staff_security_audit IS
    'ADMINAAL2-0032: append-only history of staff privilege, suspension and admin MFA events. '
    'UPDATE, DELETE and TRUNCATE are refused by triggers, including for the owner.';

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

CREATE OR REPLACE TRIGGER trg_staff_security_audit_append_only
    BEFORE UPDATE OR DELETE ON public.staff_security_audit
    FOR EACH ROW EXECUTE FUNCTION public.fn_staff_security_audit_append_only();
CREATE OR REPLACE TRIGGER trg_staff_security_audit_no_truncate
    BEFORE TRUNCATE ON public.staff_security_audit
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_staff_security_audit_append_only();

-- 2. Owner alert outbox (FR-011). payload holds email-safe fields only.
CREATE TABLE IF NOT EXISTS public.owner_alert_outbox (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id        uuid NOT NULL UNIQUE REFERENCES public.staff_security_audit(id),
    event           text NOT NULL,
    payload         jsonb NOT NULL,
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error      text,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    sent_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_owner_alert_outbox_due
    ON public.owner_alert_outbox (next_attempt_at) WHERE status <> 'sent';
ALTER TABLE public.owner_alert_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_alert_outbox FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.owner_alert_outbox TO service_role;

-- 3. Admin MFA factor snapshot (backstop) and the Auth audit-log sweep cursor (FR-010)
CREATE TABLE IF NOT EXISTS public.staff_mfa_factor_snapshot (
    user_id     uuid NOT NULL,
    factor_id   uuid NOT NULL,
    factor_type text NOT NULL,
    status      text NOT NULL,
    seen_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, factor_id)
);
ALTER TABLE public.staff_mfa_factor_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_mfa_factor_snapshot FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_mfa_factor_snapshot TO service_role;

CREATE TABLE IF NOT EXISTS public.staff_security_sweep_cursor (
    name            text PRIMARY KEY,
    last_created_at timestamptz,
    last_entry_id   uuid,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.staff_security_sweep_cursor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_security_sweep_cursor FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_security_sweep_cursor TO service_role;

-- 4. Audit + outbox writer shared by the users trigger and the bootstrap, so
-- both produce the same row and payload. Owner-only (no client or service
-- EXECUTE); the trigger reaches it as SECURITY DEFINER, the bootstrap as owner.
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

-- The definer writes the audit for every caller; `current_user` is therefore
-- the owner here, so the caller is classified by the PostgREST JWT role.
CREATE OR REPLACE FUNCTION public.fn_users_privilege_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor    uuid := NULLIF(current_setting('aver.actor_id', true), '')::uuid;
    v_audit    uuid := COALESCE(NULLIF(current_setting('aver.audit_id', true), '')::uuid,
                                gen_random_uuid());
    jwt_role   text := NULLIF(current_setting('request.jwt.claim.role', true), '');
    claims     text := NULLIF(current_setting('request.jwt.claims', true), '');
    v_source   text;
    v_event    text;
    v_before   jsonb;
    v_after    jsonb;
    v_alert    boolean;
BEGIN
    -- fn_bootstrap_admin_recovery writes its own single row for this UPDATE.
    IF COALESCE(current_setting('aver.bootstrap', true), '') = 'on' THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.role IS NOT DISTINCT FROM OLD.role
           AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
           AND NEW.suspended_at IS NOT DISTINCT FROM OLD.suspended_at THEN
            RETURN NULL;
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

    IF jwt_role IS NULL AND claims IS NOT NULL THEN
        jwt_role := claims::jsonb ->> 'role';
    END IF;
    v_source := CASE WHEN v_actor IS NOT NULL THEN 'admin_api'
                     WHEN jwt_role = 'service_role' THEN 'service'
                     ELSE 'out_of_band' END;

    PERFORM public.fn_staff_security_record(
        v_audit, v_event, NEW.id, v_actor, v_source, v_before, v_after,
        NULLIF(current_setting('aver.reason', true), ''),
        NULLIF(current_setting('aver.request_id', true), ''),
        '{}'::jsonb, v_alert);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_users_privilege_audit
    AFTER INSERT OR UPDATE OF role, is_active, suspended_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.fn_users_privilege_audit();

-- 5. The privilege RPC (FR-006, FR-007). Errors are P0001 with the code as the
-- message: target_not_found, actor_not_admin, self_change_forbidden,
-- target_not_staff, last_admin, invalid_role, invalid_reason,
-- invalid_privilege_change.
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

    PERFORM set_config('aver.staff_privilege', 'on', true),
            set_config('aver.actor_id', p_actor::text, true),
            set_config('aver.reason', COALESCE(btrim(p_reason), ''), true),
            set_config('aver.request_id', COALESCE(p_request_id, ''), true),
            set_config('aver.audit_id', v_audit::text, true);

    UPDATE public.users
       SET role = v_role,
           is_active = v_active,
           suspended_at      = CASE WHEN v_suspend THEN now()          WHEN v_clear THEN NULL ELSE suspended_at END,
           suspended_by      = CASE WHEN v_suspend THEN p_actor        WHEN v_clear THEN NULL ELSE suspended_by END,
           suspension_reason = CASE WHEN v_suspend THEN btrim(p_reason) WHEN v_clear THEN NULL ELSE suspension_reason END
     WHERE id = p_target
     RETURNING jsonb_build_object('role', role, 'is_active', is_active, 'suspended_at', suspended_at)
          INTO v_after;

    -- The AFTER trigger has run; do not leak the attribution or the guard
    -- bypass to later statements of the caller's transaction.
    PERFORM set_config('aver.staff_privilege', '', true),
            set_config('aver.actor_id', '', true),
            set_config('aver.reason', '', true),
            set_config('aver.request_id', '', true),
            set_config('aver.audit_id', '', true);

    RETURN QUERY SELECT true, v_audit, v_before, v_after;
END;
$$;

-- 5b. Control-plane bootstrap (FR-017, rollout path (e)). SECURITY INVOKER and
-- no EXECUTE for PUBLIC, clients or service_role: only the owner (SQL editor,
-- runner) can call it. It never bypasses the actor rule while an eligible admin
-- exists.
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

    PERFORM set_config('aver.staff_privilege', 'on', true),
            set_config('aver.bootstrap', 'on', true);
    UPDATE public.users
       SET role = 'admin', is_active = true,
           suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL
     WHERE id = p_target
     RETURNING jsonb_build_object('role', role, 'is_active', is_active, 'suspended_at', suspended_at)
          INTO v_after;
    PERFORM set_config('aver.staff_privilege', '', true),
            set_config('aver.bootstrap', '', true);

    RETURN public.fn_staff_security_record(
        v_audit, 'bootstrap_recovery', p_target, NULL, 'out_of_band', v_before, v_after,
        btrim(p_reason), NULL, jsonb_build_object('operator', btrim(p_operator)), true);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_users_suspension_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_staff_security_audit_append_only() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_staff_security_record(uuid, text, uuid, uuid, text, jsonb, jsonb, text, text, jsonb, boolean)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_users_privilege_audit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_set_staff_privilege(uuid, uuid, text, boolean, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_set_staff_privilege(uuid, uuid, text, boolean, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_bootstrap_admin_recovery(uuid, text, text)
    FROM PUBLIC, anon, authenticated, service_role;

-- 6. Postconditions: fail the release instead of leaving a silent hole.
DO $$
DECLARE
    -- MAINTAIN only exists on PG 17+; has_table_privilege rejects it on PG 16.
    all_privileges CONSTANT text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                            'REFERENCES', 'TRIGGER']
        || CASE WHEN current_setting('server_version_num')::int >= 170000
                THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END;
    v_wrong text;
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'
           AND ((column_name = 'suspended_at'      AND data_type = 'timestamp with time zone')
             OR (column_name = 'suspended_by'      AND data_type = 'uuid')
             OR (column_name = 'suspension_reason' AND data_type = 'text'))) <> 3 THEN
        RAISE EXCEPTION 'users_suspension_columns_missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.users'::regclass
                      AND conname = 'chk_users_suspension_marker' AND contype = 'c' AND convalidated) THEN
        RAISE EXCEPTION 'users_suspension_check_missing';
    END IF;

    SELECT string_agg(t.name, ', ' ORDER BY t.name) INTO v_wrong
      FROM (VALUES ('public.users', 'trg_users_guard_privileged_columns'),
                   ('public.users', 'trg_users_suspension_guard'),
                   ('public.users', 'trg_users_privilege_audit'),
                   ('public.staff_security_audit', 'trg_staff_security_audit_append_only'),
                   ('public.staff_security_audit', 'trg_staff_security_audit_no_truncate')) t(rel, name)
     WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g
                        WHERE g.tgrelid = t.rel::regclass AND g.tgname = t.name AND g.tgenabled = 'O');
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'staff_security_trigger_missing: %', v_wrong;
    END IF;

    SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_wrong
      FROM pg_class c
     WHERE c.oid IN ('public.staff_security_audit'::regclass, 'public.owner_alert_outbox'::regclass,
                     'public.staff_mfa_factor_snapshot'::regclass,
                     'public.staff_security_sweep_cursor'::regclass)
       AND NOT c.relrowsecurity;
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'staff_security_rls_off: %', v_wrong;
    END IF;

    -- Effective privileges: clients get nothing; service_role exactly its grant.
    SELECT string_agg(format('%s:%s:%s', t.rel, r.rolname, p.priv), ', '
                      ORDER BY t.rel, r.rolname, p.priv) INTO v_wrong
      FROM (VALUES ('public.staff_security_audit',        ARRAY['SELECT', 'INSERT']),
                   ('public.owner_alert_outbox',          ARRAY['SELECT', 'INSERT', 'UPDATE']),
                   ('public.staff_mfa_factor_snapshot',   ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
                   ('public.staff_security_sweep_cursor', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
           ) t(rel, service_grant)
     CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
     CROSS JOIN unnest(all_privileges) p(priv)
     WHERE has_table_privilege(r.rolname, t.rel, p.priv)
           IS DISTINCT FROM (r.rolname = 'service_role' AND p.priv = ANY (t.service_grant));
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'staff_security_table_privileges_wrong: %', v_wrong;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a
                CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
                WHERE a.attrelid = 'public.users'::regclass
                  AND a.attname IN ('role', 'is_active', 'suspended_at', 'suspended_by', 'suspension_reason')
                  AND has_column_privilege(r.rolname, a.attrelid, a.attnum, 'UPDATE')) THEN
        RAISE EXCEPTION 'users_privilege_columns_client_writable';   -- 320 invariant
    END IF;

    -- Function security, search_path and EXECUTE (PUBLIC is grantee 0).
    SELECT string_agg(f.sig, ', ' ORDER BY f.sig) INTO v_wrong
      FROM (VALUES ('public.fn_users_suspension_guard()', false, false),
                   ('public.fn_staff_security_audit_append_only()', false, false),
                   ('public.fn_staff_security_record(uuid,text,uuid,uuid,text,jsonb,jsonb,text,text,jsonb,boolean)', false, false),
                   ('public.fn_users_privilege_audit()', true, false),
                   ('public.fn_set_staff_privilege(uuid,uuid,text,boolean,text,text)', true, true),
                   ('public.fn_bootstrap_admin_recovery(uuid,text,text)', false, false)
           ) f(sig, definer, service_exec)
      JOIN pg_proc p ON p.oid = f.sig::regprocedure
     WHERE p.prosecdef IS DISTINCT FROM f.definer
        OR NOT (COALESCE(p.proconfig, '{}') @> ARRAY['search_path=public, pg_temp'])
        OR has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM f.service_exec
        OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
        OR p.proacl IS NULL;   -- NULL = default ACL, which includes PUBLIC EXECUTE
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'staff_security_function_acl_wrong: %', v_wrong;
    END IF;
END $$;

COMMIT;
