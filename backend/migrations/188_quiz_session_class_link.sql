-- Migration: 188_quiz_session_class_link.sql
-- Nối một lượt làm bài tập với MỤC BÀI GIAO sinh ra nó.
--
-- Chạy một lần (SAU mig 187):
--   export $(grep -m1 '^DATABASE_URL=' backend/.env | xargs) && \
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/188_quiz_session_class_link.sql
--
-- ── VÌ SAO CẦN ───────────────────────────────────────────────────────────────
-- Học viên làm xong bài tập theo buổi, nhưng `class_assignment_items` KHÔNG có
-- cách nào biết: lượt làm nằm ở `quiz_sessions`, và giữa hai bảng không có mối
-- nối nào. Mục bài giao ở lại trạng thái `opened` VĨNH VIỄN, nên bảng tổng kết
-- của giáo viên báo em ấy chưa nộp — trong khi em ấy đã làm xong.
--
-- Đây đúng là mối nối mà mig 181 đã thêm cho Reading/Listening
-- (`*_test_attempts.class_assignment_item_id`), và vì cùng lý do: SUY RA "lượt
-- này thuộc bài giao nào" từ thời điểm và người làm là một phép đoán, và phép
-- đoán ấy đã sai đủ nhiều lần để không đáng làm lại.
--
-- ON DELETE SET NULL, không CASCADE: xoá một bài giao KHÔNG được xoá lượt làm
-- của học viên. Công sức ấy là của em ấy, không phải của lớp.

BEGIN;

ALTER TABLE quiz_sessions
  ADD COLUMN IF NOT EXISTS class_assignment_item_id UUID
    REFERENCES class_assignment_items(id) ON DELETE SET NULL;

-- Chỉ mục riêng phần: đại đa số phiên là luyện tự do, không có mối nối nào.
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_class_item
  ON quiz_sessions (class_assignment_item_id)
  WHERE class_assignment_item_id IS NOT NULL;

COMMENT ON COLUMN quiz_sessions.class_assignment_item_id IS
'Mục bài giao sinh ra lượt làm này (mig 188). NULL = luyện tự do. Được ghi lúc
tạo phiên sau khi đã kiểm mục ấy thuộc chính người gọi, và là thứ cho phép
`end_session` đánh dấu bài đã nộp — không có nó thì mục ở lại "opened" vĩnh viễn
và giáo viên đọc thành chưa làm.';

COMMIT;

-- ── Kiểm sau khi chạy ────────────────────────────────────────────────────────
-- SELECT EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_name='quiz_sessions'
--                  AND column_name='class_assignment_item_id') AS co_cot_noi;

-- ── Lệnh lùi ────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS idx_quiz_sessions_class_item;
-- ALTER TABLE quiz_sessions DROP COLUMN IF EXISTS class_assignment_item_id;
