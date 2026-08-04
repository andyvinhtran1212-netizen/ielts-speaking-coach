-- Migration: 183_speaking_lesson_sets.sql
-- GĐ A — Bài tập Speaking SAU BUỔI HỌC: kho đề theo buổi + loại bài giao.
--
-- Chạy một lần:
--   export $(grep -m1 '^DATABASE_URL=' backend/.env | xargs) && \
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/183_speaking_lesson_sets.sql
--
-- ── VÌ SAO LÀ BẢNG RIÊNG, KHÔNG NHỒI VÀO `topics` ────────────────────────────
-- Đã cân nhắc dùng lại `topics`/`topic_questions` — được ngay đường ống audio,
-- bộ chọn câu và chốt che chữ. Bác bỏ vì hai lý do đo được, không phải khẩu vị:
--
--   1. `routers/admin.py` XOÁ HÀNG LOẠT và XOAY VÒNG `topics`
--      (`delete().in_("id", existing_ids)`, `last_rotated_at`). Một bộ đề của
--      buổi học nằm lẫn trong đó có thể bị luồng xoay chủ đề xoá mất — mà nó là
--      giáo trình, không phải đề luyện xoay vòng.
--   2. `routers/questions.py` đọc `topics` để sinh đề LUYỆN TỰ DO. Bộ đề buổi
--      học sẽ hiện ra ở nơi không ai giao nó.
--
-- Đường ống audio vẫn dùng chung: `render_question_audio(q, title)` nhận một
-- dict nên vốn đã độc lập với bảng.
--
-- ── PHẠM VI LÀ KHOÁ, KHÔNG PHẢI LỚP ──────────────────────────────────────────
-- `class_lessons` đã có nhưng mỗi dòng thuộc về MỘT lớp (`cohort_id`) và hiện
-- rỗng — nên nó không phải kho tái dùng được. Bộ đề gắn vào `courses` để soạn
-- một lần, mọi lớp của khoá đó dùng lại. Đó chính là chữ "để admin dùng lại".
--
-- Idempotent: IF NOT EXISTS ở mọi lệnh.

BEGIN;

-- ── 1. Bộ đề của một buổi ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS speaking_lesson_sets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_no   INT  NOT NULL CHECK (lesson_no >= 1),
  -- Part nằm ở BỘ ĐỀ, không nằm ở từng câu: một buổi cần cả Part 1 lẫn Part 2
  -- thì soạn hai bộ. Trộn part trong một bộ sẽ buộc phiếu làm bài phải vừa hiện
  -- ô nghe-audio vừa hiện cue card trong cùng một danh sách — hai hình dạng
  -- khác nhau, và người học phải tự đoán ô nào là loại nào.
  part        INT  NOT NULL CHECK (part IN (1, 2, 3)),
  title       TEXT NOT NULL CHECK (btrim(title) <> ''),
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Một khoá chỉ có MỘT bộ đề cho mỗi (buổi, part). Soạn bộ thứ hai cho cùng buổi
-- là dấu hiệu nhầm lẫn, không phải nhu cầu — và nếu thật sự cần thì đổi title
-- không giải quyết được câu "giao bộ nào".
CREATE UNIQUE INDEX IF NOT EXISTS uq_speaking_lesson_set
  ON speaking_lesson_sets (course_id, lesson_no, part);

CREATE INDEX IF NOT EXISTS idx_speaking_lesson_sets_course
  ON speaking_lesson_sets (course_id, lesson_no)
  WHERE is_active;


-- ── 2. Câu hỏi trong bộ ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS speaking_lesson_set_questions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id        UUID NOT NULL REFERENCES speaking_lesson_sets(id) ON DELETE CASCADE,
  order_num     INT  NOT NULL CHECK (order_num >= 1),
  question_text TEXT NOT NULL CHECK (btrim(question_text) <> ''),
  question_type TEXT,
  -- Chủ đề của RIÊNG câu này, để câu đọc thành "Let's talk about food. Question:
  -- When do you usually have breakfast?".
  --
  -- Ở kho chung, chủ đề nằm ở `topics.title` vì cả chủ đề chỉ nói về một thứ.
  -- Bộ đề của một buổi thì KHÁC: 12 câu có thể rải khắp ăn sáng, sách, âm nhạc,
  -- dự định — đọc tên bộ ("C3 · Buổi 1") vào chỗ đó sẽ thành một câu vô nghĩa.
  --
  -- Để TRỐNG được, và trống là hợp lệ: khi ấy câu đọc rút còn "This is Part 1.
  -- Question: …". Thà bỏ lời dẫn còn hơn đọc một lời dẫn sai — và bịa chủ đề hộ
  -- giáo viên là soạn nội dung thay họ.
  topic_label   TEXT,
  level         TEXT CHECK (level IN ('easy', 'medium', 'hard')),
  -- Part 2 dùng hai cột này; Part 1/3 để trống. Cùng hình dạng với
  -- `topic_questions` để phiếu làm bài và bộ chấm không phải phân biệt nguồn.
  cue_card_bullets    JSONB,
  cue_card_reflection TEXT,
  -- Đường lưu audio là BĂM của chính câu đọc (xem services/tts_audio.py). Giữ
  -- `audio_path` để đối chiếu được: một hàng còn băm cũ nghĩa là file đang đọc
  -- một đề khác với đề bộ chấm sẽ dùng.
  audio_url     TEXT,
  audio_path    TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Thứ tự không trùng TRONG SỐ CÂU CÒN BẬT. Điều kiện `WHERE is_active` là cố ý:
