-- Migration: 194_course_writing_drafts.sql
--
-- Bản NHÁP phần tự luận sống trên máy chủ, không chỉ trong một trình duyệt.
--
-- Chạy một lần (SAU mig 193):
--   export $(grep -m1 '^DATABASE_URL=' backend/.env | xargs) && \
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/194_course_writing_drafts.sql
--
-- ── VÌ SAO ───────────────────────────────────────────────────────────────────
-- Phần tự luận có MỘT lượt nộp duy nhất, nên học viên thường viết dần trong
-- nhiều buổi. Tới nay bản nháp chỉ nằm trong `localStorage`: đổi máy, xoá bộ
-- nhớ trình duyệt, hay dùng máy phòng lab là mất trắng — và không ai nhìn thấy
-- được, kể cả chính em ấy.
--
-- Đây đúng lớp lỗi đã sửa cho phần trắc nghiệm (mã bài làm dở chỉ sống trong
-- bộ nhớ tab). Sửa cùng một cách: máy chủ giữ, trình duyệt chỉ là bộ đệm.
--
-- ── VÌ SAO BẢNG RIÊNG, KHÔNG NHỒI VÀO course_writing_submissions ─────────────
-- Bảng ấy mô tả một lượt ĐÃ CHẤM: `items`, `total`, `clean`, `graded_at` đều
-- NOT NULL, và một index duy-nhất-mỗi-mục canh "một lượt nộp cho mỗi bài giao"
-- (mig 192). Cho nháp vào đó buộc phải nới lỏng đúng những ràng buộc ấy — tức
-- là đánh đổi một bảo đảm thật lấy một chỗ chứa tạm.

CREATE TABLE IF NOT EXISTS course_writing_drafts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Khoá theo MỤC BÀI GIAO, không theo (bank, học viên): giao lại cùng bộ bài
    -- là một lượt MỚI, và nháp của lần trước không được rót vào lần này
    -- (cùng lý do mig 192).
    class_assignment_item_id uuid NOT NULL
        REFERENCES class_assignment_items(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bank_id      uuid NOT NULL,
    -- {qid: câu học viên đang viết}. Rỗng là hợp lệ — em ấy mở ra rồi đóng lại.
    answers      jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- MỘT bản nháp cho mỗi mục bài giao. Không có ràng buộc này thì mỗi lần lưu
-- đẻ thêm một dòng, và lần đọc sau không biết dòng nào là mới nhất.
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_writing_draft_per_item
    ON course_writing_drafts (class_assignment_item_id);

-- Đọc luôn đi kèm người dùng (mặt đọc của học viên), nên đánh chỉ mục để một
-- lớp làm bài cùng lúc không quét cả bảng.
CREATE INDEX IF NOT EXISTS ix_course_writing_draft_user
    ON course_writing_drafts (user_id, bank_id);

COMMENT ON TABLE course_writing_drafts IS
'Bản nháp phần tự luận (mig 194). Một dòng cho mỗi MỤC BÀI GIAO. Máy chủ giữ để
nháp sống qua đổi máy và xoá bộ nhớ trình duyệt; bảng bài ĐÃ CHẤM vẫn là
course_writing_submissions và không đổi.';

-- ── Quyền: BACKEND-ONLY ─────────────────────────────────────────────────────
-- Supabase phơi mọi bảng trong `public` ra PostgREST. Không thu hồi ở đây thì
-- một học viên đăng nhập đọc được bản nháp của cả lớp — và ghi đè được chúng.
ALTER TABLE course_writing_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE course_writing_drafts FROM PUBLIC, anon, authenticated;
GRANT  ALL ON TABLE course_writing_drafts TO service_role;

-- ── Kiểm sau khi chạy ────────────────────────────────────────────────────────
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'course_writing_drafts';
-- Kỳ vọng: t
--
-- SELECT indexname FROM pg_indexes WHERE tablename = 'course_writing_drafts';
-- Kỳ vọng: có uq_course_writing_draft_per_item và ix_course_writing_draft_user
--
-- SELECT has_table_privilege('anon',          'course_writing_drafts', 'SELECT') AS anon_doc,
--        has_table_privilege('authenticated', 'course_writing_drafts', 'SELECT') AS hv_doc,
--        has_table_privilege('service_role',  'course_writing_drafts', 'SELECT') AS backend_doc;
-- Kỳ vọng: f | f | t
--
-- Rollback: DROP TABLE IF EXISTS course_writing_drafts;
