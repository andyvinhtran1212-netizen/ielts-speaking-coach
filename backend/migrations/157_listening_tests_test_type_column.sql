-- Migration: 157_listening_tests_test_type_column.sql
-- Mô tả: cứng hoá test_type của listening_tests thành cột thật (audit
-- upload 2026-07-17, đề xuất #5). Trước đây test_type sống trong
-- metadata JSONB (metadata->>'test_type': 'full' | 'mini' | 'drill',
-- NULL ở các row legacy = ngầm hiểu 'full') — không có CHECK, dễ vỡ
-- khi code lọc theo type. Cột thật + CHECK + backfill NULL→'full'.
--
-- Sau migration này, cột `test_type` là nguồn sự thật duy nhất; code
-- không stamp metadata->>'test_type' nữa (giá trị cũ trong metadata
-- được giữ nguyên nhưng không còn được đọc).

ALTER TABLE listening_tests
    ADD COLUMN IF NOT EXISTS test_type TEXT;

-- Backfill từ metadata: giá trị hợp lệ giữ nguyên, NULL / giá trị lạ → 'full'
-- (khớp fallback hiện hành của GET /api/listening/tests).
UPDATE listening_tests
SET test_type = CASE
    WHEN metadata->>'test_type' IN ('full', 'mini', 'drill')
        THEN metadata->>'test_type'
    ELSE 'full'
END
WHERE test_type IS NULL;

ALTER TABLE listening_tests
    ALTER COLUMN test_type SET DEFAULT 'full';

ALTER TABLE listening_tests
    ALTER COLUMN test_type SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'listening_tests_test_type_check'
    ) THEN
        ALTER TABLE listening_tests
            ADD CONSTRAINT listening_tests_test_type_check
            CHECK (test_type IN ('full', 'mini', 'drill'));
    END IF;
END $$;

-- Danh sách test lọc theo (status, test_type) ở GET /api/listening/tests.
CREATE INDEX IF NOT EXISTS idx_listening_tests_test_type
    ON listening_tests(test_type, status);
