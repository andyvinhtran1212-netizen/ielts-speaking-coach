-- 102_writing_essay_first_viewed.sql
-- R2b — "Mới" (new feedback) badge. ADDITIVE + NULLABLE.
--
-- student_first_viewed_at records when the student FIRST saw a delivered essay's
-- feedback (set once, idempotently, on detail-open OR .docx-export — the two
-- paths a student touches the feedback). The dashboard badges a delivered essay
-- as "Mới" while this is NULL, and clears it the moment the student opens/exports.
--
-- BACKFILL: every essay already delivered is marked already-seen
-- (student_first_viewed_at = COALESCE(delivered_at, now())) so turning the
-- feature on does NOT light up "Mới" on the existing dogfood essays — only
-- deliveries FROM NOW ON get badged.
--
-- Rollback: ALTER TABLE writing_essays DROP COLUMN student_first_viewed_at;

ALTER TABLE writing_essays ADD COLUMN IF NOT EXISTS student_first_viewed_at timestamptz;

-- Mark all currently-delivered essays as already-seen (one-time backfill).
UPDATE writing_essays
   SET student_first_viewed_at = COALESCE(delivered_at, now())
 WHERE status = 'delivered'
   AND student_first_viewed_at IS NULL;
