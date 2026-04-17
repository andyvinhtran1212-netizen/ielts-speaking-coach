-- Migration 012: Add regrade metadata columns for admin regrade flow
-- Sessions: track regrade history at session level
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS last_regraded_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_regraded_by  TEXT,
  ADD COLUMN IF NOT EXISTS regrade_count     INTEGER DEFAULT 0;

-- Responses: track regrade history at response level
ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS last_regraded_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_regraded_by  TEXT,
  ADD COLUMN IF NOT EXISTS regrade_count     INTEGER DEFAULT 0;
