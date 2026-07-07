-- 138_dictation_sessions.sql
-- Persisted completion report for test-linked dictation ("chép chính tả").
--
-- Dictation grading was stateless (POST /tests/dictation/grade returns a result
-- and persists nothing). This table stores one row per completed dictation
-- section so the learner gets a summary report (time / accuracy / error trends),
-- admins can review + analyse content quality, and the per-word error data is
-- captured for a future roadmap (kp_evidence) integration.
--
-- Conventions: db-migrate skill (UUID pk, TIMESTAMPTZ default now(), TEXT not
-- VARCHAR). RLS mirrors user_feedback (mig 100): user reads own rows, admins
-- read all; the backend writes via the service-role client (bypasses RLS).

CREATE TABLE IF NOT EXISTS dictation_sessions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Keep the report even if the test is later hard-deleted → SET NULL + a
    -- denormalised human id for admin grouping/display.
    test_id            UUID REFERENCES listening_tests(id) ON DELETE SET NULL,
    test_id_external   TEXT,
    section_num        INTEGER,
    section_title      TEXT,
    total_sentences    INTEGER NOT NULL DEFAULT 0,
    correct_count      INTEGER NOT NULL DEFAULT 0,   -- sentences with score >= 1.0
    accuracy           NUMERIC(5,4) NOT NULL DEFAULT 0,  -- mean per-sentence score [0..1]
    total_words        INTEGER NOT NULL DEFAULT 0,
    correct_words      INTEGER NOT NULL DEFAULT 0,
    total_time_seconds INTEGER,
    -- Per-sentence detail: [{sentence_idx, user_text, score, correct_words,
    -- total_words, listen_count, time_seconds, ops:{miss,wrong,extra}}]
    results            JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Aggregated trends: {op_counts:{miss,wrong,extra},
    -- top_missed:[{word,count}], top_wrong:[{expected,count}]}
    error_trends       JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at         TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "My recent sessions" + admin newest-first list.
CREATE INDEX IF NOT EXISTS ix_dictation_sessions_user
    ON dictation_sessions (user_id, created_at DESC);
-- Per-test analytics (aggregate accuracy / error trends for a test section).
CREATE INDEX IF NOT EXISTS ix_dictation_sessions_test
    ON dictation_sessions (test_id_external, section_num, created_at DESC);

-- RLS defensive only — backend uses the service-role client (bypasses RLS) and
-- gates admin reads with require_admin. Mirrors user_feedback (mig 100).
ALTER TABLE dictation_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own dictation sessions" ON dictation_sessions;
CREATE POLICY "users read own dictation sessions"
    ON dictation_sessions FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "admins read dictation sessions" ON dictation_sessions;
CREATE POLICY "admins read dictation sessions"
    ON dictation_sessions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'
    ));
