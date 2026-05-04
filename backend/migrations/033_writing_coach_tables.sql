-- Migration 033: Writing Coach foundational tables
-- Purpose: Sprint W0 Phase 1 — create schema for Writing Coach Phase 1
--   (admin-only). 4 new tables: students, writing_essays, writing_feedback,
--   writing_jobs. Plus is_current_user_admin() helper used by RLS policies.
--
-- Reference: WRITING_COACH_INTEGRATION_ARCHITECTURE_V2.md
--
-- Phase 1 RLS posture: admin-only across all four tables. writing_jobs has
-- no policy declared — default deny — service role bypasses RLS for the
-- async grader. Phase 2 will extend RLS for student self-access via
-- students.user_id link.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
-- DROP POLICY IF EXISTS — safe to re-run.

-- ============================================================
-- Helper function: check if current auth.uid() is an admin user
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM users
        WHERE id = auth.uid()
        AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- Helper function: auto-bump updated_at on row UPDATE
-- (Only created if not already defined by an earlier migration.)
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Table 1: students — profile + goals + persona notes
-- (Separate from users because Phase 1 students may not have a login.
--  Phase 2 will populate user_id when student gets an account.)
-- ============================================================

CREATE TABLE IF NOT EXISTS students (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_code  TEXT UNIQUE NOT NULL,
    full_name     TEXT NOT NULL,

    -- Goals & profile
    target_band            NUMERIC(2,1) CHECK (target_band IS NULL OR (target_band >= 0 AND target_band <= 9)),
    target_date            DATE,
    persona_notes          TEXT,
    current_band_estimate  NUMERIC(2,1),

    -- Future Phase 2: link to user account when student gets login
    user_id    UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Audit
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_code        ON students(student_code);
CREATE INDEX IF NOT EXISTS idx_students_created_by  ON students(created_by);
CREATE INDEX IF NOT EXISTS idx_students_user_id     ON students(user_id) WHERE user_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_students_updated_at ON students;
CREATE TRIGGER update_students_updated_at
    BEFORE UPDATE ON students
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Table 2: writing_essays — submission record + admin review state
-- ============================================================

CREATE TABLE IF NOT EXISTS writing_essays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Who
    student_id          UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    submitted_by_admin  UUID NOT NULL REFERENCES users(id),

    -- What
    task_type          TEXT NOT NULL CHECK (task_type IN ('task1_academic', 'task1_general', 'task2')),
    prompt_text        TEXT NOT NULL,
    prompt_image_url   TEXT,
    essay_text         TEXT NOT NULL,
    word_count         INT  NOT NULL CHECK (word_count >= 0),

    -- Configuration
    analysis_level     INT  NOT NULL CHECK (analysis_level BETWEEN 1 AND 5),
    form_of_address    TEXT NOT NULL DEFAULT 'em' CHECK (form_of_address IN ('bạn', 'em', 'anh', 'chị')),
    selected_model     TEXT NOT NULL DEFAULT 'gemini-2.5-pro',

    -- Status lifecycle: pending → grading → graded → reviewed → delivered (or failed)
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',
        'grading',
        'graded',
        'reviewed',
        'delivered',
        'failed'
    )),
    error_message TEXT,

    -- Admin review
    admin_review_started_at  TIMESTAMPTZ,
    admin_reviewed_at        TIMESTAMPTZ,
    admin_edits_json         JSONB,
    admin_notes              TEXT,

    -- Delivery tracking
    delivered_at      TIMESTAMPTZ,
    delivery_method   TEXT CHECK (delivery_method IS NULL OR delivery_method IN (
        'google_docs_paste',
        'word_download',
        'gdocs_api',
        'web_view'
    )),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_writing_essays_student         ON writing_essays(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_writing_essays_status_pending  ON writing_essays(status, created_at)
    WHERE status IN ('pending', 'grading', 'graded');
CREATE INDEX IF NOT EXISTS idx_writing_essays_admin           ON writing_essays(submitted_by_admin, created_at DESC);

DROP TRIGGER IF EXISTS update_writing_essays_updated_at ON writing_essays;
CREATE TRIGGER update_writing_essays_updated_at
    BEFORE UPDATE ON writing_essays
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Table 3: writing_feedback — AI grader output (1:1 with essays)
-- ============================================================

CREATE TABLE IF NOT EXISTS writing_feedback (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    essay_id  UUID NOT NULL UNIQUE REFERENCES writing_essays(id) ON DELETE CASCADE,

    -- Top-level scores extracted from feedback_json for indexing/queries
    overall_band_score        NUMERIC(2,1) NOT NULL CHECK (overall_band_score >= 0 AND overall_band_score <= 9),
    band_main_criterion       NUMERIC(2,1),
    band_coherence_cohesion   NUMERIC(2,1),
    band_lexical_resource     NUMERIC(2,1),
    band_grammatical_range    NUMERIC(2,1),

    -- Full feedback JSON (matches WritingFeedback Pydantic schema in W1)
    feedback_json   JSONB NOT NULL,

    -- Versioning
    prompt_version  TEXT NOT NULL,

    -- AI usage
    model_used      TEXT NOT NULL,
    tokens_input    INT,
    tokens_output   INT,
    cost_usd        NUMERIC(8,4),

    -- Timing
    grading_duration_ms  INT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_writing_feedback_essay ON writing_feedback(essay_id);

-- ============================================================
-- Table 4: writing_jobs — async grading queue state
-- (Service-role only — no RLS policy, default deny.)
-- ============================================================

CREATE TABLE IF NOT EXISTS writing_jobs (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    essay_id  UUID NOT NULL REFERENCES writing_essays(id) ON DELETE CASCADE,

    job_type      TEXT  NOT NULL DEFAULT 'analyze' CHECK (job_type IN ('analyze', 'regenerate_section')),
    job_payload   JSONB,

    attempt_count INT NOT NULL DEFAULT 0,
    max_attempts  INT NOT NULL DEFAULT 3,

    status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    error_log     JSONB DEFAULT '[]'::jsonb,

    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_writing_jobs_status_queue ON writing_jobs(status, created_at)
    WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_writing_jobs_essay ON writing_jobs(essay_id);

-- ============================================================
-- RLS — admin-only Phase 1
-- ============================================================

ALTER TABLE students         ENABLE ROW LEVEL SECURITY;
ALTER TABLE writing_essays   ENABLE ROW LEVEL SECURITY;
ALTER TABLE writing_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE writing_jobs     ENABLE ROW LEVEL SECURITY;

-- Idempotent re-run safety
DROP POLICY IF EXISTS students_admin_all          ON students;
DROP POLICY IF EXISTS writing_essays_admin_all    ON writing_essays;
DROP POLICY IF EXISTS writing_feedback_admin_all  ON writing_feedback;
-- writing_jobs intentionally has no user-facing policy (service role only)

CREATE POLICY students_admin_all ON students
    FOR ALL
    USING (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

CREATE POLICY writing_essays_admin_all ON writing_essays
    FOR ALL
    USING (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

CREATE POLICY writing_feedback_admin_all ON writing_feedback
    FOR ALL
    USING (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

-- ============================================================
-- Schema documentation
-- ============================================================

COMMENT ON TABLE students         IS 'Student profiles for Writing Coach. Phase 1: admin-managed. Phase 2: link to users via user_id.';
COMMENT ON TABLE writing_essays   IS 'Submission records with metadata + admin review state.';
COMMENT ON TABLE writing_feedback IS 'AI-generated feedback per essay. 1:1 with writing_essays.';
COMMENT ON TABLE writing_jobs     IS 'Async grading queue state. Admin internal — service role only.';
COMMENT ON COLUMN writing_essays.status            IS 'Lifecycle: pending → grading → graded → reviewed → delivered (or failed).';
COMMENT ON COLUMN writing_essays.admin_edits_json  IS 'Andy edits to AI output, merged at render time.';
COMMENT ON COLUMN writing_feedback.feedback_json   IS 'Full Pydantic WritingFeedback schema serialized.';
