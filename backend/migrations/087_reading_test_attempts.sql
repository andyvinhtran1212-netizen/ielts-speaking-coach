-- Migration: 087_reading_test_attempts.sql
-- Sprint 20.1 — student session for L3 Reading full tests (3 passages /
-- 40 questions, timed). Clone-grade of listening_test_attempts (migration
-- 068): one row per attempt; in_progress → submitted (or abandoned).
-- Grading is computed once at submit (Sprint 20.5) and stored immutably.
-- Forward-only.
--
-- Two deliberate divergences from 068 (Reading ≠ Listening):
--   • trap_analytics  → skill_breakdown. Reading has no audio "traps"; the
--     Sprint 20.7 diagnostic aggregates accuracy by skill_tag instead. Shape:
--     {skill_tag: {correct: int, total: int}}.
--   • audio_duration_listened_seconds → time_spent_seconds. No audio; this
--     supports the D3 timer (server stamps started_at at create; submit
--     validates elapsed ≤ reading_tests.time_limit_minutes + grace).

CREATE TABLE IF NOT EXISTS reading_test_attempts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id             UUID NOT NULL REFERENCES reading_tests(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    status              TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN (
                            'in_progress',
                            'submitted',
                            'abandoned'
                        )),

    -- Answer collection — JSONB array of
    -- ``[{q_num: 1, user_answer: "...", answered_at: "..."}, ...]``.
    -- Updated incrementally via PATCH .../answers as the student answers
    -- (cloned from listening_test_attempts.answers).
    answers             JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Grading (populated on submit, immutable thereafter).
    score               INTEGER
        CHECK (score IS NULL OR (score >= 0 AND score <= 40)),
    -- Per-question results: array of {q_num, correct, user_answer, expected,
    -- alternatives, skill_tag}.
    grading_details     JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Diagnostic rollup ``{skill_tag: {correct: int, total: int}}`` (Sprint
    -- 20.7 consumes for the strengths/weaknesses report).
    skill_breakdown     JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Coarse band estimate (Academic Reading band-score map — Sprint 20.5).
    band_estimate       NUMERIC(3,1),

    started_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    submitted_at        TIMESTAMP WITH TIME ZONE,
    time_spent_seconds  INTEGER NOT NULL DEFAULT 0,

    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reading_test_attempts_test
    ON reading_test_attempts (test_id);
CREATE INDEX IF NOT EXISTS idx_reading_test_attempts_user
    ON reading_test_attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_reading_test_attempts_user_test
    ON reading_test_attempts (user_id, test_id);
CREATE INDEX IF NOT EXISTS idx_reading_test_attempts_status
    ON reading_test_attempts (status);

ALTER TABLE reading_test_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own their reading test attempts" ON reading_test_attempts;
CREATE POLICY "Users own their reading test attempts"
    ON reading_test_attempts FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE reading_test_attempts IS
    'Sprint 20.1 — student session for L3 Reading full tests. One row per '
    'attempt; status in_progress → submitted (or abandoned). Grading computed '
    'once at submit (Sprint 20.5) and stored immutably. Clone of '
    'listening_test_attempts (068); RLS user-scoped.';
COMMENT ON COLUMN reading_test_attempts.answers IS
    'Array of {q_num, user_answer, answered_at}. Updated incrementally via '
    'PATCH /answers (listening precedent).';
COMMENT ON COLUMN reading_test_attempts.skill_breakdown IS
    'Diagnostic rollup {skill_tag: {correct, total}}. Replaces listening''s '
    'trap_analytics; consumed by the Sprint 20.7 diagnostic engine.';
COMMENT ON COLUMN reading_test_attempts.started_at IS
    'Server-stamped at attempt creation. D3 anti-cheat: submit validates '
    'elapsed ≤ reading_tests.time_limit_minutes + grace (Sprint 20.5).';
