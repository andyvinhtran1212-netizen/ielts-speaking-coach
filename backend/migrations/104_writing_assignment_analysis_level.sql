-- Migration: 104_writing_assignment_analysis_level.sql
-- Mô tả: Chọn CẤP ĐỘ PHÂN TÍCH (analysis_level L1–L5) khi GIAO bài writing.
--
-- Today the AI background-grade level is hardcoded to 3 on the student-submit
-- path (writing_student.py) — there is no way to choose it when assigning.
-- This adds the level to writing_assignments so the give-action sets it, and
-- the student-submit wire reads assignment.analysis_level → essay.analysis_level
-- → the grader (which already reads essay.analysis_level). The essay then ends
-- `graded` at that level, waiting in the "Cần chấm" queue (#486).
--
-- Purely ADDITIVE. Orthogonal to grading_tier (passes) — this is the
-- feedback-DEPTH dial (which sections), see writing_prompt_loader LEVEL_SECTIONS.
--
-- Column:
--   analysis_level — INT 1–5, NOT NULL DEFAULT 3. The default is exactly the
--     value the student-submit path hardcoded before this change, so every
--     existing assignment (and any caller that omits it) keeps the current
--     behavior — zero regression. Mirrors writing_essays.analysis_level
--     (mig 033: INT NOT NULL CHECK BETWEEN 1 AND 5).

ALTER TABLE writing_assignments
    ADD COLUMN IF NOT EXISTS analysis_level INT NOT NULL DEFAULT 3
        CHECK (analysis_level BETWEEN 1 AND 5);

COMMENT ON COLUMN writing_assignments.analysis_level IS
    'AI feedback depth L1–L5 chosen at assign time; flows to essay.analysis_level on submit (default 3 = legacy hardcoded). Orthogonal to grading_tier.';
