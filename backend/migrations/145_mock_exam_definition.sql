-- ============================================================================
-- Migration 145 — mock exam DEFINITION (4-skill full mock test, Phase 1)
-- ============================================================================
--
-- A cross-skill IELTS mock test that binds one Listening + one Reading + two
-- Writing prompts + a Speaking topic set into a single, timed, SEALED sitting.
--
-- IMPORTANT — namespace: the existing `exam_*` tables (mig 134) are the
-- standalone-question MCQ module (TOEIC/grammar/vocab, no IELTS band, no
-- sitting). This 4-skill mock is a SEPARATE feature and uses the `mock_*`
-- prefix throughout (tables, routers `/api/mock-exams`, services) so the two
-- never collide.
--
-- `mock_exams` is the admin-authored DEFINITION. The per-student attempt lives
-- in `mock_exam_sittings` (mig 146); the human-review record in
-- `mock_exam_reviews` (mig 147). Actual student work stays canonical in the
-- domain tables (reading_test_attempts / listening_test_attempts /
-- writing_essays / sessions) — the sitting only binds + coordinates.
--
-- Served ONLY via the service-role backend, so RLS denies client roles
-- (per the mig 076 / 131 / 134 precedent).
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mock_exams (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          TEXT NOT NULL UNIQUE,            -- e.g. 'MOCK-2026-08A'
    title         TEXT NOT NULL,

    -- content refs (canonical content lives in the domain tables). ON DELETE
    -- SET NULL: removing a source test must not silently delete the exam
    -- definition — null it so the admin sees the gap instead.
    listening_test_id       UUID REFERENCES listening_tests(id) ON DELETE SET NULL,
    reading_test_id         UUID REFERENCES reading_tests(id)   ON DELETE SET NULL,
    writing_task1_prompt_id UUID REFERENCES writing_prompts(id) ON DELETE SET NULL,
    writing_task2_prompt_id UUID REFERENCES writing_prompts(id) ON DELETE SET NULL,
    speaking_topic_set      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {part1:[...],part2:{...},part3:[...]}

    -- per-section time budget (minutes). Client displays; server timestamps
    -- (on the sitting) are authoritative.
    section_minutes JSONB NOT NULL DEFAULT
        '{"listening":32,"reading":60,"writing":60}'::jsonb,

    -- LIVE open gate: the admin flips this on to let students start, and off to
    -- stop taking new candidates. This is the primary gate (an admin-proctored
    -- "mở kỳ" toggle), not the time window.
    is_open       BOOLEAN NOT NULL DEFAULT false,

    -- Total time for the seated LRW block. In this exam all three sections
    -- (Listening + Reading + Writing) open together under ONE countdown; the
    -- student allocates time freely and the whole block is collected at 0.
    total_minutes INTEGER NOT NULL DEFAULT 150,

    -- Optional time window (belt-and-suspenders alongside is_open). NULL = no
    -- window; is_open still governs.
    open_from     TIMESTAMPTZ,
    open_until    TIMESTAMPTZ,

    -- optional class restriction. NULL = open to any eligible user.
    cohort_id     UUID REFERENCES cohorts(id) ON DELETE SET NULL,

    -- SLA shown to the student on the "đã thu bài" screen.
    review_sla_days INTEGER NOT NULL DEFAULT 3,

    status        TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'published', 'archived')),

    created_by    UUID,                            -- admin id (no FK, matches exam_attempts precedent)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mock_exams_published
    ON mock_exams (status) WHERE status = 'published';

-- updated_at trigger (copies the mig 047 pattern).
CREATE OR REPLACE FUNCTION update_mock_exams_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_mock_exams_updated_at ON mock_exams;
CREATE TRIGGER trg_mock_exams_updated_at
    BEFORE UPDATE ON mock_exams
    FOR EACH ROW EXECUTE FUNCTION update_mock_exams_updated_at();

-- ── RLS: service-role only (deny client roles), per mig 076/131/134 ──────────
ALTER TABLE mock_exams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_client_roles_mock_exams" ON mock_exams;
CREATE POLICY "deny_client_roles_mock_exams" ON mock_exams
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

COMMENT ON TABLE mock_exams IS
'4-skill IELTS full mock test DEFINITION (Phase 1). Binds one listening + one
reading + two writing prompts + a speaking topic set. The time gate
(open_from/until) lives here, not on cohorts. Separate from the exam_* MCQ
module (mig 134). Student work stays canonical in the domain tables; the
sitting (mig 146) binds them.';
