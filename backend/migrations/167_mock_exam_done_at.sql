-- 167_mock_exam_done_at.sql
--
-- B3: give the FINAL advance a grace anchor.
--
-- The straggler sweep runs as a background task, so the live console suppresses
-- its "chưa thu đủ / missed" verdict for _SWEEP_GRACE_SECONDS after the
-- transition that queued it. The anchor is `{active}_started_at` — which exists
-- for listening/reading/writing and for nothing else.
--
-- When the last section advances to 'done', `active` is no longer one of those,
-- so _sweep_grace_elapsed() found no anchor and returned True immediately. A
-- poll taken while the perfectly-healthy final sweep is still running therefore
-- labelled every not-yet-processed paper 'missed', told the invigilator the
-- sweep had been interrupted, and offered a "thu lại" button that would race
-- the sweep still in flight (Codex review, PR #844).
--
-- 'done' is a real transition with a real time; it just had nowhere to record
-- it. This is that column.

ALTER TABLE mock_exams
    ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;

COMMENT ON COLUMN mock_exams.done_at IS
  'Sequential mode. When the exam advanced to active_section = ''done'' — i.e. '
  'when the FINAL straggler sweep was queued. Read as the grace anchor for the '
  'live console''s missed-paper verdict, exactly as {section}_started_at is for '
  'the other transitions.';

-- Backfill: exams already sitting at 'done' predate the column. Leaving them
-- NULL keeps the old behaviour for them (no anchor → grace considered elapsed),
-- which is correct: their sweep finished long ago, so nothing should be
-- suppressed. No UPDATE needed.

-- ── VERIFY (read-only)
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'mock_exams' AND column_name = 'done_at';
