-- Migration: 230_course_section_attempts.sql
-- Mô tả: tách submission của từng phần theo lượt làm-lại-full. Lịch sử cũ vẫn
-- giữ nguyên; một lượt mới được nộp lại viết/đọc/nghe/phát âm mà không ghi đè.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f backend/migrations/230_course_section_attempts.sql

BEGIN;

-- Trước migration, một submission được carry qua mọi full retry. Gắn nó vào
-- lượt hiện hành cuối cùng để màn kết quả đang mở vẫn đọc đúng bằng chứng ấy;
-- lần retry kế tiếp sẽ tăng attempt_no và bắt đầu bằng một bộ section trống.
-- Mỗi backfill chỉ chạy khi cột vừa được tạo. Nhờ đó migration có thể chạy
-- lại an toàn mà không dồn toàn bộ lịch sử mới vào attempt hiện hành.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'course_writing_submissions'
           AND column_name = 'attempt_no'
    ) THEN
        ALTER TABLE course_writing_submissions
            ADD COLUMN IF NOT EXISTS attempt_no INTEGER NOT NULL DEFAULT 1;
        UPDATE course_writing_submissions AS submission
           SET attempt_no = CASE
               WHEN jsonb_typeof(item.mastery -> 'attempts') = 'array'
               THEN GREATEST((
                   SELECT count(*)::INTEGER
                     FROM jsonb_array_elements(item.mastery -> 'attempts') AS attempt
                    WHERE COALESCE(attempt ->> 'phase', 'run') = 'run'
               ), 1)
               ELSE 1
           END
          FROM class_assignment_items AS item
         WHERE item.id = submission.class_assignment_item_id;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'course_writing_drafts'
           AND column_name = 'attempt_no'
    ) THEN
        ALTER TABLE course_writing_drafts
            ADD COLUMN IF NOT EXISTS attempt_no INTEGER NOT NULL DEFAULT 1;
        UPDATE course_writing_drafts AS draft
           SET attempt_no = CASE
               WHEN jsonb_typeof(item.mastery -> 'attempts') = 'array'
               THEN GREATEST((
                   SELECT count(*)::INTEGER
                     FROM jsonb_array_elements(item.mastery -> 'attempts') AS attempt
                    WHERE COALESCE(attempt ->> 'phase', 'run') = 'run'
               ), 1)
               ELSE 1
           END
          FROM class_assignment_items AS item
         WHERE item.id = draft.class_assignment_item_id;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'course_section_submissions'
           AND column_name = 'attempt_no'
    ) THEN
        ALTER TABLE course_section_submissions
            ADD COLUMN IF NOT EXISTS attempt_no INTEGER NOT NULL DEFAULT 1;
        UPDATE course_section_submissions AS submission
           SET attempt_no = CASE
               WHEN jsonb_typeof(item.mastery -> 'attempts') = 'array'
               THEN GREATEST((
                   SELECT count(*)::INTEGER
                     FROM jsonb_array_elements(item.mastery -> 'attempts') AS attempt
                    WHERE COALESCE(attempt ->> 'phase', 'run') = 'run'
               ), 1)
               ELSE 1
           END
          FROM class_assignment_items AS item
         WHERE item.id = submission.class_assignment_item_id;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'course_pronunciation_submissions'
           AND column_name = 'attempt_no'
    ) THEN
        ALTER TABLE course_pronunciation_submissions
            ADD COLUMN IF NOT EXISTS attempt_no INTEGER NOT NULL DEFAULT 1;
        UPDATE course_pronunciation_submissions AS submission
           SET attempt_no = CASE
               WHEN jsonb_typeof(item.mastery -> 'attempts') = 'array'
               THEN GREATEST((
                   SELECT count(*)::INTEGER
                     FROM jsonb_array_elements(item.mastery -> 'attempts') AS attempt
                    WHERE COALESCE(attempt ->> 'phase', 'run') = 'run'
               ), 1)
               ELSE 1
           END
          FROM class_assignment_items AS item
         WHERE item.id = submission.class_assignment_item_id;
    END IF;
END;
$$;

ALTER TABLE course_writing_submissions
    DROP CONSTRAINT IF EXISTS course_writing_submissions_attempt_positive;
