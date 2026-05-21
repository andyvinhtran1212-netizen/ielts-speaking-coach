-- Migration: 068_listening_test_attempts.sql
-- Sprint 13.5 — student session for Cambridge IELTS full tests
-- (40 questions across 4 sections). Distinct from
-- ``listening_sessions`` which tracks Sprint 11.5 mini-test sessions.
-- One row per student attempt; can be in-progress, submitted, or
-- abandoned. Append-only at submit time (no re-grading mutation).
-- Forward-only.

CREATE TABLE IF NOT EXISTS listening_test_attempts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id             UUID NOT NULL REFERENCES listening_tests(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    status              TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN (
                            'in_progress',
                            'submitted',
                            'abandoned'
                        )),

    -- Answer collection — JSONB array of
    -- ``[{q_num: 1, user_answer: "Brighton", answered_at: "..."}, ...]``.
    -- Updated incrementally via PATCH .../answers as the student types.
    answers             JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Grading (populated on submit).
    score               INTEGER
        CHECK (score IS NULL OR (score >= 0 AND score <= 40)),
    -- Per-question grading: array of {q_num, correct, user_answer,
    -- expected, alternatives, trap_caught, trap_missed}.
    grading_details     JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Rollup ``{trap_mechanism: {caught: int, missed: int}}``.
    trap_analytics      JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Coarse band estimate (per the IELTS Listening band-score map).
    band_estimate       NUMERIC(3,1),

    started_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    submitted_at        TIMESTAMP WITH TIME ZONE,
    audio_duration_listened_seconds  INTEGER NOT NULL DEFAULT 0,

    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listening_test_attempts_test
    ON listening_test_attempts (test_id);
CREATE INDEX IF NOT EXISTS idx_listening_test_attempts_user
    ON listening_test_attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_listening_test_attempts_user_test
    ON listening_test_attempts (user_id, test_id);
CREATE INDEX IF NOT EXISTS idx_listening_test_attempts_status
    ON listening_test_attempts (status);

ALTER TABLE listening_test_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own their test attempts" ON listening_test_attempts;
CREATE POLICY "Users own their test attempts"
    ON listening_test_attempts FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE listening_test_attempts IS
    'Sprint 13.5 — student session for Cambridge IELTS full tests. '
    'One row per attempt; status transitions in_progress → submitted '
    '(or abandoned via Phase B cron). Grading is computed once at '
    'submit and stored immutably.';
COMMENT ON COLUMN listening_test_attempts.answers IS
    'Array of {q_num, user_answer, answered_at}. Updated incrementally '
    'as the student types (PATCH /answers).';
COMMENT ON COLUMN listening_test_attempts.trap_analytics IS
    'Rollup {trap_mechanism: {caught, missed}}. Sprint 13.5 stores; '
    'Phase B analytics dashboard consumes for diagnostic feedback.';
