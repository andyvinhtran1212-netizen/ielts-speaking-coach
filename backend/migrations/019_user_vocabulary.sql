-- 019_user_vocabulary.sql
-- Phase B: Personal Vocab Bank MVP
-- Creates user_vocabulary table + adds feature_flags column to users

-- ── users.feature_flags ──────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS feature_flags JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── user_vocabulary ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_vocabulary (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id       UUID        REFERENCES sessions(id) ON DELETE SET NULL,
    response_id      UUID        REFERENCES responses(id) ON DELETE SET NULL,
    headword         VARCHAR(100) NOT NULL,
    context_sentence TEXT,
    definition_vi    TEXT,
    category         VARCHAR(30) CHECK (category IN ('topic','idiom','phrasal_verb','collocation')),
    source_type      VARCHAR(20) NOT NULL CHECK (source_type IN ('used_well','needs_review','upgrade_suggested','manual')),
    reason           VARCHAR(200),
    original_word    VARCHAR(100),
    mastery_status   VARCHAR(20) NOT NULL DEFAULT 'learning' CHECK (mastery_status IN ('learning','mastered')),
    is_archived      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_vocab_user
    ON user_vocabulary(user_id);

CREATE INDEX IF NOT EXISTS idx_user_vocab_user_status
    ON user_vocabulary(user_id, mastery_status) WHERE NOT is_archived;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_vocab_unique
    ON user_vocabulary(user_id, lower(headword))
    WHERE NOT is_archived;

-- RLS
ALTER TABLE user_vocabulary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_vocabulary_select ON user_vocabulary;
CREATE POLICY user_vocabulary_select ON user_vocabulary
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_vocabulary_insert ON user_vocabulary;
CREATE POLICY user_vocabulary_insert ON user_vocabulary
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_vocabulary_update ON user_vocabulary;
CREATE POLICY user_vocabulary_update ON user_vocabulary
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_vocabulary_delete ON user_vocabulary;
CREATE POLICY user_vocabulary_delete ON user_vocabulary
    FOR DELETE USING (auth.uid() = user_id);


-- ────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SCRIPT (run manually if needed)
-- ────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS user_vocabulary;
-- ALTER TABLE users DROP COLUMN IF EXISTS feature_flags;
