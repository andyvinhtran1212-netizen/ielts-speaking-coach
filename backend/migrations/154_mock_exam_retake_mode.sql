-- ============================================================================
-- Migration 154 — Retake (test lại) mode: per-student, skill-scoped, self-timed
-- ============================================================================
--
-- The existing mock exam is SEQUENTIAL: a teacher opens each section for the
-- whole class on a shared clock (advance_section). Retake mode is the opposite —
-- a teacher assigns an exam to SPECIFIC students, each doing only the skills
-- they were flagged to retake, on their OWN time window, with the web
-- auto-collecting their work (no invigilation). This migration adds:
--   1. mock_exams.exam_mode — 'sequential' (default, unchanged) | 'retake'.
--   2. mock_exam_assignments — per-student assignment (which student, which
--      skills, which time window) for a retake exam. Mirrors writing_assignments.
--   3. mock_exam_sittings columns — the per-STUDENT snapshot + per-SITTING
--      section clocks that a retake sitting needs (sequential keeps using the
--      per-EXAM {section}_started_at columns from migration 151).
--
-- v1 covers Listening/Reading/Writing only (Speaking is session-based; the
-- skills array leaves room to add it later). ADDITIVE + idempotent. Apply by
-- hand in the Supabase SQL editor.
-- ============================================================================

-- 1. Exam mode ---------------------------------------------------------------
ALTER TABLE mock_exams
    ADD COLUMN IF NOT EXISTS exam_mode TEXT NOT NULL DEFAULT 'sequential';

DO $$ BEGIN
    ALTER TABLE mock_exams
        ADD CONSTRAINT mock_exams_exam_mode_chk
        CHECK (exam_mode IN ('sequential', 'retake'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN mock_exams.exam_mode IS
'sequential (default) = teacher-gated shared-clock class exam; retake = per-
student assignment-based self-timed exam (access via mock_exam_assignments,
not cohort_id; no advance_section).';

-- 2. Per-student assignments (mirror writing_assignments) ---------------------
CREATE TABLE IF NOT EXISTS mock_exam_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    exam_id UUID NOT NULL REFERENCES mock_exams(id) ON DELETE CASCADE,
    -- Keyed on user_id (the auth uid), NOT students.id: the whole mock/retest
    -- flow is user_id-centric (mock_exam_sittings.user_id, retest_summary), so
    -- eligibility + RLS are a direct match with no students-table join.
    user_id UUID NOT NULL,

    -- Which skills THIS student must retake (subset of listening/reading/
    -- writing for v1). Defaulted from the source exam's retest_flags in the
    -- admin UI, editable per student.
    skills TEXT[] NOT NULL DEFAULT '{}',

    -- Per-student availability window; the student may start any time within it
    -- and is locked out after open_until. NULL = no bound on that side.
    open_from  TIMESTAMPTZ,
    open_until TIMESTAMPTZ,

    -- Batch bookkeeping (mirror writing_assignment_groups) + audit of the
    -- original exam whose review produced the retake decision.
    assignment_group_id UUID,
    source_exam_id      UUID REFERENCES mock_exams(id) ON DELETE SET NULL,

    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (exam_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mock_exam_assignments_exam
    ON mock_exam_assignments(exam_id);
CREATE INDEX IF NOT EXISTS idx_mock_exam_assignments_user
    ON mock_exam_assignments(user_id);

COMMENT ON TABLE mock_exam_assignments IS
'Per-student assignment of a retake mock exam (exam_mode=retake): which user,
which skills, which time window. Access to a retake exam is granted by an active
row here (not by cohort_id). One row per (exam, user).';

ALTER TABLE mock_exam_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mock_exam_assignments_admin_all ON mock_exam_assignments;
CREATE POLICY mock_exam_assignments_admin_all ON mock_exam_assignments
    FOR ALL TO authenticated
    USING      (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS mock_exam_assignments_student_read ON mock_exam_assignments;
CREATE POLICY mock_exam_assignments_student_read ON mock_exam_assignments
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_mock_exam_assignments_updated_at ON mock_exam_assignments;
CREATE TRIGGER update_mock_exam_assignments_updated_at
    BEFORE UPDATE ON mock_exam_assignments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 3. Retake sitting columns --------------------------------------------------
-- A retake sitting carries its OWN snapshot of the assignment (so the runner +
-- terminal reconciliation are skill-scoped) and its OWN per-section clocks (so
-- each student's timer is independent — sequential uses the per-exam clocks).
ALTER TABLE mock_exam_sittings
    ADD COLUMN IF NOT EXISTS assigned_skills      TEXT[],
    ADD COLUMN IF NOT EXISTS retake_open_from     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS retake_open_until    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS listening_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reading_started_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS writing_started_at   TIMESTAMPTZ;

COMMENT ON COLUMN mock_exam_sittings.assigned_skills IS
'Retake only: snapshot of the assignment''s skills at sitting creation. NULL for
a sequential sitting (which uses the exam''s configured sections). Drives which
sections the runner shows and when the sitting is considered all-submitted.';
COMMENT ON COLUMN mock_exam_sittings.listening_started_at IS
'Retake only: per-SITTING section clock start (each student times independently).
Sequential uses mock_exams.{section}_started_at instead.';
