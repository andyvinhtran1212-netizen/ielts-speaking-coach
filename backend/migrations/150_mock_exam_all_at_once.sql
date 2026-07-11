-- ============================================================================
-- Migration 150 — mock exam "all-at-once" model (additive over 145/146)
-- ============================================================================
--
-- The 4-skill mock foundation (mig 145/146, merged) modelled a SEQUENTIAL LRW
-- flow. Product decision: the three sections open TOGETHER under one total timer,
-- and the admin opens the exam LIVE. This migration adapts the already-created
-- tables IN PLACE (ALTER, not re-CREATE) so environments that already applied
-- 145/146 pick up the change — a re-edit of the original CREATE TABLE scripts
-- would silently no-op on those environments.
--
--   • mock_exams: + is_open (admin live toggle) + total_minutes (one countdown)
--   • mock_exam_sittings: collapse the per-section statuses
--     (lrw_listening/lrw_reading/lrw_writing) into a single lrw_in_progress
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor.
-- ============================================================================

-- ── mock_exams: live-open toggle + total block time ─────────────────────────
ALTER TABLE mock_exams
    ADD COLUMN IF NOT EXISTS is_open       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE mock_exams
    ADD COLUMN IF NOT EXISTS total_minutes INTEGER NOT NULL DEFAULT 150;

COMMENT ON COLUMN mock_exams.is_open IS
'Admin LIVE open toggle — students can start only while true (the primary
"mở kỳ" gate; the open_from/until window stays optional/secondary).';
COMMENT ON COLUMN mock_exams.total_minutes IS
'Total time for the seated LRW block. All three sections open together under one
countdown; the whole block is collected at 0.';

-- ── mock_exam_sittings: single lrw_in_progress state ────────────────────────
-- Nothing is live yet, so there are no rows carrying the old per-section
-- statuses to migrate; we just widen/replace the CHECK. The inline CHECK from
-- mig 146 is auto-named <table>_status_check.
ALTER TABLE mock_exam_sittings
    DROP CONSTRAINT IF EXISTS mock_exam_sittings_status_check;
ALTER TABLE mock_exam_sittings
    ADD CONSTRAINT mock_exam_sittings_status_check CHECK (status IN (
        'registered', 'lrw_in_progress',
        'lrw_submitted', 'speaking_pending', 'all_submitted',
        'under_review', 'reviewed', 'released', 'void'));
