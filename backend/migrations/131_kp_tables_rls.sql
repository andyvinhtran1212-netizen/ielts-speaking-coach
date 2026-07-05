-- ============================================================================
-- Migration 131 — RLS on the KP tables (review P1: KP tables shipped without RLS)
-- ============================================================================
--
-- knowledge_points (127), kp_evidence (128) and user_kp_mastery (129) are read
-- and written ONLY via the service-role backend (services/kp_evidence.py,
-- routers/kp.py). Like the telemetry tables in migration 076, they carry no
-- client-role access path, so the correct posture is service-role only: enable
-- RLS and DENY anon + authenticated entirely. service_role bypasses RLS, so the
-- backend is unaffected; a leaked anon/auth key can no longer read another
-- learner's evidence/mastery or tamper with the KP graph.
--
-- (kp_prerequisites, added in migration 130, is locked the same way in a Phase 2
-- migration alongside its own definition.)
--
-- Idempotent: ENABLE RLS is a no-op if already on; policies are dropped then
-- recreated. Apply by hand in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE knowledge_points ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_client_roles_knowledge_points" ON knowledge_points;
CREATE POLICY "deny_client_roles_knowledge_points" ON knowledge_points
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

ALTER TABLE kp_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_client_roles_kp_evidence" ON kp_evidence;
CREATE POLICY "deny_client_roles_kp_evidence" ON kp_evidence
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

ALTER TABLE user_kp_mastery ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_client_roles_user_kp_mastery" ON user_kp_mastery;
CREATE POLICY "deny_client_roles_user_kp_mastery" ON user_kp_mastery
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

COMMENT ON TABLE kp_evidence IS
    'RLS: service-role only (mig 131). Per-user learning signals — not exposed to client roles.';
COMMENT ON TABLE user_kp_mastery IS
    'RLS: service-role only (mig 131). Per-user KP mastery — not exposed to client roles.';
COMMENT ON TABLE knowledge_points IS
    'RLS: service-role only (mig 131). KP reference graph — not exposed to client roles.';
