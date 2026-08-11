-- Migration: 203_anonymous_vocabulary_feedback_dedupe.sql
-- Bound public Vocabulary Wiki reports without trusting a browser identity.
--
-- Anonymous callers can rotate cookies and invent headers, so the durable
-- abuse boundary is the canonical inbox itself: at most one report for the
-- same public card + category + UTC day. The backend mints the key; clients
-- cannot supply it. Existing rows stay NULL and therefore cannot make this
-- forward migration fail because of historical duplicates.

ALTER TABLE user_feedback
    ADD COLUMN IF NOT EXISTS anonymous_dedupe_key TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'user_feedback_anonymous_dedupe_scope'
           AND conrelid = 'user_feedback'::regclass
    ) THEN
        ALTER TABLE user_feedback
            ADD CONSTRAINT user_feedback_anonymous_dedupe_scope
            CHECK (
                anonymous_dedupe_key IS NULL
                OR (skill = 'vocabulary' AND type = 'report' AND created_by IS NULL)
            );
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_anon_vocab_daily
    ON user_feedback (anonymous_dedupe_key)
    WHERE anonymous_dedupe_key IS NOT NULL;

COMMENT ON COLUMN user_feedback.anonymous_dedupe_key IS
'Server-minted card/category/UTC-day key for anonymous Vocabulary reports. NULL
for authenticated and non-Vocabulary feedback; unique non-NULL values make the
deduplication race-safe (migration 203).';
