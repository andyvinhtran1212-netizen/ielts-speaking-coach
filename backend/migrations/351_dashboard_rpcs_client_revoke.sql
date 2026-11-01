-- Migration: 351_dashboard_rpcs_client_revoke.sql
-- Spec: SECWRITE-0022 FR-011 (Amendment 1, approved by Vinh 2026-10-30 06:58 UTC+7).
--
-- SECURITY (PC-J220, P3). Migration 139 left these SECURITY INVOKER RPCs
-- with the default function ACL. Staging catalog reported by PC/SA on
-- 2026-10-29 (owner postgres), for each of the four (timestamptz) signatures:
-- {=X/postgres,postgres=X/postgres,anon=X/postgres,
--  authenticated=X/postgres,service_role=X/postgres}
-- RLS currently hides ai_usage_logs and analytics_events from clients, but
-- these backend-only aggregates must not be exposed through /rest/v1/rpc.
-- Only services/admin_dashboard.py calls them, via database.supabase_admin;
-- GET /admin/dashboard/overview and /trends both require_admin. No frontend
-- or user-JWT backend caller needs EXECUTE. fn_dashboard_daily_practices is
-- outside this change and keeps its ACL.
--
-- Revoke only client EXECUTE; preserve an explicit service_role grant, adding
-- it if absent. This is mandatory: RPC failures otherwise silently fall back
-- to in-app dashboard aggregates capped at 1000 rows. Require all four exact
-- signatures to exist and remain SECURITY INVOKER. Postconditions check both
-- effective client privileges (including inherited/other-grantor grants) and
-- PUBLIC ACL entries; a surviving grant aborts the whole transaction.
-- One transaction, lock_timeout 5s, no data writes, re-runnable.
--
-- Rollout: pending_feature group dashboard_rpcs_revoke. Merging does not apply
-- it (merge KHÔNG áp). Leader/RM applies with the advisory-locked runner on
-- staging; production only at a Vinh-approved promotion. No backend deploy is
-- required. After apply, read-only verification (first four rows: f, f, t;
-- no bare =X PUBLIC entry; daily_practices is unchanged):
--   SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE'),
--          has_function_privilege('authenticated', p.oid, 'EXECUTE'),
--          has_function_privilege('service_role', p.oid, 'EXECUTE'), p.proacl
--     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
--       AND p.proname IN ('fn_dashboard_daily_tokens', 'fn_dashboard_tokens_called',
--                         'fn_dashboard_daily_visitors', 'fn_dashboard_visitors');
-- Then view /admin overview and trends; verify visitors/tokens and no RPC
-- 42501/fallback in backend logs. End QA with signOut({ scope: 'local' }).
--
-- Rollback. DO NOT USE except in an emergency: this restores the exact old
-- client ACL and reopens these backend-only aggregates to client invocation.
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   GRANT EXECUTE ON FUNCTION public.fn_dashboard_daily_tokens(timestamptz), public.fn_dashboard_tokens_called(timestamptz), public.fn_dashboard_daily_visitors(timestamptz), public.fn_dashboard_visitors(timestamptz) TO PUBLIC, anon, authenticated;
--   COMMIT;

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    signature text;
    target regprocedure;
BEGIN
    FOREACH signature IN ARRAY ARRAY[
        'public.fn_dashboard_daily_tokens(timestamptz)',
        'public.fn_dashboard_tokens_called(timestamptz)',
        'public.fn_dashboard_daily_visitors(timestamptz)',
        'public.fn_dashboard_visitors(timestamptz)'
    ] LOOP
        target := to_regprocedure(signature);
        IF target IS NULL THEN
            RAISE EXCEPTION 'dashboard_rpcs_missing: %', signature;
        END IF;
        IF (SELECT prosecdef FROM pg_proc WHERE oid = target) THEN
            RAISE EXCEPTION 'dashboard_rpcs_not_security_invoker: %', signature;
        END IF;
    END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION
    public.fn_dashboard_daily_tokens(timestamptz),
    public.fn_dashboard_tokens_called(timestamptz),
    public.fn_dashboard_daily_visitors(timestamptz),
    public.fn_dashboard_visitors(timestamptz)
FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
    signature text;
    target regprocedure;
BEGIN
    FOREACH signature IN ARRAY ARRAY[
        'public.fn_dashboard_daily_tokens(timestamptz)',
        'public.fn_dashboard_tokens_called(timestamptz)',
        'public.fn_dashboard_daily_visitors(timestamptz)',
        'public.fn_dashboard_visitors(timestamptz)'
    ] LOOP
        target := to_regprocedure(signature);
        IF NOT EXISTS (
            SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
             WHERE p.oid = target AND a.grantee = 'service_role'::regrole
               AND a.privilege_type = 'EXECUTE'
        ) THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', target);
        END IF;

        IF has_function_privilege('anon', target, 'EXECUTE')
           OR has_function_privilege('authenticated', target, 'EXECUTE') THEN
            RAISE EXCEPTION 'dashboard_rpcs_client_execute_remains: %', signature;
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_proc p
             CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
             WHERE p.oid = target AND a.grantee = 0
        ) THEN
            RAISE EXCEPTION 'dashboard_rpcs_public_acl_remains: %', signature;
        END IF;
        IF NOT has_function_privilege('service_role', target, 'EXECUTE') THEN
            RAISE EXCEPTION 'dashboard_rpcs_service_role_execute_missing: %', signature;
        END IF;
    END LOOP;
END $$;

COMMIT;
