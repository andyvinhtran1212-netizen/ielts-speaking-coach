-- 003_admin_session_tracking.sql
-- Add error tracking and status fields for admin monitoring dashboard.
-- Run once against your Supabase database. All columns are nullable / have
-- defaults so existing rows are unaffected.

-- ── sessions: error tracking ─────────────────────────────────────────────────
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS error_code    TEXT,        -- 'stt_failed' | 'grading_failed' | 'save_failed' | 'pdf_failed'
  ADD COLUMN IF NOT EXISTS error_message TEXT,        -- human-readable description (≤500 chars)
  ADD COLUMN IF NOT EXISTS failed_step   TEXT,        -- pipeline step where failure occurred
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ, -- timestamp of most recent error
  ADD COLUMN IF NOT EXISTS pdf_status    TEXT DEFAULT 'none'; -- 'none' | 'generating' | 'completed' | 'failed'

-- ── responses: per-step status ────────────────────────────────────────────────
ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS grading_status TEXT DEFAULT 'completed', -- 'completed' | 'failed'
  ADD COLUMN IF NOT EXISTS stt_status     TEXT DEFAULT 'completed'; -- 'completed' | 'failed'

-- ── Indexes for alert / filter queries ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sessions_error_code
    ON sessions (error_code)
    WHERE error_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_started_at
    ON sessions (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_responses_grading_status
    ON responses (grading_status)
    WHERE grading_status = 'failed';
