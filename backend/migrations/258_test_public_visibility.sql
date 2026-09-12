-- Migration 258 — tách trạng thái public khỏi việc đề được dùng ở đâu
--
-- `exam_only` từng đồng thời biểu diễn đề mock và khả năng xuất hiện trong
-- thư viện tự luyện. `is_public` là nguồn sự thật riêng cho việc hiển thị;
-- mock test và bài giao lớp là các quan hệ độc lập.

BEGIN;

ALTER TABLE reading_tests
    ADD COLUMN IF NOT EXISTS is_public BOOLEAN;
ALTER TABLE listening_tests
    ADD COLUMN IF NOT EXISTS is_public BOOLEAN;

-- Giữ nguyên tập đề đang mở, bao gồm các đề mock đã được bật public practice.
UPDATE reading_tests
   SET is_public = NOT COALESCE(exam_only, false)
                   OR COALESCE(public_practice_enabled, false)
 WHERE is_public IS NULL;
UPDATE listening_tests
   SET is_public = NOT COALESCE(exam_only, false)
                   OR COALESCE(public_practice_enabled, false)
 WHERE is_public IS NULL;

ALTER TABLE reading_tests
    ALTER COLUMN is_public SET DEFAULT true,
    ALTER COLUMN is_public SET NOT NULL;
ALTER TABLE listening_tests
    ALTER COLUMN is_public SET DEFAULT true,
    ALTER COLUMN is_public SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reading_tests_public_visibility
    ON reading_tests (status, created_at DESC) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_listening_tests_public_visibility
    ON listening_tests (status, created_at DESC) WHERE is_public = true;

COMMENT ON COLUMN reading_tests.is_public IS
'Có hiện trong thư viện tự luyện Reading hay không. Độc lập với mock_exams và class_assignments (mig 258).';
COMMENT ON COLUMN listening_tests.is_public IS
'Có hiện trong thư viện tự luyện Listening hay không. Độc lập với mock_exams và class_assignments (mig 258).';

COMMIT;
