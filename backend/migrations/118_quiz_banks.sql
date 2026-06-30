-- ============================================================================
-- Migration 118 — quiz_banks + quiz_questions (Quick-Check quiz, Pha 1)
-- ============================================================================
-- Admin-authored adaptive quiz banks (one per topic+code, e.g. L14). The .md
-- bank format (META block + exercise blocks) is parsed by services/quiz_import.py
-- and persisted here (Railway fs is ephemeral; same reason vocab moved to DB).
--
-- This is the shared exercise engine for BOTH vocab quizzes (now) and grammar
-- exercises (Pha 4) — distinguished by quiz_banks.skill_area. quiz_questions
-- carries every input shape (choice/text/boolean/syllable/match) so one schema
-- serves all question types.
--
-- Quiz answers live in quiz_questions → service-role read only (no public
-- policy); the backend serves them to authenticated students (client grades
-- instant, per QĐ-5). quiz_banks metadata is public-read.
--
-- ADDITIVE. Depends on mig 117 (content_topics). Apply by hand BEFORE merge.
-- ============================================================================

CREATE TABLE IF NOT EXISTS quiz_banks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id      UUID REFERENCES content_topics (id) ON DELETE CASCADE,

    code          TEXT NOT NULL,                 -- "L14"
    title         TEXT,
    skill_area    TEXT NOT NULL DEFAULT 'vocab', -- 'vocab' | 'grammar' | …
    meta          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- full META block (mode, correct_to_master, …)
    words_count   INT  NOT NULL DEFAULT 0,
    source        TEXT,
    version       INT  NOT NULL DEFAULT 1,
    is_published  BOOLEAN NOT NULL DEFAULT TRUE,
    import_batch_id TEXT,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One bank per (skill_area, topic, code): re-importing the same code UNDER A
    -- DIFFERENT topic creates a separate bank rather than silently moving/
    -- overwriting the first topic's bank. topic_id is required at import time.
    UNIQUE (skill_area, topic_id, code)
);

CREATE INDEX IF NOT EXISTS idx_quiz_banks_topic ON quiz_banks (topic_id);
CREATE INDEX IF NOT EXISTS idx_quiz_banks_skill_area ON quiz_banks (skill_area);

DROP TRIGGER IF EXISTS trg_quiz_banks_updated_at ON quiz_banks;
CREATE TRIGGER trg_quiz_banks_updated_at
    BEFORE UPDATE ON quiz_banks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- quiz_banks: metadata public-read (drives browse); writes service-role only.
ALTER TABLE quiz_banks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quiz_banks_public_read ON quiz_banks;
CREATE POLICY quiz_banks_public_read ON quiz_banks
    FOR SELECT USING (true);


CREATE TABLE IF NOT EXISTS quiz_questions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id       UUID NOT NULL REFERENCES quiz_banks (id) ON DELETE CASCADE,

    qid           TEXT NOT NULL,                 -- "vocation_v1" (unique per bank)
    item_key      TEXT NOT NULL,                 -- headword/concept → pool grouping
    type          TEXT NOT NULL,                 -- mcq|gap_mcq|gap_text|spelling|missing_letters|stress|syllable_count|boolean|match
    subtype       TEXT,
    input         TEXT NOT NULL,                 -- choice|text|boolean|syllable|match
    skill         TEXT NOT NULL,
    pair          TEXT,                          -- meaning|colloc|gap
    counts_toward_mastery BOOLEAN NOT NULL DEFAULT TRUE,

    prompt        TEXT NOT NULL,
    options       JSONB,                         -- choice
    answer        INT,                           -- choice/syllable: 0-based index
    accept        JSONB,                         -- text: accepted answers
    segments      JSONB,                         -- syllable
    mask          TEXT,                          -- missing_letters
    pairs         JSONB,                         -- match
    explain       TEXT,
    points        INT NOT NULL DEFAULT 1,

    audio_url     TEXT,                          -- resolved at import (headword → vocab_cards.audio_headword)
    grammar_article_slug TEXT,                   -- Pha 4 forward-compat (null for vocab)
    "order"       INT NOT NULL DEFAULT 0,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (bank_id, qid)
);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_bank ON quiz_questions (bank_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_bank_item ON quiz_questions (bank_id, item_key);

-- quiz_questions hold answers → service-role only (RLS on, NO policy). The
-- backend reads via supabase_admin and serves to authenticated students.
ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;

-- ── Atomic question replacement (re-import) ─────────────────────────────────
-- The importer replaces a bank's whole question set on re-import. PostgREST
-- can't span calls in a transaction, so do delete-all + insert-all inside ONE
-- plpgsql function body (implicit transaction): no empty-bank window and no
-- new/stale mix on a partial failure (all-or-nothing). CREATE OR REPLACE →
-- safe to re-run this migration. Called via supabase_admin.rpc (service-role).
CREATE OR REPLACE FUNCTION quiz_replace_questions(p_bank_id UUID, p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE n INTEGER;
BEGIN
    DELETE FROM quiz_questions WHERE bank_id = p_bank_id;
    INSERT INTO quiz_questions (
        bank_id, qid, item_key, type, subtype, input, skill, pair,
        counts_toward_mastery, prompt, options, answer, accept, segments,
        mask, pairs, explain, points, audio_url, grammar_article_slug, "order")
    SELECT p_bank_id, x.qid, x.item_key, x.type, x.subtype, x.input, x.skill, x.pair,
        COALESCE(x.counts_toward_mastery, TRUE), x.prompt, x.options, x.answer, x.accept,
        x.segments, x.mask, x.pairs, x.explain, COALESCE(x.points, 1), x.audio_url,
        x.grammar_article_slug, COALESCE(x."order", 0)
    FROM jsonb_to_recordset(p_rows) AS x(
        qid TEXT, item_key TEXT, type TEXT, subtype TEXT, input TEXT, skill TEXT, pair TEXT,
        counts_toward_mastery BOOLEAN, prompt TEXT, options JSONB, answer INT, accept JSONB,
        segments JSONB, mask TEXT, pairs JSONB, explain TEXT, points INT, audio_url TEXT,
        grammar_article_slug TEXT, "order" INT);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END; $$;

-- ── Reverse (run manually if needed) ────────────────────────────────────────
-- DROP FUNCTION IF EXISTS quiz_replace_questions(UUID, JSONB);
-- DROP TABLE IF EXISTS quiz_questions;
-- DROP TABLE IF EXISTS quiz_banks;
