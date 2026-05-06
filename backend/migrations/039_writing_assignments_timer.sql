-- Migration: 039_writing_assignments_timer.sql
-- Mô tả: Phase 2.3c-3 — IELTS-mode timer per assignment.
--
-- Adds 4 columns to writing_assignments so admins can flip an
-- assignment into "exam mode": once enabled, started_at is stamped
-- on the student's first draft save and expiry = started_at +
-- time_limit_minutes is enforced server-side.
--
-- Why started_at on FIRST DRAFT (not assignment create):
--   The student often opens an assignment hours/days after it was
--   assigned. Counting down from the create timestamp would make
--   the timer useless. Stamping on first draft save is the closest
--   analogue to "candidate clicked Begin in the IELTS UI".
--
-- Why a hard cap of 180 minutes:
--   IELTS Writing is 60 minutes total. 180 = 3× the real exam,
--   plenty of slack for practice scenarios while preventing a
--   typo'd `time_limit_minutes = 1800` from looking valid.
--
-- The CHECK constraint enforces the (is_timed, time_limit_minutes)
-- pair invariant at the DB layer too — it's a defence-in-depth net
-- in case Pydantic's field_validator regresses or someone writes
-- to the table outside the API.

ALTER TABLE writing_assignments
    ADD COLUMN IF NOT EXISTS is_timed             BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS time_limit_minutes   INTEGER,
    ADD COLUMN IF NOT EXISTS started_at           TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS auto_submitted       BOOLEAN NOT NULL DEFAULT FALSE;

-- Drop-then-create so re-running on an environment that already has
-- a same-named constraint with different bounds doesn't silently
-- diverge from this file.
ALTER TABLE writing_assignments
    DROP CONSTRAINT IF EXISTS writing_assignments_time_limit_check;

ALTER TABLE writing_assignments
    ADD CONSTRAINT writing_assignments_time_limit_check
    CHECK (
        (is_timed = FALSE AND time_limit_minutes IS NULL)
        OR
        (is_timed = TRUE
         AND time_limit_minutes IS NOT NULL
         AND time_limit_minutes >  0
         AND time_limit_minutes <= 180)
    );

COMMENT ON COLUMN writing_assignments.is_timed IS
    'IELTS-mode flag — when true, started_at stamps on first draft save and timer counts down server-side.';
COMMENT ON COLUMN writing_assignments.time_limit_minutes IS
    'Total minutes allowed (1-180). Required when is_timed=true, NULL otherwise (CHECK enforced).';
COMMENT ON COLUMN writing_assignments.started_at IS
    'Stamped on the first draft save when is_timed=true. expiry = started_at + time_limit_minutes.';
COMMENT ON COLUMN writing_assignments.auto_submitted IS
    'TRUE when the timer expired and the backend force-submitted. Audit trail for late-essay reviews.';
