-- ============================================================================
-- Migration 156 — mock Writing grade gate: backfill sitting_id + skip marker
-- ============================================================================
--
-- Two additive changes supporting the mock-writing grading refinement
-- (2026-07-14):
--
-- 1. BACKFILL writing_essays.sitting_id — the column exists (mig 148) but was
--    never populated at promote time, so promoted mock essays can't be told
--    apart from normal self-submit/assignment essays. The service now stamps it
--    on new promotions; this backfills the ones already promoted (incl. the live
--    mock with 13 sittings) from the reverse link on mock_exam_sittings.
--
-- 2. writing_essays.grading_skipped_at — set when an admin decides NOT to grade
--    a too-short mock essay (Task 1 < 150 / Task 2 < 250 words are held pending
--    for that decision instead of auto-graded). A skipped essay is treated as
--    "ready" by the mock release gate (it never becomes 'reviewed'/'delivered',
--    yet must not block CÔNG BỐ) — the student gets the manual Writing band with
--    no per-task feedback, which is the intended outcome for an ungraded stub.
--    It stays SEALED (not 'delivered'), so nothing leaks before release.
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE writing_essays
    ADD COLUMN IF NOT EXISTS grading_skipped_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS grading_skipped_by     UUID,
    ADD COLUMN IF NOT EXISTS grading_skipped_reason TEXT;

COMMENT ON COLUMN writing_essays.grading_skipped_at IS
'Set when an admin declines to grade a too-short mock Writing essay. Non-null =
the mock release gate treats this essay as resolved (won''t block CÔNG BỐ) even
though it never reaches ''reviewed''/''delivered''. Only meaningful for mock
essays (sitting_id NOT NULL).';

-- Backfill the reverse link for already-promoted mock essays.
UPDATE writing_essays we
SET    sitting_id = s.id
FROM   mock_exam_sittings s
WHERE  we.sitting_id IS NULL
  AND (s.essay_task1_id = we.id OR s.essay_task2_id = we.id);