-- tắt một câu rồi soạn câu khác vào đúng chỗ đó là việc bình thường, và một
-- ràng buộc toàn bảng sẽ chặn mất.
CREATE UNIQUE INDEX IF NOT EXISTS uq_slsq_order_active
  ON speaking_lesson_set_questions (set_id, order_num)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_slsq_set
  ON speaking_lesson_set_questions (set_id, order_num)
  WHERE is_active;


-- ── 3. Bài giao biết mình thuộc LOẠI nào ─────────────────────────────────────
-- 'daily'  — bài hằng ngày, đề từ `topics`, hạn là mốc trong ngày.
-- 'lesson' — bài sau buổi học, đề từ `speaking_lesson_sets`, hạn N ngày.
--
-- Mặc định 'daily' và NOT NULL: mọi dòng đang có đều là bài hằng ngày, nên
-- backfill là hằng số chứ không phải một phép đoán.
ALTER TABLE class_assignments
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'daily';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'class_assignments'::regclass AND conname = 'class_assignments_kind_check'
  ) THEN
    ALTER TABLE class_assignments
      ADD CONSTRAINT class_assignments_kind_check CHECK (kind IN ('daily', 'lesson'));
  END IF;
END $$;

-- Chỉ mục cũ `uq_class_assignment_speaking_topic_per_cohort (cohort_id,
-- content_id) WHERE skill='speaking'` phục vụ CẢ hai loại mà không phải sửa:
-- `content_id` của bài theo buổi là id bộ đề, và hai không gian uuid không đụng
-- nhau. Luật "đừng giao lại đúng thứ lớp đã làm" áp cho cả hai.


-- ── 4. `updated_at` phải tự đúng ─────────────────────────────────────────────
-- Cùng nếp với courses (175), class_lessons (176), class_assignments (177). Một
-- cột `updated_at` khai ra rồi không ai ghi thì tệ hơn là không có: nó TRÔNG như
-- một mốc sửa đổi, nên người đi kiểm sau này sẽ tin nó và kết luận sai rằng bộ
-- đề chưa hề bị đụng tới.
DROP TRIGGER IF EXISTS update_speaking_lesson_sets_updated_at ON speaking_lesson_sets;
CREATE TRIGGER update_speaking_lesson_sets_updated_at
    BEFORE UPDATE ON speaking_lesson_sets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_slsq_updated_at ON speaking_lesson_set_questions;
CREATE TRIGGER update_slsq_updated_at
    BEFORE UPDATE ON speaking_lesson_set_questions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ── 5. RLS ───────────────────────────────────────────────────────────────────
-- Cả 7 bảng cùng loại (topics, topic_questions, courses, cohorts, class_lessons,
-- class_assignments, class_assignment_items) đều đã bật RLS. Hai bảng này mà để
-- trần thì trở thành bảng public DUY NHẤT của cụm không có chốt: một client cầm
-- khoá anon gọi thẳng PostgREST sửa được `question_text` hoặc `audio_url`, và
-- lần render/giao bài sau sẽ đọc dữ liệu đã bị bơm ấy như sự thật chính thức.
--
-- Học viên KHÔNG đọc trực tiếp hai bảng này: đề tới tay họ qua endpoint
-- service-role, và Part 1/3 còn bị che chữ (services/question_visibility.py).
-- Nên chỉ cần một chính sách admin, giống hệt courses (175) / class_lessons (176).
ALTER TABLE speaking_lesson_sets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE speaking_lesson_set_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS speaking_lesson_sets_admin_all ON speaking_lesson_sets;
CREATE POLICY speaking_lesson_sets_admin_all ON speaking_lesson_sets
    FOR ALL TO authenticated
    USING      (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS slsq_admin_all ON speaking_lesson_set_questions;
CREATE POLICY slsq_admin_all ON speaking_lesson_set_questions
    FOR ALL TO authenticated
    USING      (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

COMMENT ON TABLE speaking_lesson_sets IS
'Kho đề Speaking soạn cho MỘT BUỔI của một khoá (mig 183). Thuộc về khoá chứ
không thuộc về lớp, nên mọi lớp của khoá đó dùng lại được cùng một bộ.';

COMMENT ON COLUMN speaking_lesson_set_questions.topic_label IS
'Chủ đề của RIÊNG câu này, đưa vào lời dẫn "Let''s talk about …". ĐỂ TRỐNG ĐƯỢC:
bộ đề một buổi thường rải nhiều chủ đề, khi ấy bản đọc rút còn "This is Part 1.
Question: …". Sửa cột này là ĐỔI CÂU ĐỌC ⇒ phải xoá audio_url/audio_path.';

COMMIT;

-- ── Kiểm sau khi chạy ────────────────────────────────────────────────────────
-- SELECT to_regclass('speaking_lesson_sets')            IS NOT NULL AS co_bang_bo_de,
--        to_regclass('speaking_lesson_set_questions')   IS NOT NULL AS co_bang_cau,
--        EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_name='class_assignments' AND column_name='kind') AS co_cot_kind;

-- ── Lệnh lùi (chạy tay nếu cần) ──────────────────────────────────────────────
-- ALTER TABLE class_assignments DROP CONSTRAINT IF EXISTS class_assignments_kind_check;
-- ALTER TABLE class_assignments DROP COLUMN IF EXISTS kind;
-- DROP TABLE IF EXISTS speaking_lesson_set_questions;
-- DROP TABLE IF EXISTS speaking_lesson_sets;
