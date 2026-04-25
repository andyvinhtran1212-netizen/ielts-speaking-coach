-- 022_vocabulary_exercise_attempts.sql
-- Phase D Wave 1: per-attempt log for vocabulary exercises.
-- Used for grading history AND for the rate-limiter (count rows per user per UTC day).
-- Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS vocabulary_exercise_attempts (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID         NOT NULL REFERENCES auth.users(id)       ON DELETE CASCADE,
    exercise_id   UUID         NOT NULL REFERENCES vocabulary_exercises(id) ON DELETE CASCADE,
    exercise_type VARCHAR(8)   NOT NULL CHECK (exercise_type IN ('D1','D3')),
    user_answer   TEXT,
    is_correct    BOOLEAN,
    score         REAL,
    feedback      JSONB,
    attempted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Rate-limit index: cheap "how many attempts today by this user" lookup.
CREATE INDEX IF NOT EXISTS idx_vocab_attempts_user_attempted
    ON vocabulary_exercise_attempts (user_id, attempted_at DESC);

-- Useful when displaying per-exercise attempt history.
CREATE INDEX IF NOT EXISTS idx_vocab_attempts_exercise
    ON vocabulary_exercise_attempts (exercise_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE vocabulary_exercise_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vocab_attempts_select ON vocabulary_exercise_attempts;
CREATE POLICY vocab_attempts_select ON vocabulary_exercise_attempts
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS vocab_attempts_insert ON vocabulary_exercise_attempts;
CREATE POLICY vocab_attempts_insert ON vocabulary_exercise_attempts
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Attempts are append-only from the user's perspective (no UPDATE/DELETE policy
-- on purpose).  The service-role admin client retains full access for ops.


-- ────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SCRIPT (commented out, run manually if needed):
-- ────────────────────────────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS vocab_attempts_insert ON vocabulary_exercise_attempts;
-- DROP POLICY IF EXISTS vocab_attempts_select ON vocabulary_exercise_attempts;
-- DROP INDEX  IF EXISTS idx_vocab_attempts_exercise;
-- DROP INDEX  IF EXISTS idx_vocab_attempts_user_attempted;
-- DROP TABLE  IF EXISTS vocabulary_exercise_attempts CASCADE;
