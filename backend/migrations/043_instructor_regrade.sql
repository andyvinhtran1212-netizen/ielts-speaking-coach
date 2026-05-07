-- Migration: 043_instructor_regrade.sql
-- Mô tả: Phase 2.5 + 1.5d-LAYOUT — instructor view + regrade audit.
--
-- Adds three concerns to the admin grading flow:
--
--   1. Manual-edit audit (is_manually_edited / last_edited_by / last_edited_at)
--      on writing_essays.  The pre-2.5 PATCH /feedback already wrote
--      `admin_edits_json` + `admin_reviewed_at`, but the boolean flag is
--      what surfaces the "✏ Đã sửa thủ công" badge in the UI without
--      requiring a JOIN to feedback or a JSON-presence check.
--
--   2. Regrade audit (regrade_count / last_regraded_at / last_regraded_by)
--      so the moderation queue can tell at a glance whether a low-band
--      essay was AI-only or has already been re-graded by Andy.  Counter
--      increments per call to POST /admin/writing/essays/{id}/regrade.
--
--   3. instructor_note TEXT — free-text personal feedback from Andy.
--      Lives on writing_essays (not inside admin_edits_json) on purpose:
--      the existing PATCH /feedback validates against the WritingFeedback
--      Pydantic schema, and a free-text instructor field would either
--      pollute the AI-grading schema or get rejected by the validator.
--      Keeping it as a sibling column means it survives regrades (which
--      reset admin_edits_json) — Andy's personal notes shouldn't be
--      wiped just because the AI re-graded.
--
-- Idempotent: every column uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE writing_essays
    ADD COLUMN IF NOT EXISTS is_manually_edited BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS last_edited_by     UUID        REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS last_edited_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS regrade_count      INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_regraded_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_regraded_by   UUID        REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS instructor_note    TEXT;

-- Partial index for the moderation dashboard's "recently regraded" filter.
-- Most rows have regrade_count=0, so the partial index keeps the index
-- size small and queries fast.
CREATE INDEX IF NOT EXISTS idx_writing_essays_regraded
    ON writing_essays(last_regraded_at DESC)
    WHERE regrade_count > 0;

COMMENT ON COLUMN writing_essays.is_manually_edited IS
    'TRUE after admin saves edits via PATCH /admin/writing/essays/{id}/feedback. '
    'Surfaced in the admin grading UI as a "✏ Đã sửa thủ công" badge.';
COMMENT ON COLUMN writing_essays.last_edited_by IS
    'users.id of the admin who last saved manual edits. NULL until first save.';
COMMENT ON COLUMN writing_essays.regrade_count IS
    'Number of times POST /admin/writing/essays/{id}/regrade has been called. '
    'Increments on each regrade trigger; never decremented.';
COMMENT ON COLUMN writing_essays.instructor_note IS
    'Free-text personal feedback from instructor, displayed prominently to '
    'the student alongside the AI-graded sections. Survives regrades.';
