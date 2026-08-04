-- Migration: 186_quiz_why_wrong_and_lesson.sql
-- Kho bài tập theo BUỔI cho Course 1: giải thích từng phương án nhiễu + gắn bank vào buổi học.
--
-- Chạy một lần:
--   export $(grep -m1 '^DATABASE_URL=' backend/.env | xargs) && \
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/186_quiz_why_wrong_and_lesson.sql
--
-- ── 1. `why_wrong` — TÍNH NĂNG ĐÃ DỰNG, CHƯA TỪNG CÓ DỮ LIỆU ────────────────
-- `services/quiz_why_wrong.py` đã có từ đợt audit GĐ3 (#7a) kèm bộ kiểm, nhưng
-- không bank nào điền được nên nó nằm không: `explain` chỉ nói vì sao đáp án
-- ĐÚNG là đúng, còn học viên chọn nhiễu thì không học được gì về chính lỗi mình
-- vừa mắc.
--
-- Kho Course 1 có sẵn đúng dữ liệu ấy: mỗi câu kèm một mảng `bay`, mỗi ô là một
-- HIỂU LẦM CỤ THỂ mà phương án đó đang bẫy. Đây là chỗ cất nó.
--
-- Dạng: {"1": "vì sao phương án 1 sai", "2": "…"} — khoá là CHỈ SỐ phương án
-- dưới dạng chuỗi (JSON không có khoá số), chỉ gồm phương án SAI.
--
-- NULLABLE và mặc định NULL: 12.581 câu đang có đều không có nó, và ép NOT NULL
-- sẽ biến một tính năng tuỳ chọn thành một đợt sửa dữ liệu bắt buộc.
--
-- ── 2. Gắn bank vào BUỔI HỌC của một KHOÁ ───────────────────────────────────
-- `quiz_banks` đang được nhận diện bằng `code` và gom bằng `skill_area`. Một kho
-- bài tập theo buổi cần trả lời được "buổi 3 của khoá C1 có bài nào" — hỏi bằng
-- cách khớp chuỗi trong `code` là hẹn ngày một mã đặt sai làm cả buổi biến mất.
--
-- Dùng cột thật thay vì nhét vào `meta`: đây là thứ để LỌC và SẮP XẾP, còn `meta`
-- không có chỉ mục và mọi truy vấn trên nó là quét toàn bảng.

BEGIN;

ALTER TABLE quiz_questions
  ADD COLUMN IF NOT EXISTS why_wrong JSONB;

ALTER TABLE quiz_banks
  ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lesson_no INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'quiz_banks'::regclass AND conname = 'quiz_banks_lesson_no_check'
  ) THEN
    ALTER TABLE quiz_banks
      ADD CONSTRAINT quiz_banks_lesson_no_check CHECK (lesson_no IS NULL OR lesson_no >= 1);
  END IF;
END $$;

-- Một khoá chỉ có MỘT bộ bài tập cho mỗi buổi. Nạp lại tệp đã sửa phải cập nhật
-- bộ cũ, không tạo bộ thứ hai — hai bộ cùng buổi thì không ai biết giao bộ nào.
CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_bank_course_lesson
  ON quiz_banks (course_id, lesson_no)
  WHERE course_id IS NOT NULL AND lesson_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quiz_banks_course
  ON quiz_banks (course_id, lesson_no)
  WHERE course_id IS NOT NULL;

