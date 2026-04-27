-- 024_attempts_session_link.sql
-- Phase D Wave 1 redesign: link each attempt back to the d1_sessions row it
-- belongs to so /sessions/{id}/complete can compute a per-session correct/wrong
-- summary without scanning the whole attempts table.
--
-- session_id is nullable for backwards compatibility — attempts submitted by
-- legacy clients (no session_id in body) keep working and just don't link.
-- ON DELETE SET NULL means deleting a session preserves the attempt rows for
-- analytics; the summary view will simply not see them under that session.
--
-- Idempotent: safe to re-apply.

ALTER TABLE vocabulary_exercise_attempts
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES d1_sessions(id) ON DELETE SET NULL;

-- Partial index — only attempts that DO link to a session need fast lookup.
CREATE INDEX IF NOT EXISTS idx_attempts_session
    ON vocabulary_exercise_attempts (session_id)
    WHERE session_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SCRIPT (commented out, run manually if needed):
-- ────────────────────────────────────────────────────────────────────────────
-- DROP INDEX  IF EXISTS idx_attempts_session;
-- ALTER TABLE vocabulary_exercise_attempts DROP COLUMN IF EXISTS session_id;
