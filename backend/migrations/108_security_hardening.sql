-- ============================================================================
-- Migration 108 — Security hardening (Supabase Security Advisor, production)
-- ============================================================================
--
-- Closes three classes of Advisor findings. ALL are no-behaviour-change for the
-- backend, which talks to Postgres exclusively through the service_role key
-- (service_role has BYPASSRLS and keeps EXECUTE explicitly below) — the deny is
-- aimed only at the anon / authenticated PostgREST surface.
--
--   (a) RLS-disabled on the two audit tables  → ENABLE RLS, no policy
--       (service_role bypass keeps writes/reads working; anon/authenticated get
--        deny-all, which ALSO blocks an attacker forging audit rows via anon).
--   (b) Mutable search_path on 6 functions    → pin SET search_path.
--   (c) SECURITY DEFINER functions reachable via anon/authenticated RPC
--       → REVOKE EXECUTE.
--
-- Apply: paste into Supabase SQL editor (runs as table/function owner, so the
-- owner always retains access). Idempotent — safe to re-run.
--
-- ⚠ PRE-FLIGHT NOTES (read before applying):
--   • (c) uses `FROM PUBLIC, anon, authenticated`, NOT `FROM anon, authenticated`
--     alone. These functions hold EXECUTE via the default grant to PUBLIC, so
--     revoking only anon/authenticated would be a NO-OP and the Advisor would
--     still flag them. Revoking PUBLIC is what actually denies them. service_role
--     is re-GRANTed where the backend calls the function directly (append_paste_event).
--   • is_current_user_admin()/is_current_user_instructor() are referenced inside
--     RLS policies (mig 033/106). Policy expressions execute with the CALLER's
--     rights, so an authenticated DIRECT table query that hits one of those
--     policies needs EXECUTE on the helper. The frontend issues 0 direct table
--     queries (everything goes through the backend/service_role), so this is
--     expected to be safe — but it is exactly what smoke #4 must confirm.
--
-- ⚠ 5-SMOKE GATE (run in Supabase / app BEFORE merging the PR):
--   1. backend writes an audit row (e.g. generate/revoke a code)         → OK
--   2. admin reads the audit log                                         → rows show
--   3. impersonate as instructor → governance_audit gets an 'impersonate' row
--   4. open a student page AND an admin page                             → NO 403/500
--   5. Security Advisor → Refresh                                        → 0 errors
--
-- Rollback for each section is embedded as a comment block at its end.
-- ============================================================================


-- ── (a) Enable RLS (no policy) on the audit tables ──────────────────────────
-- No policy is created on purpose: service_role bypasses RLS so the backend is
-- unaffected, while anon/authenticated fall through to RLS's default deny-all.

ALTER TABLE public.access_code_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_audit  ENABLE ROW LEVEL SECURITY;

-- Rollback (a):
-- ALTER TABLE public.access_code_audit DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.governance_audit  DISABLE ROW LEVEL SECURITY;


-- ── (b) Pin search_path on 6 functions ──────────────────────────────────────
-- Prevents a malicious search_path from shadowing referenced objects. ALTER
-- FUNCTION ... SET is idempotent and applies regardless of SECURITY DEFINER/
-- INVOKER. (append_paste_event already pins its search_path in mig 042 — not
-- repeated here.)

ALTER FUNCTION public.is_current_user_admin()                 SET search_path = public, pg_temp;
ALTER FUNCTION public.is_current_user_instructor()            SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at_column()              SET search_path = public, pg_temp;
ALTER FUNCTION public.update_instructor_reviews_updated_at()  SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_completed_session_counts(uuid[])     SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_total_grading_minutes()             SET search_path = public, pg_temp;

-- Rollback (b) — restore mutable search_path (rarely needed):
-- ALTER FUNCTION public.is_current_user_admin()                 RESET search_path;
-- ALTER FUNCTION public.is_current_user_instructor()            RESET search_path;
-- ALTER FUNCTION public.update_updated_at_column()              RESET search_path;
-- ALTER FUNCTION public.update_instructor_reviews_updated_at()  RESET search_path;
-- ALTER FUNCTION public.fn_completed_session_counts(uuid[])     RESET search_path;
-- ALTER FUNCTION public.fn_total_grading_minutes()             RESET search_path;


-- ── (c) Revoke EXECUTE on the 3 SECURITY DEFINER functions ──────────────────
-- Removes the anon/authenticated PostgREST-RPC attack surface. PUBLIC is
-- included because that is where the default EXECUTE grant lives; without it the
-- REVOKE is a no-op. The function owner always keeps EXECUTE.

-- append_paste_event: called by the backend via supabase_admin.rpc() (service_role).
-- Deny everyone else; re-grant service_role so the paste-log endpoint keeps working.
REVOKE EXECUTE ON FUNCTION public.append_paste_event(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.append_paste_event(uuid, uuid, jsonb) TO service_role;

-- is_current_user_admin / is_current_user_instructor: used only inside RLS
-- policies (no backend caller). Deny direct anon/authenticated RPC.
REVOKE EXECUTE ON FUNCTION public.is_current_user_admin()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_current_user_instructor() FROM PUBLIC, anon, authenticated;

-- Rollback (c) — restore the default PUBLIC grant (re-exposes via PostgREST):
-- GRANT EXECUTE ON FUNCTION public.append_paste_event(uuid, uuid, jsonb) TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.is_current_user_admin()      TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.is_current_user_instructor() TO PUBLIC;
