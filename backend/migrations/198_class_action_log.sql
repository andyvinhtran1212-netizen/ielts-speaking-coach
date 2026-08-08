-- Migration: 198_class_action_log.sql
--
-- NHẬT KÝ THAO TÁC CỦA GIÁO VIÊN LÊN HỒ SƠ HỌC VIÊN.
--
-- ── Vì sao cần ───────────────────────────────────────────────────────────────
-- Ngày 08/08 ship hai đường cho phép giáo viên SỬA thứ đã ghi vào sổ lớp:
--
--   · đổi hạn nộp (#1005) — viết lại luôn hồ sơ đúng-hạn/nộp-trễ của những em đã
--     nộp, vì "nộp trễ" là suy ra lúc đọc chứ không lưu (mig 177);
--   · trả bài (#1000) — gỡ một lượt nộp khỏi mục để em ấy làm lại.
--
-- Cả hai đều đổi thứ học viên sẽ nhìn thấy, và cho tới nay KHÔNG đường nào để
-- lại dấu ai làm. Dấu vết duy nhất là một dòng log máy chủ — thứ hết hạn theo
-- chính sách giữ log, không truy vấn được, và không ai mở ra khi có tranh cãi.
--
-- Câu cần trả lời được, ba tháng sau, khi một em hỏi "sao bài em thành nộp trễ":
-- ai đổi, lúc nào, từ giá trị nào sang giá trị nào.
--
-- ── Vì sao là bảng RIÊNG, không phải cột trên `class_assignments` ────────────
-- Một cột `last_changed_by` chỉ giữ được LẦN CUỐI. Chuỗi thao tác mới là thứ
-- giải thích được một hồ sơ: dời hạn, rồi trả bài, rồi dời tiếp. Ghi đè lần
-- trước là xoá đúng phần cần đọc.
--
-- ── Ghi rồi thì KHÔNG sửa ────────────────────────────────────────────────────
-- Không có cột `updated_at`, và không đường nào trong sản phẩm sửa hay xoá dòng
-- ở đây. Một nhật ký sửa được thì không phải nhật ký.
--
-- Idempotent. Forward-only.

BEGIN;

CREATE TABLE IF NOT EXISTS class_action_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Việc gì. Danh sách MỞ RỘNG được (thêm giá trị = sửa CHECK), nhưng cố ý
  -- không để tự do: một cột text tự do sẽ có bốn cách viết cho cùng một việc
  -- sau nửa năm, và không thống kê nổi.
  action        TEXT NOT NULL CHECK (action IN ('due_change', 'return_work')),

  -- Bối cảnh. `cohort_id` NOT NULL vì mọi thao tác đều thuộc một lớp; hai cái
  -- còn lại tuỳ việc (đổi hạn không nhắm vào một em nào).
  cohort_id     UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  assignment_id UUID REFERENCES class_assignments(id) ON DELETE SET NULL,
  student_id    UUID REFERENCES students(id) ON DELETE SET NULL,

  -- Ai làm. KHÔNG có khoá ngoại và KHÔNG ON DELETE: nhật ký phải sống sót qua
  -- việc xoá tài khoản, nếu không thì xoá người là xoá luôn dấu vết của họ.
  -- Chép kèm email lúc thao tác vì `users` có thể đổi hoặc mất dòng.
  actor_user_id UUID,
  actor_email   TEXT,

  -- Trước → sau, và mọi thứ cần để đọc lại thao tác mà không phải đoán. Với
  -- `due_change`: previous_due_at, due_at, flips. Với `return_work`:
  -- artifact_kind, artifact_id, score_cleared, draft_restored.
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Đọc theo LỚP, mới nhất trước — đúng cách màn hình hỏi.
CREATE INDEX IF NOT EXISTS idx_class_action_log_cohort
  ON class_action_log (cohort_id, created_at DESC);

-- Và theo BÀI GIAO, cho câu hỏi "bài này đã bị đổi những gì".
CREATE INDEX IF NOT EXISTS idx_class_action_log_assignment
  ON class_action_log (assignment_id, created_at DESC)
  WHERE assignment_id IS NOT NULL;

ALTER TABLE class_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cal_admin_all ON class_action_log;
CREATE POLICY cal_admin_all ON class_action_log
    FOR ALL TO authenticated
    USING      (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

COMMENT ON TABLE class_action_log IS
'Nhật ký thao tác của giáo viên lên hồ sơ học viên (mig 198): đổi hạn nộp, trả
bài. Chỉ THÊM — không đường nào sửa hay xoá dòng ở đây. Tồn tại để ba tháng sau
còn trả lời được "ai đổi, lúc nào, từ gì sang gì" khi một em hỏi vì sao bài mình
thành nộp trễ.';

COMMENT ON COLUMN class_action_log.actor_user_id IS
'Không có khoá ngoại, có chủ ý: nhật ký phải sống sót qua việc xoá tài khoản.
`actor_email` là bản chép lúc thao tác, vì `users` có thể đổi hoặc mất dòng.';

COMMIT;

-- ── Kiểm sau khi chạy ────────────────────────────────────────────────────────
-- SELECT to_regclass('class_action_log') IS NOT NULL AS co_bang,
--        (SELECT relrowsecurity FROM pg_class WHERE relname='class_action_log') AS rls_bat,
--        (SELECT count(*) FROM pg_policy p
--           JOIN pg_class c ON c.oid = p.polrelid
--          WHERE c.relname='class_action_log') AS so_policy;

-- ── Lệnh lùi ────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS class_action_log;
