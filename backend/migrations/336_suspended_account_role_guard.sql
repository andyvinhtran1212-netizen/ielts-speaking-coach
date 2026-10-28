-- Migration: 336_suspended_account_role_guard.sql
--
-- ADMINAAL2-0032 FR-019 (specs/0032-admin-aal2-staff-guard, plan.md
-- "Migration 336", task T015). Owner decision 1A, Vinh, 2026-10-28 17:53
-- (UTC+7): the role of a suspended account must not change; an admin
-- reactivates it first.
--
-- Why. Migration 332 freezes `is_active` and the suspension marker of a
-- suspended account, but not its `role`. fn_set_staff_privilege therefore
-- accepts `p_role = 'student'` on a suspended instructor. The row then keeps
-- its marker with a learner role, and reactivation is refused
-- (`target_not_staff`: FR-006 only reactivates admin/instructor), so no admin
-- can restore the account in the app. The same demotion is reachable today
-- through PATCH /admin/users/{id}/role, which still writes users.role directly.
--
-- Fix. A BEFORE UPDATE OF role trigger, trg_users_suspension_role_guard, raises
-- SQLSTATE P0001 with the message `account_suspended_role_change` (DETAIL =
-- user id) when `NEW.role IS DISTINCT FROM OLD.role AND OLD.suspended_at IS NOT
-- NULL`. It does not honour 332's RPC bypass setting, so fn_set_staff_privilege
-- is refused too, whether it changes only the role or also reactivates in the
-- same call. The same refusal applies to service-role REST, the owner and a
-- superuser. Writing the current role again is still allowed, so the RPC no-op
-- and an UPDATE that repeats the role pass. The only exemption is
-- fn_bootstrap_admin_recovery (rollout path (e), owner only). It sets
-- `aver.bootstrap = on` around its single write, which restores the target to
-- admin and clears the marker at the same time.
--
-- Trigger order. BEFORE triggers fire in name order. This one sorts after
-- 320's trg_users_guard_privileged_columns (clients are refused first) and
-- after 332's suspension guard, so an activation that also promotes the role
-- still fails with `account_suspended` (FR-018 mapping unchanged).
--
-- Precondition. A suspended row that already holds a non-staff role, which
-- the 332 RPC allowed before this migration, could never be reactivated once
-- its role is frozen. The migration therefore aborts with
-- `suspended_non_staff_account_exists` and the count, and the operator repairs
-- those rows out of band first. The check runs after CREATE TRIGGER, which
-- holds SHARE ROW EXCLUSIVE on public.users until COMMIT, so no write can slip
-- in between the check and the end of the transaction.
--
-- Order and compatibility. Apply after 332 with the advisory-locked runner and
-- MIGRATION_FEATURES=admin_aal2 (forward-policy group), staging first
-- (rollout.md S1b). One transaction, lock_timeout 5s, no row read or written
-- except the precondition count, re-runnable (CREATE OR REPLACE). No backend
-- deploy is needed: the deployed role route already fails the request on a
-- database error, and the matching backend maps it to a 409 with a Vietnamese
-- message. No account is suspended until the 0032 suspension route ships.
--
-- ROLLBACK (a new forward migration, never an edit of this file):
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   DROP TRIGGER IF EXISTS trg_users_suspension_role_guard ON public.users;
--   DROP FUNCTION IF EXISTS public.fn_users_suspension_role_guard();
--   COMMIT;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 0. Preconditions: 332 is applied.
DO $$
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'
           AND ((column_name = 'role'         AND data_type = 'text')
             OR (column_name = 'suspended_at' AND data_type = 'timestamp with time zone'))) <> 2
       OR to_regprocedure('public.fn_set_staff_privilege(uuid,uuid,text,boolean,text,text)') IS NULL
       OR to_regprocedure('public.fn_bootstrap_admin_recovery(uuid,text,text)') IS NULL THEN
        RAISE EXCEPTION 'migration_332_missing';
    END IF;
END $$;

-- 1. The role freeze (FR-019). SECURITY INVOKER: it reads only OLD/NEW and a
-- transaction-local setting.
CREATE OR REPLACE FUNCTION public.fn_users_suspension_role_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF COALESCE(current_setting('aver.bootstrap', true), '') = 'on' THEN
        RETURN NEW;
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role AND OLD.suspended_at IS NOT NULL THEN
        RAISE EXCEPTION 'account_suspended_role_change'
            USING ERRCODE = 'P0001',
                  DETAIL = OLD.id::text,
                  HINT = 'Reactivate the account first (PATCH /admin/users/{id}/active), then change its role.';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_users_suspension_role_guard()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER trg_users_suspension_role_guard
    BEFORE UPDATE OF role ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.fn_users_suspension_role_guard();

-- 2. Postconditions: fail the release instead of leaving a silent hole.
DO $$
DECLARE
    v_fn    oid := to_regprocedure('public.fn_users_suspension_role_guard()');
    v_count bigint;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger g
                    WHERE g.tgrelid = 'public.users'::regclass
                      AND g.tgname = 'trg_users_suspension_role_guard'
                      AND g.tgenabled = 'O' AND g.tgfoid = v_fn
                      AND pg_get_triggerdef(g.oid) LIKE '%BEFORE UPDATE OF role ON %users FOR EACH ROW%') THEN
        RAISE EXCEPTION 'suspension_role_guard_trigger_missing';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p
                WHERE p.oid = v_fn
                  AND (p.prosecdef
                    OR NOT (COALESCE(p.proconfig, '{}') @> ARRAY['search_path=public, pg_temp'])
                    OR has_function_privilege('anon', p.oid, 'EXECUTE')
                    OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    OR has_function_privilege('service_role', p.oid, 'EXECUTE')
                    OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
                    OR p.proacl IS NULL)) THEN
        RAISE EXCEPTION 'suspension_role_guard_function_acl_wrong';
    END IF;

    SELECT count(*) INTO v_count FROM public.users
     WHERE suspended_at IS NOT NULL AND role NOT IN ('admin', 'instructor');
    IF v_count > 0 THEN
        RAISE EXCEPTION 'suspended_non_staff_account_exists: %', v_count
            USING HINT = 'Restore a staff role out of band (SQL editor, before 336), reactivate through '
                         'fn_set_staff_privilege, then apply 336.';
    END IF;
END $$;

COMMIT;
