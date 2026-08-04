-- Migration: 187_class_assignment_course_skill.sql
-- Giao bài tập theo BUỔI của giáo trình cho lớp.
--
-- Chạy một lần (SAU mig 186):
--   export $(grep -m1 '^DATABASE_URL=' backend/.env | xargs) && \
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/187_class_assignment_course_skill.sql
--
-- ── VÌ SAO MỘT GIÁ TRỊ MỚI, KHÔNG MƯỢN 'grammar' ────────────────────────────
-- Ràng buộc hiện cho phép 'grammar', và kho Course 1 đúng là bài tập ngữ pháp —
-- nên mượn tạm là làm được. Bác bỏ vì `skill` KHÔNG phải một cái nhãn: nó là thứ
-- quyết định học viên bấm "Làm bài" thì đi đâu.
--
-- `class_student.start_task` rẽ nhánh theo `skill` để dựng phiên nói, mở đề đọc,
-- hay mở đề nghe. Bài tập theo buổi mở một trang KHÁC HẲN
-- (`/course-exercises?bank=…`). Gộp nó vào 'grammar' nghĩa là nhánh ấy phải đoán
-- tiếp bằng `content_config`, và một bài giao thiếu trường phụ sẽ rơi vào nhánh
-- sai — im lặng.
--
-- Thêm giá trị chứ không đổi giá trị nào: mọi dòng đang có vẫn hợp lệ.

BEGIN;

ALTER TABLE class_assignments DROP CONSTRAINT IF EXISTS class_assignments_skill_check;

ALTER TABLE class_assignments
  ADD CONSTRAINT class_assignments_skill_check
  CHECK (skill = ANY (ARRAY['speaking', 'writing', 'reading', 'listening',
                            'vocab', 'grammar', 'course']));

COMMENT ON COLUMN class_assignments.skill IS
'Kỹ năng của bài giao. ''course'' (mig 187) = bài tập theo BUỔI của giáo trình:
`content_id` trỏ tới một `quiz_banks` có `skill_area=''course''`, và đó là cửa
DUY NHẤT để học viên mở được bank ấy (services/quiz_service.get_bank_for_play).';

COMMIT;

-- ── Kiểm sau khi chạy ────────────────────────────────────────────────────────
-- SELECT pg_get_constraintdef(oid) LIKE '%course%' AS cho_phep_course
--   FROM pg_constraint WHERE conname = 'class_assignments_skill_check';

-- ── Lệnh lùi ────────────────────────────────────────────────────────────────
-- ALTER TABLE class_assignments DROP CONSTRAINT IF EXISTS class_assignments_skill_check;
-- ALTER TABLE class_assignments ADD CONSTRAINT class_assignments_skill_check
--   CHECK (skill = ANY (ARRAY['speaking','writing','reading','listening','vocab','grammar']));
