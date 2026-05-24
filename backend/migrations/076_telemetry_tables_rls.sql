-- Migration: 076_telemetry_tables_rls.sql
-- Sprint 14.8.1 — Codex audit F2 (P1): telemetry tables shipped without RLS.
--
-- `grading_events` (migration 073) and `grammar_check_cache` (migration 075)
-- were created without ROW LEVEL SECURITY and without policies. Every other
-- production table has explicit RLS; these two are the gap. They hold
-- server-only data (provider fallback telemetry; transcript-derived cache),
-- never read by client roles — so the posture is service-role only (Andy L5):
-- deny anon + authenticated entirely. Supabase's service_role bypasses RLS, so
-- the backend (which uses the service key) is unaffected.
--
-- Idempotent: ENABLE RLS is a no-op if already enabled; policies are dropped
-- first then recreated.

-- ── grading_events ───────────────────────────────────────────────────────────
ALTER TABLE grading_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_client_roles_grading_events" ON grading_events;
CREATE POLICY "deny_client_roles_grading_events" ON grading_events
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

COMMENT ON TABLE grading_events IS
    'Sprint 14.8.1 (Codex F2): RLS enabled, service-role only. Grading/orchestrator telemetry — not exposed to client roles.';

-- ── grammar_check_cache ────────────────────────────────────────────────────────
ALTER TABLE grammar_check_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_client_roles_grammar_cache" ON grammar_check_cache;
CREATE POLICY "deny_client_roles_grammar_cache" ON grammar_check_cache
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

COMMENT ON TABLE grammar_check_cache IS
    'Sprint 14.8.1 (Codex F2): RLS enabled, service-role only. Transcript-derived grammar cache — not exposed to client roles.';