ALTER TABLE course_writing_submissions
    ADD CONSTRAINT course_writing_submissions_attempt_positive
        CHECK (attempt_no > 0) NOT VALID;
ALTER TABLE course_writing_submissions
    VALIDATE CONSTRAINT course_writing_submissions_attempt_positive;

ALTER TABLE course_writing_drafts
    DROP CONSTRAINT IF EXISTS course_writing_drafts_attempt_positive;
ALTER TABLE course_writing_drafts
    ADD CONSTRAINT course_writing_drafts_attempt_positive
        CHECK (attempt_no > 0) NOT VALID;
ALTER TABLE course_writing_drafts
    VALIDATE CONSTRAINT course_writing_drafts_attempt_positive;

ALTER TABLE course_section_submissions
    DROP CONSTRAINT IF EXISTS course_section_submissions_attempt_positive;
ALTER TABLE course_section_submissions
    ADD CONSTRAINT course_section_submissions_attempt_positive
        CHECK (attempt_no > 0) NOT VALID;
ALTER TABLE course_section_submissions
    VALIDATE CONSTRAINT course_section_submissions_attempt_positive;

ALTER TABLE course_pronunciation_submissions
    DROP CONSTRAINT IF EXISTS course_pronunciation_submissions_attempt_positive;
ALTER TABLE course_pronunciation_submissions
    ADD CONSTRAINT course_pronunciation_submissions_attempt_positive
        CHECK (attempt_no > 0) NOT VALID;
ALTER TABLE course_pronunciation_submissions
    VALIDATE CONSTRAINT course_pronunciation_submissions_attempt_positive;

-- Mỗi phần vẫn chỉ được chốt một lần TRONG MỘT full attempt. Khoá cũ theo item
-- sẽ chặn vĩnh viễn mọi lần retry; khoá mới mở đúng một chiều cần mở.
DROP INDEX IF EXISTS uq_course_writing_per_item;
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_writing_per_item_attempt
    ON course_writing_submissions (class_assignment_item_id, attempt_no)
    WHERE class_assignment_item_id IS NOT NULL;

DROP INDEX IF EXISTS uq_course_writing_draft_per_item;
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_writing_draft_per_item_attempt
    ON course_writing_drafts (class_assignment_item_id, attempt_no);

ALTER TABLE course_section_submissions
    DROP CONSTRAINT IF EXISTS course_section_submissions_item_section_unique;
ALTER TABLE course_section_submissions
    DROP CONSTRAINT IF EXISTS course_section_submissions_item_attempt_section_unique;
ALTER TABLE course_section_submissions
    ADD CONSTRAINT course_section_submissions_item_attempt_section_unique
        UNIQUE (class_assignment_item_id, attempt_no, section);

CREATE INDEX IF NOT EXISTS idx_course_pronunciation_submissions_item_attempt
    ON course_pronunciation_submissions
       (class_assignment_item_id, attempt_no, created_at DESC)
    WHERE class_assignment_item_id IS NOT NULL;

COMMENT ON COLUMN course_writing_submissions.attempt_no IS
    'Lượt full-session của bài giao. Mỗi lượt có tối đa một submission viết.';
COMMENT ON COLUMN course_writing_drafts.attempt_no IS
    'Lượt full-session sở hữu bản nháp; nháp của lượt trước không rót vào lượt mới.';
COMMENT ON COLUMN course_section_submissions.attempt_no IS
    'Lượt full-session sở hữu kết quả đọc/nghe.';
COMMENT ON COLUMN course_pronunciation_submissions.attempt_no IS
    'Lượt full-session sở hữu lần chấm phát âm.';

COMMIT;

-- Verify (read-only):
-- SELECT table_name, column_name, column_default, is_nullable
--   FROM information_schema.columns
--  WHERE table_name IN ('course_writing_submissions', 'course_writing_drafts',
--                       'course_section_submissions',
--                       'course_pronunciation_submissions')
--    AND column_name = 'attempt_no'
--  ORDER BY table_name;
-- SELECT indexname, indexdef FROM pg_indexes
--  WHERE indexname IN ('uq_course_writing_per_item_attempt',
--                      'uq_course_writing_draft_per_item_attempt',
--                      'idx_course_pronunciation_submissions_item_attempt');
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conname = 'course_section_submissions_item_attempt_section_unique';
