-- 166_mock_exam_collected_section.sql
--
-- B4 remediation: make "papers are in, next section not open yet" a CANONICAL
-- state instead of an emergent one.
--
-- Splitting "thu bài" from "mở phần sau" gave the invigilator a real pause, but
-- the pause had no representation on the exam row. Collecting only stamped
-- {section}_submitted_at on the sittings that already EXISTED; `active_section`
-- and `is_open` were left untouched. So a student who was eligible but had not
-- opened the exam yet (arrived late, or their first sitting was voided and
-- re-granted) could create a sitting during the pause, and their brand-new row
-- has no submission stamp — get_sitting_state() reports the still-active
-- section and mock-exam-runner.js hands them the paper the invigilator has
-- already collected, with the class clock running (Codex review, PR #843).
--
-- One nullable column rather than three per-section timestamps: only ONE
-- section can be in the collected-but-not-advanced state at a time (advance
-- clears it), and re-sweeping an EARLIER section for recovery must not put the
-- exam into a pause it is not in.

ALTER TABLE mock_exams
    ADD COLUMN IF NOT EXISTS collected_section TEXT;

ALTER TABLE mock_exams
    DROP CONSTRAINT IF EXISTS mock_exams_collected_section_check;

ALTER TABLE mock_exams
    ADD CONSTRAINT mock_exams_collected_section_check
    CHECK (collected_section IS NULL
           OR collected_section IN ('listening', 'reading', 'writing'));

COMMENT ON COLUMN mock_exams.collected_section IS
  'Sequential mode. The section whose papers have been COLLECTED while it is '
  'still the active_section — i.e. the exam is paused between "thu bài" and '
  '"mở phần sau". Set by collect, cleared by advance. A sitting created while '
  'this is set is born with that section already submitted, so a late entrant '
  'cannot be handed a paper the room has already turned in.';

-- No backfill: NULL is exactly right for every existing exam. An exam mid-flight
-- at deploy time is either genuinely open (NULL) or already advanced (NULL);
-- there is no historical row that was in the pause state, because the pause
-- state did not exist before this column.

-- ── VERIFY (read-only)
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'mock_exams' AND column_name = 'collected_section';
