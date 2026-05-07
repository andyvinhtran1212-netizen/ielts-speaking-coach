-- Migration: 040_spam_detection.sql
-- Mô tả: Phase 2.6 — spam / quality flag bookkeeping.
--
-- Two-level storage:
--   • writing_essays — per-row flag + reason array (immutable once
--     stamped; the audit trail of WHY a specific submission was
--     refused grading).
--   • students       — rolling counter + manual review bit so the
--     admin UI can spot repeat offenders without scanning the full
--     essays table.
--
-- We deliberately do NOT touch writing_feedback. A flagged essay
-- never gets a feedback row — `writing_feedback.overall_band_score`
-- is NOT NULL with CHECK >= 0, and inserting a stub score (0.0,
-- NULL, or anything else) would skew every "average band by
-- student" / "graded essay count" query downstream. The frontend
-- branches on `writing_essays.is_flagged` and renders the
-- explanation block from `flag_reasons` instead.
--
-- Auto-promotion to is_under_review is handled in
-- routers/writing_student.py at submit time (threshold = 3 flagged
-- submissions). Doing it in the API layer rather than a DB trigger
-- keeps the threshold version-controlled with the rest of the
-- detection logic.

-- ── writing_essays — per-row flag ────────────────────────────────
ALTER TABLE writing_essays
    ADD COLUMN IF NOT EXISTS is_flagged    BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS flag_reasons  TEXT[]      NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS flagged_at    TIMESTAMP WITH TIME ZONE;

-- ── students — rolling rollup + admin-review bit ─────────────────
ALTER TABLE students
    ADD COLUMN IF NOT EXISTS flag_count       INTEGER  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_flagged_at  TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS is_under_review  BOOLEAN  NOT NULL DEFAULT FALSE;

-- ── Indexes (partial — most rows are not flagged) ────────────────
CREATE INDEX IF NOT EXISTS idx_writing_essays_flagged
    ON writing_essays(flagged_at DESC)
    WHERE is_flagged = TRUE;

CREATE INDEX IF NOT EXISTS idx_students_under_review
    ON students(last_flagged_at DESC)
    WHERE is_under_review = TRUE;

-- ── Documentation ────────────────────────────────────────────────
COMMENT ON COLUMN writing_essays.is_flagged IS
    'TRUE when the spam detector marked this submission. The row carries status=delivered with no feedback row attached.';
COMMENT ON COLUMN writing_essays.flag_reasons IS
    'Array of detector flags: too_short_chars, too_short_words, repeated_phrase, keyboard_mash, toxic_language. Empty when is_flagged=FALSE.';
COMMENT ON COLUMN writing_essays.flagged_at IS
    'When the row was flagged. NULL when is_flagged=FALSE.';

COMMENT ON COLUMN students.flag_count IS
    'Total number of flagged submissions by this student. Incremented at submit time, never decremented.';
COMMENT ON COLUMN students.last_flagged_at IS
    'Timestamp of the most recent flagged submission. NULL when flag_count=0.';
COMMENT ON COLUMN students.is_under_review IS
    'Auto-set to TRUE when flag_count crosses 3. Cleared manually by admin after a review session.';
