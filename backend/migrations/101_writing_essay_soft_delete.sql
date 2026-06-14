-- 101_writing_essay_soft_delete.sql
-- R2a — soft-delete for writing essays. ADDITIVE + NULLABLE → recoverable.
--
-- An essay is "deleted" by setting deleted_at = now() (an UPDATE), NOT a row
-- DELETE. Because no row is removed, the `writing_feedback.essay_id ON DELETE
-- CASCADE` (migration 033) NEVER fires — the AI/admin feedback is preserved and
-- the delete is fully recoverable (DELETE-freeze §8 respected). Every read path
-- in the writing module filters `deleted_at IS NULL` in application code (the
-- backend uses the service-role client, which bypasses RLS, so the filter lives
-- in code, not a policy).
--
-- Rollback: ALTER TABLE writing_essays DROP COLUMN deleted_at;

ALTER TABLE writing_essays ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- The common read shape is "live essays, newest first" — a partial index keeps
-- those scans off the soft-deleted rows.
CREATE INDEX IF NOT EXISTS idx_writing_essays_live
    ON writing_essays (created_at DESC)
    WHERE deleted_at IS NULL;
