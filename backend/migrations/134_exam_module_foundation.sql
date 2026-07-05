-- ============================================================================
-- Migration 134 — exam module foundation (Phase 3: multi-source exams)
-- ============================================================================
--
-- A lean, exam_source-first module for standalone-question exams — starting with
-- TOEIC Part 5 (single-sentence grammar/vocab MCQ, NO passage, NO IELTS band).
-- Deliberately separate from the IELTS reading_* tables (which are heavily
-- IELTS-coupled: passage_id NOT NULL, 8-tag skill CHECK, 1..40 q_num, band table)
-- so neither module carries the other's baggage. The shared layer is Knowledge
-- Points: exam questions link to a grammar KP and their solutions reuse the
-- reading_solution stepper + kp_refs, feeding the same kp_evidence store.
--
-- Served ONLY via the service-role backend (routers/exams.py strips the answer +
-- solution from the student fetch), so all three tables are RLS service-role-only
-- (deny anon/authenticated), per the migration 076 / 131 precedent.
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS exam_tests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_source   TEXT NOT NULL CHECK (exam_source IN (
                      'toeic_rc', 'toeic_lc', 'thpt_qg')),
    code          TEXT NOT NULL UNIQUE,          -- e.g. AVR-TOEIC-P5-001
    title         TEXT NOT NULL,
    part          TEXT,                          -- e.g. 'part5'
    time_limit_minutes INTEGER,
    total_questions    INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'published', 'archived')),
    meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exam_questions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id       UUID NOT NULL REFERENCES exam_tests(id) ON DELETE CASCADE,
    q_num         INTEGER NOT NULL CHECK (q_num > 0),
    question_type TEXT NOT NULL DEFAULT 'mcq_single'
                      CHECK (question_type IN ('mcq_single')),
    prompt        TEXT NOT NULL,                 -- the sentence with a blank
    options       JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{label, text}]
    answer        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {answer, alternatives}
    solution      JSONB,                          -- reading_solution stepper shape
    -- KP link (mirrors quiz_questions.grammar_article_slug): the grammar article
    -- this item tests, so a right/wrong answer feeds kp_evidence.
    grammar_slug  TEXT,
    kp_focus      TEXT CHECK (kp_focus IN ('grammar', 'vocab')),
    explanation   TEXT,                           -- plain fallback
    order_num     INTEGER NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (test_id, q_num)
);

CREATE INDEX IF NOT EXISTS idx_exam_questions_test ON exam_questions (test_id);

CREATE TABLE IF NOT EXISTS exam_attempts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL,
    test_id       UUID NOT NULL REFERENCES exam_tests(id) ON DELETE CASCADE,
    exam_source   TEXT NOT NULL,                  -- denormalized for analytics
    answers       JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{q_num, user_answer}]
    score         INTEGER,
    max_score     INTEGER,
    correct_count INTEGER,
    grading_details JSONB NOT NULL DEFAULT '[]'::jsonb, -- per-question verdicts
    status        TEXT NOT NULL DEFAULT 'submitted'
                      CHECK (status IN ('in_progress', 'submitted')),
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_exam_attempts_user ON exam_attempts (user_id, test_id);

-- ── RLS: service-role only (deny client roles), per mig 076/131 ──────────────
ALTER TABLE exam_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_client_roles_exam_tests" ON exam_tests;
CREATE POLICY "deny_client_roles_exam_tests" ON exam_tests
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

ALTER TABLE exam_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_client_roles_exam_questions" ON exam_questions;
CREATE POLICY "deny_client_roles_exam_questions" ON exam_questions
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_client_roles_exam_attempts" ON exam_attempts;
CREATE POLICY "deny_client_roles_exam_attempts" ON exam_attempts
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
