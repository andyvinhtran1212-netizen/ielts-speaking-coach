-- 021_vocabulary_exercises.sql
-- Phase D Wave 1: vocabulary exercises pool (D1 fill-blank now, D3 in Wave 2).
-- Admin authors content (status='draft'); only 'published' is visible to users.
-- Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS vocabulary_exercises (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    target_vocab_id  UUID         REFERENCES user_vocabulary(id) ON DELETE SET NULL,
    exercise_type    VARCHAR(8)   NOT NULL CHECK (exercise_type IN ('D1','D3')),
    content_payload  JSONB        NOT NULL,
    status           VARCHAR(16)  NOT NULL DEFAULT 'draft'
                                  CHECK (status IN ('draft','published','rejected')),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by       UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_at      TIMESTAMPTZ,
    reviewed_by      UUID         REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_vocab_exercises_status_type_created
    ON vocabulary_exercises (status, exercise_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vocab_exercises_target
    ON vocabulary_exercises (target_vocab_id)
    WHERE target_vocab_id IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Auth model in this app: users.role = 'admin' (no JWT claim, no is_admin column).
-- Policies use EXISTS against the users table so the same pattern works for any
-- request that carries auth.uid().  Admin write paths in routers/admin.py go via
-- the service-role client (supabase_admin) and bypass RLS by design.
ALTER TABLE vocabulary_exercises ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vocab_exercises_select ON vocabulary_exercises;
CREATE POLICY vocab_exercises_select ON vocabulary_exercises
    FOR SELECT
    USING (
        status = 'published'
        OR EXISTS (
            SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'
        )
    );

DROP POLICY IF EXISTS vocab_exercises_admin_write ON vocabulary_exercises;
CREATE POLICY vocab_exercises_admin_write ON vocabulary_exercises
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'
        )
    );


-- ────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SCRIPT (commented out, run manually if needed):
-- ────────────────────────────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS vocab_exercises_admin_write ON vocabulary_exercises;
-- DROP POLICY IF EXISTS vocab_exercises_select      ON vocabulary_exercises;
-- DROP INDEX  IF EXISTS idx_vocab_exercises_target;
-- DROP INDEX  IF EXISTS idx_vocab_exercises_status_type_created;
-- DROP TABLE  IF EXISTS vocabulary_exercises CASCADE;
