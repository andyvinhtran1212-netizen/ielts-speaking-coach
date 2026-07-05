-- ============================================================================
-- Migration 133 — RLS on kp_prerequisites (review P1: KP tables without RLS)
-- ============================================================================
--
-- Completes the KP-table RLS lockdown started in migration 131. kp_prerequisites
-- (migration 130) is the reference prerequisite graph, read/written only via the
-- service-role backend (services/kp_roadmap.py, scripts/seed_kp_prerequisites.py).
-- Like the other KP tables it has no client-role access path, so: enable RLS and
-- deny anon + authenticated (service_role bypasses). A leaked client key can no
-- longer read or tamper with the roadmap graph.
--
-- Idempotent. Apply by hand in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE kp_prerequisites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_client_roles_kp_prerequisites" ON kp_prerequisites;
CREATE POLICY "deny_client_roles_kp_prerequisites" ON kp_prerequisites
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

COMMENT ON TABLE kp_prerequisites IS
    'RLS: service-role only (mig 133). KP prerequisite graph — not exposed to client roles.';
