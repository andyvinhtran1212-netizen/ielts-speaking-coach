-- Migration 213 — coordinate final client autosaves with an admin collection
--
-- `/admin/mock-exams/{id}/collect` closes a sequential section on the exam row
-- before its background sweep stamps each sitting.  The student runner learns
-- about that marker by polling, flushes the embedded Reading/Listening player
-- (or the native Writing draft), then acknowledges that the final save reached
-- the server.  The sweep waits for these acknowledgements for a bounded grace
-- window, so it cannot normally submit a domain attempt ahead of an in-flight
-- answer PATCH.
--
-- JSONB is deliberately per sitting: one sequential sitting can acknowledge
-- each of listening/reading/writing, while a recovery re-sweep can reuse a
-- prior acknowledgement safely because that acknowledgement proves the
-- student's final save for that same paper already completed.

ALTER TABLE mock_exam_sittings
    ADD COLUMN IF NOT EXISTS collection_flush_acks JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE mock_exam_sittings
    DROP CONSTRAINT IF EXISTS mock_exam_sittings_collection_flush_acks_object;

ALTER TABLE mock_exam_sittings
    ADD CONSTRAINT mock_exam_sittings_collection_flush_acks_object
    CHECK (jsonb_typeof(collection_flush_acks) = 'object');

COMMENT ON COLUMN mock_exam_sittings.collection_flush_acks IS
  'Sequential mode: server timestamps keyed by section after the owning client '
  'has flushed its final autosave. Admin collection waits for these ACKs for a '
  'bounded grace window before force-submitting outstanding papers.';

-- VERIFY (read-only):
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'mock_exam_sittings'
--    AND column_name = 'collection_flush_acks';
