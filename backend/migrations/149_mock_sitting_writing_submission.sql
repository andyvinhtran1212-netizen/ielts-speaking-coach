-- ============================================================================
-- Migration 149 — mock sitting writing_submission (Phase 1 native writing step)
-- ============================================================================
--
-- P1 keeps the mock Writing step self-contained: the student's two essay texts
-- are stored on the sitting, and the admin grades them directly in the review
-- console (entering the Writing band into final_bands). This avoids coupling the
-- mock flow into the assignment-based writing subsystem (students vs users,
-- submitted_by_admin NOT NULL, grading_tier plumbing) for P1.
--
-- Shape: {"task1": {"text","word_count","submitted_at"},
--         "task2": {"text","word_count","submitted_at"}}
--
-- P1.1 follow-up: promote these to real writing_essays rows under the instructor
-- tier so the AI Pass-1 draft + admin_writing grading page apply. When that
-- lands, essay_task1_id/essay_task2_id on the sitting carry the canonical link
-- and this column becomes a raw-capture fallback.
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE mock_exam_sittings
    ADD COLUMN IF NOT EXISTS writing_submission JSONB;

COMMENT ON COLUMN mock_exam_sittings.writing_submission IS
'P1 native Writing capture: {task1:{text,word_count,submitted_at}, task2:{...}}.
Admin grades from this text in the review console. Superseded by
essay_task1_id/essay_task2_id when the instructor-tier writing integration
lands (P1.1).';
