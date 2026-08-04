-- Migration: 189_course_mastery_gate.sql
-- Cơ chế "thuộc bài": học viên phải đạt ngưỡng % mới được kết luận PASS bài tập
-- buổi; dưới ngưỡng thì làm bài KIỂM TRA LẠI (mẫu nhỏ, trộn câu + trộn đáp án)
-- tới khi đạt. Kết luận ghi server-side để giáo viên đọc được và không bay theo
-- localStorage.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/189_course_mastery_gate.sql
--
-- ── 1 · Sửa hai CHECK đang CHẶN chốt sổ bài quiz ─────────────────────────────
-- Mig 177 khai artifact_kind IN (session, writing_assignment, reading_attempt,
-- listening_attempt) và score NUMERIC(3,1) ≤ 9. Nhưng end_session của quiz ghi
-- artifact_kind='quiz_session' với score 0–100 (phần trăm). Chưa nổ trên prod
-- chỉ vì chưa có bài giao course nào — lượt nộp THẬT đầu tiên sẽ vi phạm CHECK,
-- mark_item_submitted raise, bị caller nuốt thành warning, và giáo viên vĩnh
-- viễn thấy "chưa làm" trong khi học viên đã làm xong. Đúng lớp lỗi im lặng
-- mà dự án cấm.

-- DROP theo TÊN TRA ĐƯỢC, không đoán tên tự sinh: đoán trượt thì DROP IF EXISTS
-- no-op im lặng, CHECK cũ vẫn nằm đó chặn ghi — migration "chạy xong" mà lỗi
-- còn nguyên. Gỡ MỌI CHECK chạm tới artifact_kind/score (kể cả pairing — nó sẽ
-- được dựng lại ngay dưới), rồi dựng lại cả ba với tên chuẩn: trạng thái cuối
-- tất định, chạy lại không đổi gì.
DO $$
DECLARE c RECORD;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'class_assignment_items'::regclass AND contype = 'c'
          AND (pg_get_constraintdef(oid) ILIKE '%artifact_kind%'
               OR pg_get_constraintdef(oid) ILIKE '%score%')
    LOOP
        EXECUTE format('ALTER TABLE class_assignment_items DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE class_assignment_items
    ADD CONSTRAINT class_assignment_items_artifact_kind_check CHECK (
        artifact_kind IN ('session', 'writing_assignment', 'reading_attempt',
                          'listening_attempt', 'quiz_session'));

-- Dựng lại y nguyên pairing của mig 177 (bị gỡ ở DO block trên vì def của nó
-- nhắc tới artifact_kind).
ALTER TABLE class_assignment_items
    ADD CONSTRAINT class_assignment_items_artifact_pairing CHECK (
        (artifact_kind IS NULL AND artifact_id IS NULL)
        OR (artifact_kind IS NOT NULL AND artifact_id IS NOT NULL));

-- NUMERIC(3,1) chứa tối đa 99.9 — bài làm đúng 100% không ghi nổi. (4,1) đủ.
-- CHECK nới lên 0–100: band Speaking 0–9 vẫn nằm gọn trong dải; ý nghĩa cột
-- theo kind (band cho speaking, % cho quiz) do artifact_kind nói.
ALTER TABLE class_assignment_items
    ALTER COLUMN score TYPE NUMERIC(4,1);
ALTER TABLE class_assignment_items
    ADD CONSTRAINT class_assignment_items_score_check
        CHECK (score IS NULL OR (score >= 0 AND score <= 100));

-- ── 2 · Kết luận ĐẠT — ghi thẳng, không suy ra ──────────────────────────────
-- Suy "đã đạt" từ khảo cổ các phiên là mảnh đất của lỗi (học viên xoá
-- localStorage → chặng trùng lặp làm mẫu số phình). Ghi một lần, đọc mãi.
ALTER TABLE class_assignment_items
    ADD COLUMN IF NOT EXISTS passed_at TIMESTAMPTZ;

-- Sổ các lượt xét: [{phase: 'run'|'retake', pct, at, sessions}]. Giáo viên đọc
-- được "trượt 2 lần rồi mới đạt" — đó chính là tín hiệu cần kèm cặp.
ALTER TABLE class_assignment_items
    ADD COLUMN IF NOT EXISTS mastery JSONB;

COMMENT ON COLUMN class_assignment_items.passed_at IS
    'Thời điểm kết luận ĐẠT bài tập buổi (course): điểm gộp ≥ ngưỡng, ở lượt chính hoặc lượt kiểm tra lại. NULL = chưa đạt.';
COMMENT ON COLUMN class_assignment_items.mastery IS
    'Sổ các lượt xét đạt: {threshold, attempts: [{phase, pct, at, sessions}]}. Chỉ bài course dùng.';

-- ── 3 · Phiên kiểm tra lại phân biệt được với phiên chặng thường ─────────────
ALTER TABLE quiz_sessions
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'run';
ALTER TABLE quiz_sessions
    DROP CONSTRAINT IF EXISTS quiz_sessions_kind_check;
ALTER TABLE quiz_sessions
    ADD CONSTRAINT quiz_sessions_kind_check CHECK (kind IN ('run', 'retake'));

COMMENT ON COLUMN quiz_sessions.kind IS
    'run = phiên chặng của lượt làm chính; retake = phiên kiểm tra lại (mẫu nhỏ, trộn câu + đáp án) sau khi dưới ngưỡng.';

-- ── Verify ───────────────────────────────────────────────────────────────────
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'class_assignment_items'::regclass AND contype = 'c';
-- SELECT column_name, data_type, numeric_precision, numeric_scale
--   FROM information_schema.columns
--  WHERE table_name = 'class_assignment_items' AND column_name IN ('score');
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'class_assignment_items'
--    AND column_name IN ('passed_at', 'mastery');
-- SELECT column_name, column_default FROM information_schema.columns
--  WHERE table_name = 'quiz_sessions' AND column_name = 'kind';
--
-- Rollback:
-- ALTER TABLE quiz_sessions DROP COLUMN IF EXISTS kind;
-- ALTER TABLE class_assignment_items DROP COLUMN IF EXISTS mastery;
-- ALTER TABLE class_assignment_items DROP COLUMN IF EXISTS passed_at;
-- (Hai CHECK cũ không khôi phục — chúng là lỗi.)
