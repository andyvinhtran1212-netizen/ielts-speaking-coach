-- Migration: 192_writing_unique_per_item.sql
--
-- Đổi phạm vi "một lượt duy nhất" của phần tự luận: theo MỤC BÀI GIAO, không
-- theo (bank, học viên).
--
-- Vì sao: giao LẠI cùng một bộ bài cho cùng học viên là chuyện bình thường
-- (học lại, lớp sau, giao bù). Với khoá cũ, lượt nộp của lần giao TRƯỚC làm
-- lần giao SAU vĩnh viễn không nộp được — `course_writing_state` đọc theo
-- (bank, user) nên thấy bài cũ và báo "đã nộp", còn `submit` trả 409 trước khi
-- kịp chốt sổ. Bài giao mới đứng mãi ở "Cần nộp" rồi thành "Quá hạn" mà học
-- viên không có cách nào thoát (codex #935).
--
-- "Một lượt cho mỗi BÀI GIAO" cũng chính là điều người dùng đặt ra — khoá cũ
-- chỉ là một cách diễn đạt hẹp hơn của nó, và hẹp sai chỗ.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/192_writing_unique_per_item.sql

-- Bảng vừa tạo ở mig 190 và chưa có dòng nào trên prod, nên không cần chuyển
-- dữ liệu. Câu lệnh vẫn viết cho trường hợp có dòng: khoá mới rộng hơn khoá cũ
-- ở đúng chiều cần rộng, nên mọi dòng hiện có đều thoả.
ALTER TABLE course_writing_submissions
    DROP CONSTRAINT IF EXISTS course_writing_submissions_bank_id_user_id_key;

-- NULL trong UNIQUE của Postgres KHÔNG va nhau, nên một mục NULL sẽ mở đường
-- cho nộp không giới hạn. Tầng ứng dụng đòi có mục trước khi ghi (bank giáo
-- trình chỉ mở được qua bài giao), và index một-phần dưới đây nói rõ điều đó
-- thay vì để nó thành một giả định ngầm.
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_writing_per_item
    ON course_writing_submissions (class_assignment_item_id)
    WHERE class_assignment_item_id IS NOT NULL;

COMMENT ON INDEX uq_course_writing_per_item IS
    'Một lượt nộp tự luận cho mỗi MỤC BÀI GIAO. Giao lại cùng bộ bài = mục mới = lượt mới.';

-- ── Verify ───────────────────────────────────────────────────────────────────
-- SELECT indexname, indexdef FROM pg_indexes
--  WHERE tablename = 'course_writing_submissions';
-- Cần thấy uq_course_writing_per_item, và KHÔNG còn khoá (bank_id, user_id).
--
-- Rollback:
-- DROP INDEX IF EXISTS uq_course_writing_per_item;
-- ALTER TABLE course_writing_submissions
--     ADD CONSTRAINT course_writing_submissions_bank_id_user_id_key UNIQUE (bank_id, user_id);
