-- Migration: 052_personalized_d1_questions.sql
-- Sprint 10.5 — Personalized D1 from user vocab bank (Area 2, Issue #8 — "two separate apps" gap).
--
-- D1 fill-blank has historically been admin-authored (vocabulary_exercises with
-- exercise_type='D1'). Sprint 10.5 introduces a per-user pre-computed pool so
-- each learner practices exercises generated from their own confirmed vocab
-- bank instead of a generic pool everyone shares. Sprint 10.4 hooks the
-- generation: when the user confirms a pending capture (POST /pending/{id}/confirm
-- or /pending/bulk-confirm), a BackgroundTask kicks off d1_question_generator.py
-- which writes one row here per vocab.
--
-- Andy locks:
--   Q1 — AI generates at confirm time (not per-fetch).  Trades ~46KB storage
--         for zero per-exercise latency.
--   Q2 — Fill-blank only (productive recall via free-text input — server-side
--         validation against target_answer + acceptable_variants).
--   Q3 — Session selection: 70% due reviews + 30% new (per SRS state on the
--         linked user_vocabulary row's flashcard_reviews).
--   Q4 — Empty bank fallback: admin pool, marked source='admin_fallback' in
--         the session response so the UI can label them.
--   Q5 — 10 questions/session.
--
-- Generation flow (Sprint 10.5 Phase 1 — THIS PR):
--   1. confirm/bulk-confirm endpoints in vocabulary_bank.py schedule
--      generate_d1_question(vocab_id) as a FastAPI BackgroundTask.
--   2. The generator calls Claude Haiku 4.5 with the vocab's headword,
--      definition, POS, and evidence_substring. Haiku returns a fresh sentence
--      using the target word in a NEW context (variety beats memorization).
--      On failure (network, malformed JSON, validation fail), the generator
--      falls back to the evidence_substring (mask the target word in the
--      original capture context).
--   3. INSERT into user_d1_questions. UNIQUE (user_id, vocabulary_id,
--      context_sentence) prevents dupes on retry / regeneration.
--
-- Session + attempt endpoints (Sprint 10.5 Phase 2 — DEFERRED to 10.5.1):
--   Session endpoint JOINs against flashcard_reviews to split due_for_review
--   vs never_reviewed; attempt endpoint validates against target_answer +
--   acceptable_variants when the exercise carries a user_d1_questions row.
--
-- Idempotent: re-running this migration is a no-op. The backfill script
-- (scripts/backfill_d1_questions.py) walks alive confirmed vocab and skips
-- any vocab that already has a question row.

CREATE TABLE IF NOT EXISTS user_d1_questions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vocabulary_id               UUID NOT NULL REFERENCES user_vocabulary(id) ON DELETE CASCADE,

    -- Question payload
    context_sentence            TEXT NOT NULL,
    blank_position_start        INTEGER NOT NULL,
    blank_position_end          INTEGER NOT NULL,
    target_answer               TEXT NOT NULL,
    acceptable_variants         JSONB NOT NULL DEFAULT '[]'::jsonb,
    hint                        TEXT,

    -- Source tracking — distinguishes Haiku output from evidence-substring
    -- fallback. Useful for prompt-tuning analysis (DEBT-2026-05-07-A).
    source_evidence_substring   TEXT,
    generated_by                TEXT NOT NULL,
    generated_at                TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Lifecycle
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    attempt_count               INTEGER NOT NULL DEFAULT 0,
    last_used_at                TIMESTAMP WITH TIME ZONE,

    created_at                  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Dedup: a vocab + context_sentence combo lands at most once per user.
    -- Re-running the generator (e.g. backfill on a quality fix) needs a
    -- different sentence to produce a new row.
    UNIQUE (user_id, vocabulary_id, context_sentence)
);

-- Hot path: session endpoint pulls active questions per user (10 per session).
CREATE INDEX IF NOT EXISTS idx_user_d1_questions_user_active
    ON user_d1_questions (user_id, is_active);

-- Backfill + cascade lookups by vocab.
CREATE INDEX IF NOT EXISTS idx_user_d1_questions_vocab
    ON user_d1_questions (vocabulary_id);

-- RLS — users own their question rows.
ALTER TABLE user_d1_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own their D1 questions" ON user_d1_questions;
CREATE POLICY "Users own their D1 questions"
    ON user_d1_questions FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE user_d1_questions IS
    'Sprint 10.5 — pre-computed fill-blank questions generated from each user''s '
    'confirmed vocab bank (user_vocabulary). Replaces the admin-authored '
    'vocabulary_exercises pool as the primary D1 source; admin pool stays as '
    'fallback when a user''s personalized stock runs short (Andy Q4 lock).';

COMMENT ON COLUMN user_d1_questions.target_answer IS
    'Sprint 10.5 — correct fill-in answer. Never sent to the client; the '
    'attempt endpoint validates user input server-side against this column + '
    'acceptable_variants (cheating prevention).';

COMMENT ON COLUMN user_d1_questions.acceptable_variants IS
    'Sprint 10.5 — JSONB array of case-insensitive alternate spellings / forms '
    'that grade as correct. Generated alongside target_answer by Claude Haiku.';

COMMENT ON COLUMN user_d1_questions.generated_by IS
    'Sprint 10.5 — provenance tag. One of: ''haiku'' | ''gemini'' | '
    '''fallback_evidence''. ''fallback_evidence'' means the AI call failed and '
    'the generator reused the user''s original evidence_substring with the '
    'target word masked. Useful for prompt-quality analysis.';
