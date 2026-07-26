-- ============================================================================
-- Migration 170 — exam_only: nội dung dành riêng cho kỳ thi thử
--
-- WHY. A reading/listening test or a writing prompt staged for a mock exam must
-- not sit in the student practice library — a student who practises the exact
-- paper before the exam makes the exam measure nothing.
--
-- WHAT ALREADY EXISTED, AND WHY IT IS NOT ENOUGH.
-- mock_exam_service.reserved_test_ids() already hides reading/listening tests
-- assigned to a NON-ARCHIVED mock exam from the two browse lists. Three holes:
--
--   1. It filters `status <> 'archived'`, so ARCHIVING an exam publishes its
--      paper back to the library — the next cohort can practise exactly what
--      the last cohort just sat.
--   2. It only covers the LIST endpoints. The detail / boot / attempt-start
--      endpoints never checked it, so a direct link still served the paper.
--   3. Writing prompts had no equivalent at all, and a test staged for a FUTURE
--      exam (uploaded, not yet assigned) is public until the moment it is
--      assigned.
--
-- This column is the explicit, permanent form of that intent: set by the admin
-- at upload time, and set automatically when an exam is given the content.
--
-- BACKFILL SCOPE (decided with the project owner, 2026-07-26): every test/prompt
-- EVER referenced by a mock exam — including archived exams, which is what
-- closes hole (1). Deliberately NOT "every full test": 6 reading + 7 listening
-- full tests belong to nobody's exam and are real practice material; hiding
-- them would delete a student-facing library to fix a leak they are not part of.
--
-- TO REVERSE (the backfill is the only part that changes what students see):
--   UPDATE reading_tests   SET exam_only = false;
--   UPDATE listening_tests SET exam_only = false;
--   UPDATE writing_prompts SET exam_only = false;
--   -- (or drop the columns entirely; the code treats a missing/false flag as
--   --  "public", so reversing restores the previous behaviour exactly)
--
-- Apply by hand in the Supabase SQL editor.
-- ============================================================================

BEGIN;

ALTER TABLE reading_tests
    ADD COLUMN IF NOT EXISTS exam_only BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE listening_tests
    ADD COLUMN IF NOT EXISTS exam_only BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE writing_prompts
    ADD COLUMN IF NOT EXISTS exam_only BOOLEAN NOT NULL DEFAULT false;

-- ── Backfill ────────────────────────────────────────────────────────────
-- No status filter on mock_exams ON PURPOSE: a paper that was sat once must
-- stay out of the library after its exam is archived.

UPDATE reading_tests t
   SET exam_only = true
 WHERE t.exam_only = false
   AND EXISTS (SELECT 1 FROM mock_exams e WHERE e.reading_test_id = t.id);

UPDATE listening_tests t
   SET exam_only = true
 WHERE t.exam_only = false
   AND EXISTS (SELECT 1 FROM mock_exams e WHERE e.listening_test_id = t.id);

UPDATE writing_prompts p
   SET exam_only = true
 WHERE p.exam_only = false
   AND EXISTS (
           SELECT 1 FROM mock_exams e
            WHERE e.writing_task1_prompt_id = p.id
               OR e.writing_task2_prompt_id = p.id
       );

-- Browse lists filter on this column alongside `status`/`is_active`; a partial
-- index keeps the common "public only" scan cheap as the libraries grow.
CREATE INDEX IF NOT EXISTS idx_reading_tests_public
    ON reading_tests (status) WHERE exam_only = false;
CREATE INDEX IF NOT EXISTS idx_listening_tests_public
    ON listening_tests (status) WHERE exam_only = false;
CREATE INDEX IF NOT EXISTS idx_writing_prompts_public
    ON writing_prompts (is_active) WHERE exam_only = false;

COMMENT ON COLUMN reading_tests.exam_only IS
'Reserved for mock exams — hidden from the student practice library and refused
by the detail/boot endpoints unless the caller has a sitting on an exam that
uses this test (mig 170).';
COMMENT ON COLUMN listening_tests.exam_only IS
'Reserved for mock exams — see reading_tests.exam_only (mig 170).';
COMMENT ON COLUMN writing_prompts.exam_only IS
'Reserved for mock exams — hidden from the student prompt bank (mig 170).';

COMMIT;
