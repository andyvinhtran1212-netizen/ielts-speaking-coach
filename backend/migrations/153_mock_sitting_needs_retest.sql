-- ============================================================================
-- Migration 153 — mock_exam_sittings.needs_retest (EARLY "cần test lại" mark)
-- ============================================================================
--
-- The per-skill mock_exam_reviews.retest_flags (mig 152) is only set at the
-- FINAL band-save step — after Writing has already been graded. But an admin
-- often knows a student will retake straight from the auto-graded L/R results,
-- BEFORE spending any grading budget on their Writing. This sitting-level flag
-- captures that early decision so the Writing bulk-grade can skip students who
-- are going to retake anyway (2026-07-12).
--
-- Sitting-level (student-level), admin's own judgment — no threshold. Feeds:
--   - GET /admin/mock-exams/{id}/roster (shows the flag per student)
--   - POST /admin/mock-exams/{id}/writing/bulk-grade (skips flagged sittings)
--   - GET /admin/mock-exams/{id}/retest-summary (counts early flags too)
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE mock_exam_sittings
    ADD COLUMN IF NOT EXISTS needs_retest        BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS needs_retest_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS needs_retest_by     UUID,
    ADD COLUMN IF NOT EXISTS needs_retest_reason TEXT;

COMMENT ON COLUMN mock_exam_sittings.needs_retest IS
'Admin''s EARLY (pre-grading) "this student will retake" decision, typically
made from the auto-graded L/R results before Writing is graded. When true, the
Writing bulk-grade skips this sitting (no point grading a retaker). Distinct
from mock_exam_reviews.retest_flags, which is the per-skill judgment recorded at
final band-save; save_final_bands keeps this in sync (any skill flagged → true).';
