-- 165_mock_review_void_status.sql
--
-- D4: voiding a sitting must be able to cancel its review.
--
-- `void_sitting()` writes status='void' on the linked mock_exam_reviews row so
-- a stale review page cannot call release_results() and publish an exam that
-- was explicitly cancelled. But migration 147 pinned the column to
--
--     CHECK (status IN ('queued','claimed','edited','reviewed','released'))
--
-- so that UPDATE is rejected by Postgres. The call site catches broadly (the
-- sitting is already void by then, and losing the whole void over a bookkeeping
-- write would be worse), which means the failure is invisible: the review stays
-- 'claimed'/'reviewed' and keeps sitting in the default queue as work someone
-- is expected to finish for a cancelled exam.
--
-- 'void' is the right value rather than reusing an existing terminal state:
-- 'released' would claim the results were published, and 'reviewed' is what we
-- are trying to get OUT of. It also keeps the queue filters honest — the active
-- index below already covers only queued/claimed, and every listing that means
-- "still to do" excludes void explicitly.

BEGIN;

ALTER TABLE mock_exam_reviews
    DROP CONSTRAINT IF EXISTS mock_exam_reviews_status_check;

ALTER TABLE mock_exam_reviews
    ADD CONSTRAINT mock_exam_reviews_status_check
    CHECK (status IN ('queued', 'claimed', 'edited', 'reviewed', 'released', 'void'));

COMMIT;

-- ── Backfill (optional, read the SELECT first).
--
-- Reviews whose sitting was voided BEFORE this migration are the rows that
-- silently failed the update. They are still in the queue.
--
-- SELECT r.id, r.sitting_id, r.status, s.status AS sitting_status
--   FROM mock_exam_reviews r
--   JOIN mock_exam_sittings s ON s.id = r.sitting_id
--  WHERE s.status = 'void' AND r.status NOT IN ('released', 'void');
--
-- UPDATE mock_exam_reviews r
--    SET status = 'void'
--   FROM mock_exam_sittings s
--  WHERE s.id = r.sitting_id
--    AND s.status = 'void'
--    AND r.status NOT IN ('released', 'void');

-- ── VERIFY: the value is now accepted.
-- SELECT 'void' = ANY (
--   SELECT unnest(string_to_array(
--     regexp_replace(pg_get_constraintdef(oid), '[^a-z,]', '', 'g'), ','))
--   FROM pg_constraint WHERE conname = 'mock_exam_reviews_status_check');
