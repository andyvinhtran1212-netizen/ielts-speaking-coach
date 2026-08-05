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

-- Số thứ tự do MÁY CHỦ giữ, để lượt ghi đến MUỘN mà mang bản CŨ không đè lên
-- bản mới. Lúc rời trang, lượt gửi `keepalive` phải bắn NGAY chứ không xếp hàng
-- sau một lượt lưu tự động còn đang bay (nếu không, trang đóng trước khi nó kịp
-- được tạo) — mà bắn ngay thì hai lượt có thể tới ngược thứ tự. Trang xin số
-- này từ máy chủ rồi tăng dần, nên tải lại trang hay đổi máy đều không đặt lại
-- về 0, và không phụ thuộc đồng hồ của máy nào cả (codex PR 949).
ALTER TABLE course_writing_drafts
    ADD COLUMN IF NOT EXISTS seq bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN course_writing_drafts.seq IS
'Số thứ tự tăng dần của bản nháp. Lượt ghi có seq NHỎ HƠN bản đang lưu bị bỏ
qua: nó là một bản cũ tới muộn (mig 194).';

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

-- ── Ghi nháp: MỘT câu lệnh, không phải kiểm-rồi-ghi ─────────────────────────
--
-- Kiểm `seq` bằng một lệnh SELECT riêng rồi mới ghi là hai giao dịch: một lượt
-- mang bản CŨ có thể đọc `seq` cũ (qua cửa kiểm), rồi ghi SAU lượt mang bản mới
-- và đè lên nó. Đúng ca mà `seq` sinh ra để chặn, nên phép so phải nằm TRONG
-- chính lệnh ghi (codex PR 949).
CREATE OR REPLACE FUNCTION fn_save_course_writing_draft(
    p_item    uuid,
    p_user    uuid,
    p_bank    uuid,
    p_answers jsonb,
    -- NULL = KHÔNG XÉT thứ tự (lời gọi cũ chưa gửi số này). Truyền 0 thay cho
    -- NULL là sai: 0 nhỏ hơn mọi bản đã lưu nên lượt ghi bị chặn IM LẶNG.
    p_seq     bigint DEFAULT NULL
)
RETURNS TABLE (saved integer, stale boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO course_writing_drafts (
        class_assignment_item_id, user_id, bank_id, answers, seq, updated_at
    ) VALUES (p_item, p_user, p_bank, COALESCE(p_answers, '{}'::jsonb),
              COALESCE(p_seq, 0), now())
    ON CONFLICT (class_assignment_item_id) DO UPDATE
        SET answers    = EXCLUDED.answers,
            -- GREATEST: một lời gọi không-xét-thứ-tự không được HẠ số đã lưu
            -- xuống, nếu không thì lượt sau của trang lại bị coi là bản cũ.
            seq        = GREATEST(course_writing_drafts.seq, EXCLUDED.seq),
            updated_at = now()
        -- `<=` chứ không `<`: seq BẰNG NHAU là lần gửi lại sau lỗi mạng, không
        -- phải một bản cũ tới muộn.
        WHERE p_seq IS NULL OR course_writing_drafts.seq <= EXCLUDED.seq
    RETURNING id INTO v_id;

    -- Không có dòng nào ⇒ điều kiện trên chặn lại ⇒ đây là bản cũ.
    saved := CASE WHEN v_id IS NULL THEN 0
                  ELSE (SELECT count(*)::integer FROM jsonb_object_keys(COALESCE(p_answers, '{}'::jsonb))) END;
    stale := v_id IS NULL;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION fn_save_course_writing_draft IS
'Ghi bản nháp tự luận trong MỘT câu lệnh. Phép so `seq` nằm trong chính lệnh
ghi, nên một lượt mang bản cũ không thể qua cửa kiểm rồi ghi sau lượt mới
(mig 194).';

-- ── Quyền: BACKEND-ONLY ─────────────────────────────────────────────────────
-- Supabase phơi mọi bảng trong `public` ra PostgREST. Không thu hồi ở đây thì
-- một học viên đăng nhập đọc được bản nháp của cả lớp — và ghi đè được chúng.
ALTER TABLE course_writing_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE course_writing_drafts FROM PUBLIC, anon, authenticated;
GRANT  ALL ON TABLE course_writing_drafts TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_save_course_writing_draft(uuid, uuid, uuid, jsonb, bigint)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_save_course_writing_draft(uuid, uuid, uuid, jsonb, bigint)
    TO service_role;

-- ── Kiểm sau khi chạy ────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'course_writing_drafts' AND column_name = 'seq';
-- Kỳ vọng: seq
--
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
