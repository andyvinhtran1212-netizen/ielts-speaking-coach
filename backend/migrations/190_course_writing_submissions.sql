-- Migration: 190_course_writing_submissions.sql
--
-- Phần TỰ LUẬN của bài tập theo buổi: học viên viết câu, máy chấm NGỮ PHÁP +
-- CHÍNH TẢ (không nâng cấp câu), MỘT LƯỢT DUY NHẤT cho mỗi học viên mỗi bank.
--
-- Vì sao một bảng riêng chứ không nhét vào `quiz_attempts`:
--   · `quiz_attempts` là sổ TỪNG CÂU của trắc nghiệm, gắn với một `session_id`
--     và có `is_correct` bool. Tự luận ở đây chấm CẢ CỤM một lần, không có
--     đúng/sai nhị phân, và bản chấm là văn bản.
--   · "Một lượt duy nhất" phải là một ràng buộc của CƠ SỞ DỮ LIỆU, không phải
--     một câu lệnh if ở tầng ứng dụng. UNIQUE (bank_id, user_id) làm việc đó:
--     lượt thứ hai va khoá, không cần ai nhớ phải kiểm.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/190_course_writing_submissions.sql

CREATE TABLE IF NOT EXISTS course_writing_submissions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id     UUID NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Mục bài giao lúc nộp. SET NULL chứ không CASCADE: bài giao bị xoá không
    -- được kéo theo bài học viên đã viết và đã được chấm.
    class_assignment_item_id UUID
        REFERENCES class_assignment_items(id) ON DELETE SET NULL,

    -- [{qid, prompt, answer, corrected, issues:[{type,before,after,note}], ok}]
    -- Giữ cả `prompt` và `answer` NGUYÊN VĂN tại thời điểm nộp: đề có thể được
    -- soạn lại (đã xảy ra — Buổi 1 đổi 31 câu), và một bản chấm không đọc lại
    -- được cùng đề của nó là một bản chấm không kiểm chứng được.
    items       JSONB NOT NULL,

    -- Số câu / số câu không có lỗi nào. Tách ra cột để bảng của giáo viên khỏi
    -- phải mở jsonb ra đếm.
    total       INT NOT NULL CHECK (total >= 0),
    clean       INT NOT NULL CHECK (clean >= 0),

    model       TEXT,                      -- model đã chấm, để truy vết
    graded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- MỘT LƯỢT DUY NHẤT cho mỗi học viên mỗi bank — xem ghi chú đầu tệp.
    UNIQUE (bank_id, user_id),

    CONSTRAINT course_writing_clean_within_total CHECK (clean <= total)
);

CREATE INDEX IF NOT EXISTS idx_course_writing_user
    ON course_writing_submissions (user_id, bank_id);

CREATE INDEX IF NOT EXISTS idx_course_writing_item
    ON course_writing_submissions (class_assignment_item_id)
    WHERE class_assignment_item_id IS NOT NULL;

COMMENT ON TABLE course_writing_submissions IS
    'Phần tự luận bài tập theo buổi: một lượt nộp + một lượt chấm ngữ pháp/chính tả cho mỗi học viên mỗi bank.';
COMMENT ON COLUMN course_writing_submissions.items IS
    'Bản chụp [{qid, prompt, answer, corrected, issues[], ok}] tại thời điểm chấm — đề có thể được soạn lại về sau.';

-- RLS: chỉ service_role đọc/ghi, y như các bảng quiz khác. Học viên đi qua
-- endpoint đã xác thực; đọc thẳng bảng sẽ vượt qua cổng "bài giao còn mở".
ALTER TABLE course_writing_submissions ENABLE ROW LEVEL SECURITY;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'course_writing_submissions' ORDER BY ordinal_position;
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'course_writing_submissions'::regclass;
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'course_writing_submissions';
--
-- Rollback:
-- DROP TABLE IF EXISTS course_writing_submissions;
