-- Migration: 195_drop_course_writing_draft_seq.sql
--
-- Dọn dấu vết của bản thiết kế ĐẦU cho bản nháp tự luận.
--
-- Chạy một lần (SAU mig 194):
--   export $(grep -m1 '^DATABASE_URL=' backend/.env | xargs) && \
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/195_drop_course_writing_draft_seq.sql
--
-- ── VÌ SAO LÀ MỘT MIGRATION RIÊNG ────────────────────────────────────────────
-- Bản 194 ĐẦU TIÊN cho máy chủ làm nguồn thật, nên có thêm cột `seq` và một hàm
-- ghi nguyên tử để chặn "bản cũ tới muộn". Thiết kế ấy đẻ ra ba đường mất bài
-- nên đã đảo lại: máy đang gõ là nguồn thật, máy chủ chỉ giữ một bản DỰ PHÒNG —
-- và khi ấy "lượt ghi sau cùng thắng" là đủ.
--
-- Sửa thẳng vào tệp 194 thì KHÔNG DỌN ĐƯỢC gì cả: `apply_migrations.sh` bỏ qua
-- mọi tệp đã có tên trong sổ `_schema_migrations`. Môi trường nào đã chạy bản
-- 194 cũ sẽ giữ `seq` và hàm cũ vĩnh viễn, trong khi mã mới không còn dùng
-- chúng (codex cục bộ 05/08).
--
-- Cả hai lệnh đều `IF EXISTS`, nên môi trường sạch (chưa từng có bản 194 cũ)
-- chạy qua vô hại.

DROP FUNCTION IF EXISTS fn_save_course_writing_draft(uuid, uuid, uuid, jsonb, bigint);
ALTER TABLE course_writing_drafts DROP COLUMN IF EXISTS seq;

-- ── Kiểm sau khi chạy ────────────────────────────────────────────────────────
-- SELECT count(*) FROM information_schema.columns
--  WHERE table_name = 'course_writing_drafts' AND column_name = 'seq';
-- Kỳ vọng: 0
--
-- SELECT count(*) FROM pg_proc WHERE proname = 'fn_save_course_writing_draft';
-- Kỳ vọng: 0
--
-- Rollback: không cần — cả hai đều là dấu vết của một thiết kế đã bỏ.
