-- 023_d1_sessions.sql
-- Phase D Wave 1 redesign: D1 fill-blank now drives a 10-question "session"
-- so we can show progress, a summary at the end, and let users review the
-- exercises they got wrong without losing the session context.
--
-- exercise_ids holds the snapshot of exercise UUIDs picked at session start
-- so the summary endpoint can resolve each one even if a row is later
-- unpublished or deleted.
--
-- Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS d1_sessions (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    started_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    exercise_ids    UUID[]       NOT NULL,
    correct_count   INTEGER      NOT NULL DEFAULT 0,
    total_count     INTEGER      NOT NULL,
    status          TEXT         NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active','completed','abandoned'))
);

CREATE INDEX IF NOT EXISTS idx_d1_sessions_user
    ON d1_sessions (user_id, started_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Owner-scoped USING + WITH CHECK on UPDATE so a malicious caller can't
-- reassign user_id to another account (lesson from Phase B 019b / Wave 1 022b).

ALTER TABLE d1_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS d1_sessions_select ON d1_sessions;
CREATE POLICY d1_sessions_select ON d1_sessions
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS d1_sessions_insert ON d1_sessions;
CREATE POLICY d1_sessions_insert ON d1_sessions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS d1_sessions_update ON d1_sessions;
CREATE POLICY d1_sessions_update ON d1_sessions
    FOR UPDATE
    USING      (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);


-- ────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SCRIPT (commented out, run manually if needed):
-- ────────────────────────────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS d1_sessions_update ON d1_sessions;
-- DROP POLICY IF EXISTS d1_sessions_insert ON d1_sessions;
-- DROP POLICY IF EXISTS d1_sessions_select ON d1_sessions;
-- DROP INDEX  IF EXISTS idx_d1_sessions_user;
-- DROP TABLE  IF EXISTS d1_sessions CASCADE;