-- ── 3. RPC nhập câu phải MANG THEO cột mới ──────────────────────────────────
-- `quiz_replace_questions` dựng dòng bằng `jsonb_to_recordset` với danh sách cột
-- KHAI CỨNG. Thêm `why_wrong` vào payload mà không sửa hàm thì khoá ấy bị BỎ
-- QUA IM LẶNG: bộ nhập báo đủ 100 câu, đếm ra 100 dòng, và cột mới rỗng trơn —
-- không có lỗi nào để lần ra.
--
-- Chữ ký không đổi nên `CREATE OR REPLACE` là đủ (không tạo hàm nạp chồng), và
-- nó GIỮ NGUYÊN phân quyền hiện có thay vì cấp lại cho PUBLIC.
CREATE OR REPLACE FUNCTION public.quiz_replace_questions(p_bank_id uuid, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n INTEGER;
BEGIN
    DELETE FROM quiz_questions WHERE bank_id = p_bank_id;
    INSERT INTO quiz_questions (
        bank_id, qid, item_key, type, subtype, input, skill, pair,
        counts_toward_mastery, prompt, hint, options, answer, accept, segments,
        mask, pairs, explain, why_wrong, points, audio_url, grammar_article_slug, "order")
    SELECT p_bank_id, x.qid, x.item_key, x.type, x.subtype, x.input, x.skill, x.pair,
        COALESCE(x.counts_toward_mastery, TRUE), x.prompt, x.hint, x.options, x.answer,
        x.accept, x.segments, x.mask, x.pairs, x.explain, x.why_wrong, COALESCE(x.points, 1),
        x.audio_url, x.grammar_article_slug, COALESCE(x."order", 0)
    FROM jsonb_to_recordset(p_rows) AS x(
        qid TEXT, item_key TEXT, type TEXT, subtype TEXT, input TEXT, skill TEXT, pair TEXT,
        counts_toward_mastery BOOLEAN, prompt TEXT, hint TEXT, options JSONB, answer INT,
        accept JSONB, segments JSONB, mask TEXT, pairs JSONB, explain TEXT, why_wrong JSONB,
        points INT, audio_url TEXT, grammar_article_slug TEXT, "order" INT);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END; $function$;

-- ── 4. Khoá RPC lại cho backend ─────────────────────────────────────────────
-- Hàm này XOÁ SẠCH rồi ghi lại câu hỏi của một bank. Nó đang được cấp EXECUTE
-- cho `anon` và `authenticated` — hôm nay chưa khai thác được vì `quiz_questions`
-- bật RLS mà không có policy nào (client bị chặn hết, service_role đi vòng qua),
-- nhưng đó là một chốt GIÁN TIẾP: thêm một policy ghi cho `authenticated` vì lý
-- do gì đó trong tương lai là mở luôn cả cửa này.
--
-- Chỉ có `services/quiz_import.py` gọi nó, qua `supabase_admin` (service_role).
-- Cùng khuôn với mig 161/174/179/184.
REVOKE EXECUTE ON FUNCTION public.quiz_replace_questions(uuid, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.quiz_replace_questions(uuid, jsonb)
    TO service_role;

COMMENT ON COLUMN quiz_questions.why_wrong IS
'Vì sao TỪNG phương án nhiễu sai: {"<chỉ số>": "hiểu lầm mà nó đang bẫy"}. Chỉ
gồm phương án SAI; ô của đáp án đúng không có mặt. `explain` nói vì sao đáp án
đúng là đúng — hai thứ khác nhau, và học viên chọn nhiễu chỉ học được từ cái
thứ hai. Kiểm bằng services/quiz_why_wrong.py.';

COMMENT ON COLUMN quiz_banks.lesson_no IS
'Buổi học trong khoá (mig 186). NULL với bank không thuộc giáo trình theo buổi —
bank từ vựng và Quick Check ngữ pháp đều để trống.';

COMMIT;

-- ── Kiểm sau khi chạy ────────────────────────────────────────────────────────
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.columns
--           WHERE table_name='quiz_questions' AND column_name='why_wrong')  AS co_why_wrong,
--   EXISTS (SELECT 1 FROM information_schema.columns
--           WHERE table_name='quiz_banks' AND column_name='lesson_no')      AS co_lesson_no,
--   (SELECT count(*) FROM quiz_questions WHERE why_wrong IS NOT NULL)       AS so_cau_da_co;

-- ── Lệnh lùi ────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS uq_quiz_bank_course_lesson;
-- DROP INDEX IF EXISTS idx_quiz_banks_course;
-- ALTER TABLE quiz_banks DROP CONSTRAINT IF EXISTS quiz_banks_lesson_no_check;
-- ALTER TABLE quiz_banks DROP COLUMN IF EXISTS lesson_no, DROP COLUMN IF EXISTS course_id;
-- ALTER TABLE quiz_questions DROP COLUMN IF EXISTS why_wrong;
