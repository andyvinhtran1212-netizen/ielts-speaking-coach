-- Migration: 219_quiz_rpc_and_writing_view_hardening.sql
-- Mô tả: ghi lại hardening đang chạy trên production/staging để môi trường mới
-- không dựng các RPC analytics với mutable search_path và không dựng view đọc
-- Writing theo quyền owner.
--
-- Migration 108 đã khóa các SECURITY DEFINER helper và migration 197 đã bật
-- RLS cho mọi bảng public. Phần còn thiếu trong lịch sử repo là bốn RPC được
-- tạo sau migration 108 (121/123) và view được tạo ở migration 109.
-- Idempotent: ALTER lặp lại cùng cấu hình là no-op về hành vi.

ALTER FUNCTION public.quiz_admin_student_rollup(text)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.quiz_item_error_rates(uuid)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.quiz_skill_error_rates(uuid)
    SET search_path = public, pg_temp;

ALTER FUNCTION public.quiz_user_bank_progress(uuid)
    SET search_path = public, pg_temp;

ALTER VIEW public.writing_feedback_current
    SET (security_invoker = on);

-- Verification:
-- SELECT p.proname, p.proconfig
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN (
--     'quiz_admin_student_rollup',
--     'quiz_item_error_rates',
--     'quiz_skill_error_rates',
--     'quiz_user_bank_progress'
--   )
-- ORDER BY p.proname;
--
-- SELECT reloptions
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND c.relname = 'writing_feedback_current';
