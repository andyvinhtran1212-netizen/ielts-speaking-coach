-- Migration 214 — publish completion of the ACK-gated collection sweep
--
-- Migration 213 may already be recorded by an environment, so this exam-level
-- coordination token must live in a new forward migration. The admin can open
-- the next sequential section only after this token matches the collected one.

ALTER TABLE mock_exams
    ADD COLUMN IF NOT EXISTS collection_sweep_completed_section TEXT;

ALTER TABLE mock_exams
    DROP CONSTRAINT IF EXISTS mock_exams_collection_sweep_completed_section_check;

ALTER TABLE mock_exams
    ADD CONSTRAINT mock_exams_collection_sweep_completed_section_check
    CHECK (collection_sweep_completed_section IS NULL
           OR collection_sweep_completed_section IN ('listening', 'reading', 'writing'));

COMMENT ON COLUMN mock_exams.collection_sweep_completed_section IS
  'Sequential mode: the collected section whose coordinated per-sitting sweep '
  'finished. Advance is rejected until collected_section and this value match, '
  'preventing next-section actions from bypassing final-save flush ACKs.';

-- VERIFY (read-only):
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'mock_exams'
--    AND column_name = 'collection_sweep_completed_section';
