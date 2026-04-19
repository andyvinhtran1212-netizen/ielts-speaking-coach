-- Migration 009: Access code upgrade
-- Adds session_limit, expires_at, is_active to access_codes
-- Creates user_code_assignments table for proper 1-to-many user↔code mapping

-- ── access_codes: new columns ──────────────────────────────────────────────────

ALTER TABLE access_codes
  ADD COLUMN IF NOT EXISTS session_limit INTEGER DEFAULT NULL,    -- NULL = unlimited
  ADD COLUMN IF NOT EXISTS expires_at    TIMESTAMPTZ DEFAULT NULL, -- NULL = never expires
  ADD COLUMN IF NOT EXISTS is_active     BOOLEAN NOT NULL DEFAULT true; -- false = soft-deleted

-- ── user_code_assignments ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_code_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_id     UUID NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active   BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_uca_code_id ON user_code_assignments(code_id);
CREATE INDEX IF NOT EXISTS idx_uca_user_id ON user_code_assignments(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_uca_user_code ON user_code_assignments(user_id, code_id);

-- ── Backfill: migrate existing used_by to user_code_assignments ────────────────

INSERT INTO user_code_assignments (user_id, code_id, assigned_at, is_active)
SELECT
  ac.used_by,
  ac.id,
  COALESCE(ac.used_at, ac.created_at, NOW()),
  NOT COALESCE(ac.is_revoked, false)
FROM access_codes ac
WHERE ac.used_by IS NOT NULL
ON CONFLICT (user_id, code_id) DO NOTHING;
