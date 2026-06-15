-- Migration: 103_writing_assignment_groups.sql
-- Mô tả: W-ASSIGN — gán NHIỀU đề/lần giao + đặt TÊN bài tập + cờ soft-check.
--
-- GROUPING model (Andy confirmed): keep "1 row per prompt" — each prompt
-- stays its own writing_assignments row → its own essay → its own
-- feedback. The downstream pipeline (submit / grade / delivered-badge
-- #463 / stats #464) is UNCHANGED. A single admin action just stamps the
-- N rows it creates with a shared `assignment_group_id` + a human `name`
-- ("Buổi 5") so the admin + student UIs can group them.
--
-- Purely ADDITIVE — there is NO UNIQUE(student_id, prompt_id) constraint
-- to drop (mig 036 only created plain indexes; the duplicate policy is
-- app-level "allow + warn" since 2026-05-06). So re-giving the same
-- prompt in a new group is already permitted at the DB layer.
--
-- Columns:
--   assignment_group_id — shared across every (student × prompt) row of
--     one admin give-action. NULL for legacy rows (no backfill). Student
--     "Buổi 5" = rows WHERE assignment_group_id=X AND student_id=me;
--     admin view = rows WHERE assignment_group_id=X.
--   name — short label for the give-action ("Buổi 5: Task 1 + Task 2").
--     Denormalized onto every row of the group (same value). NULL legacy.
--     Distinct from `instructions` (the existing free-text guidance).
--   allow_soft_check — assignment-level opt-in for the future client-side
--     grammar/spell soft-check (W-SOFTCHECK). THIS MIGRATION ONLY ADDS
--     THE FLAG; no soft-check logic is implemented here. Default false.

ALTER TABLE writing_assignments
    ADD COLUMN IF NOT EXISTS assignment_group_id UUID,
    ADD COLUMN IF NOT EXISTS name                TEXT,
    ADD COLUMN IF NOT EXISTS allow_soft_check    BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for the group lookups (admin "show this give-action", student
-- "group my rows under the name"). Partial — legacy rows are NULL.
CREATE INDEX IF NOT EXISTS idx_writing_assignments_group
    ON writing_assignments(assignment_group_id)
    WHERE assignment_group_id IS NOT NULL;

COMMENT ON COLUMN writing_assignments.assignment_group_id IS
    'Shared id across all (student × prompt) rows of one admin give-action. NULL for pre-W-ASSIGN rows. Each prompt is still its own row/essay/feedback — this is only a grouping label.';
COMMENT ON COLUMN writing_assignments.name IS
    'Short human label for the give-action ("Buổi 5"). Denormalized onto every row of the group. Distinct from instructions (free-text guidance).';
COMMENT ON COLUMN writing_assignments.allow_soft_check IS
    'Assignment-level opt-in for client-side grammar/spell soft-check (W-SOFTCHECK). Flag only — no soft-check logic added in mig 103.';
