-- ============================================================================
-- Migration 155 — runtime_flags: mutation kill switch (ADR-010 / FE plan B37)
-- ============================================================================
--
-- Problem: every existing feature flag is an env var read once at process
-- start (config.py), so disabling a misbehaving mutation requires a Railway
-- variable change + restart (minutes, kills in-flight work). The FE migration
-- plan's mutation-pilot checklist requires a kill switch that takes effect
-- WITHOUT a redeploy.
--
-- Mechanism: services/runtime_flags.py reads this table per-request through a
-- short in-process cache (15 s TTL), so an admin flip via
-- PUT /admin/runtime-flags/{key} becomes effective on every instance within
-- one cache window. Rows are created lazily on first flip; a missing row
-- means "use the caller's default" (normally enabled).
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS runtime_flags (
  key        text PRIMARY KEY,
  enabled    boolean     NOT NULL DEFAULT true,
  note       text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

COMMENT ON TABLE runtime_flags IS
  'Per-request kill-switch flags (ADR-010). Read via services/runtime_flags.py with a 15s cache; flip via PUT /admin/runtime-flags/{key} — no redeploy needed.';

-- Service-role only: RLS on with NO policies denies anon/authenticated via
-- PostgREST; the backend admin client (service key) bypasses RLS.
ALTER TABLE runtime_flags ENABLE ROW LEVEL SECURITY;
