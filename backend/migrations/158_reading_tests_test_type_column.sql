-- Migration: 158_reading_tests_test_type_column.sql
-- Mô tả: cứng hoá test_type của reading_tests thành cột thật — cùng pattern
-- migration 157 (listening_tests). Trước đây test_type sống trong metadata
-- JSONB (metadata->>'test_type': 'full' | 'mini', NULL ở row legacy = ngầm
-- hiểu 'full') — không CHECK, filter phải or_ NULL-fallback.
--
-- Reading chỉ có 2 loại (full | mini) — không có drill như listening.
-- Sau migration này cột `test_type` là nguồn sự thật duy nhất; code không
-- stamp metadata->>'test_type' nữa (giá trị cũ giữ nguyên, không còn đọc).

ALTER TABLE reading_tests
    ADD COLUMN IF NOT EXISTS test_type TEXT;

-- Backfill từ metadata: giá trị hợp lệ giữ nguyên, NULL / giá trị lạ → 'full'
-- (khớp fallback hiện hành của GET /api/reading/tests).
UPDATE reading_tests
SET test_type = CASE
    WHEN metadata->>'test_type' IN ('full', 'mini')
        THEN metadata->>'test_type'
    ELSE 'full'
END
WHERE test_type IS NULL;

ALTER TABLE reading_tests
    ALTER COLUMN test_type SET DEFAULT 'full';

ALTER TABLE reading_tests
    ALTER COLUMN test_type SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'reading_tests_test_type_check'
    ) THEN
        ALTER TABLE reading_tests
            ADD CONSTRAINT reading_tests_test_type_check
            CHECK (test_type IN ('full', 'mini'));
    END IF;
END $$;

-- Danh sách đề lọc theo (status, test_type) ở GET /api/reading/tests.
CREATE INDEX IF NOT EXISTS idx_reading_tests_test_type
    ON reading_tests(test_type, status);
