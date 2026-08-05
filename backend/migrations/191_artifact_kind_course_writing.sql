-- Migration: 191_artifact_kind_course_writing.sql
--
-- Cho phép `class_assignment_items.artifact_kind = 'course_writing'`.
--
-- Vì sao cần: bank CHỈ có câu tự luận không sinh ra phiên quiz nào, nên
-- `end_session` — đường chốt sổ duy nhất cho bài tập theo buổi — không bao giờ
-- chạy. Bài học viên đã viết và đã được chấm vẫn nằm ở "Cần nộp" rồi thành
-- "Quá hạn", còn bảng của giáo viên không thấy gì (codex #935).
--
-- `artifact_kind` nói cho người đọc biết `artifact_id` trỏ vào BẢNG NÀO, nên
-- mượn tạm 'quiz_session' là nói dối: mọi mặt đọc sẽ đi tra một phiên không tồn
-- tại. Một giá trị mới là câu trả lời đúng.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/191_artifact_kind_course_writing.sql

-- DROP theo tên TRA ĐƯỢC, không đoán tên tự sinh: đoán trượt thì
-- DROP IF EXISTS no-op im lặng và CHECK cũ vẫn chặn ghi (bài học mig 189).
DO $$
DECLARE c RECORD;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'class_assignment_items'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%artifact_kind%IN%'
    LOOP
        EXECUTE format('ALTER TABLE class_assignment_items DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE class_assignment_items
    ADD CONSTRAINT class_assignment_items_artifact_kind_check CHECK (
        artifact_kind IN ('session', 'writing_assignment', 'reading_attempt',
                          'listening_attempt', 'quiz_session', 'course_writing'));

-- ── Verify ───────────────────────────────────────────────────────────────────
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'class_assignment_items'::regclass
--    AND conname = 'class_assignment_items_artifact_kind_check';
-- Cần thấy 'course_writing' trong danh sách.
--
-- Rollback: dựng lại CHECK cũ không có 'course_writing' (chỉ làm được khi chưa
-- có dòng nào mang giá trị ấy).
