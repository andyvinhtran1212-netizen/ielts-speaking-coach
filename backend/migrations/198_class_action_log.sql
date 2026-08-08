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

  -- Bối cảnh. KHÔNG khoá ngoại nào ở đây, và đó là một quyết định, không phải
  -- một thiếu sót — cùng lý do đã áp cho `actor_user_id` bên dưới:
  --
  --   · Nhật ký là bản ghi về QUÁ KHỨ. Vòng đời của bảng khác không được sửa
  --     hay xoá nó: `ON DELETE CASCADE` sẽ xoá dấu vết cùng với lớp, còn
  --     `ON DELETE SET NULL` sẽ bào mòn nó dần cho tới khi chỉ còn "có người
  --     đổi cái gì đó".
  --   · Và ON DELETE ĐỤNG THẲNG vào hợp đồng chỉ-thêm: Postgres thực hiện
  --     SET NULL bằng một lệnh UPDATE lên chính bảng này, còn CASCADE bằng
  --     DELETE — trigger bên dưới chặn cả hai, nên xoá một bài giao đã có dòng
  --     nhật ký sẽ HỎNG. Đúng chức năng "Xoá" đang chạy trên trang lớp (codex
  --     cục bộ 08/08, P1).
  --
  -- Trả giá: không có ràng buộc toàn vẹn, nên id ở đây có thể trỏ vào một dòng
  -- đã bị xoá. Bản chép tên bên dưới là thứ khiến trả giá ấy chấp nhận được.
  cohort_id     UUID NOT NULL,
  assignment_id UUID,
  student_id    UUID,

  -- BẢN CHÉP TÊN, cùng lý do với `actor_email`. Không có khoá ngoại nên xoá bài
  -- giao (hay học viên) sẽ cắt đường tra tên sống; chép tên lúc thao tác thì
  -- dòng nhật ký vẫn gọi được tên đối tượng mãi về sau.
  assignment_title TEXT,
  student_name     TEXT,

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

-- CHỈ ĐỌC VÀ THÊM. Không có policy UPDATE/DELETE, nên RLS chặn hai lệnh ấy cho
-- mọi vai thường.
--
-- Bản đầu của migration này cấp `FOR ALL` — tức là chính người đang bị nhật ký
-- ghi lại có thể sửa hoặc xoá bằng chứng về mình, qua PostgREST, bằng đúng
-- phiên đăng nhập admin đang mở. Nó phản lại câu "chỉ THÊM" viết ở đầu tệp
-- (codex #1010).
DROP POLICY IF EXISTS cal_admin_all ON class_action_log;

DROP POLICY IF EXISTS cal_admin_read ON class_action_log;
CREATE POLICY cal_admin_read ON class_action_log
    FOR SELECT TO authenticated
    USING (public.is_current_user_admin());

DROP POLICY IF EXISTS cal_admin_append ON class_action_log;
CREATE POLICY cal_admin_append ON class_action_log
    FOR INSERT TO authenticated
    WITH CHECK (public.is_current_user_admin());

-- RLS KHÔNG đủ một mình: `service_role` (backend dùng) bỏ qua RLS hoàn toàn,
-- nên một lỗi lập trình phía máy chủ vẫn xoá được nhật ký. Trigger dưới đây
-- ràng buộc ở tầng bảng, áp cho MỌI vai.
--
-- Cần dọn thật (yêu cầu xoá dữ liệu cá nhân chẳng hạn) thì phải TẮT trigger một
-- cách có ý thức:
--   ALTER TABLE class_action_log DISABLE TRIGGER trg_class_action_log_append_only;
-- Đúng như thế: xoá một dòng nhật ký phải là một hành động ai đó cố ý làm và
-- ghi lại được, không phải một lệnh UPDATE lọt qua.
-- `SET search_path` là quy ước bắt buộc của kho (README migrations, và mig
-- 108/113 đã ghim lại cho các hàm cũ): search_path thả nổi cho phép một lược đồ
-- khác che mất đối tượng mà hàm tham chiếu, và Supabase Security Advisor bắt
-- đúng điều này.
CREATE OR REPLACE FUNCTION public.fn_class_action_log_append_only()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION
      'class_action_log chỉ THÊM: không sửa, không xoá (mig 198). Cần dọn thì '
      'tắt trigger trg_class_action_log_append_only một cách có ý thức.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_class_action_log_append_only ON class_action_log;
CREATE TRIGGER trg_class_action_log_append_only
    BEFORE UPDATE OR DELETE ON class_action_log
    FOR EACH ROW EXECUTE FUNCTION public.fn_class_action_log_append_only();

COMMENT ON TABLE class_action_log IS
'Nhật ký thao tác của giáo viên lên hồ sơ học viên (mig 198): đổi hạn nộp, trả
bài. Chỉ THÊM — không đường nào sửa hay xoá dòng ở đây. Tồn tại để ba tháng sau
còn trả lời được "ai đổi, lúc nào, từ gì sang gì" khi một em hỏi vì sao bài mình
thành nộp trễ.';

COMMENT ON COLUMN class_action_log.actor_user_id IS
'Không có khoá ngoại, có chủ ý: nhật ký phải sống sót qua việc xoá tài khoản.
`actor_email` là bản chép lúc thao tác, vì `users` có thể đổi hoặc mất dòng.';

COMMENT ON COLUMN class_action_log.assignment_title IS
'Bản chép tên lúc thao tác. `assignment_id` KHÔNG có khoá ngoại (xem chú thích
trong migration), nên xoá bài giao sẽ cắt đường tra tên — mà một dòng nhật ký
không gọi được tên đối tượng thì mất đúng phần cần đọc. Mặt đọc lấy tên SỐNG
trước, rơi về bản chép này khi bài giao đã bị xoá.';

COMMIT;

-- ── Kiểm sau khi chạy ────────────────────────────────────────────────────────
-- SELECT to_regclass('class_action_log') IS NOT NULL AS co_bang,
--        (SELECT relrowsecurity FROM pg_class WHERE relname='class_action_log') AS rls_bat,
--        (SELECT count(*) FROM pg_policy p
--           JOIN pg_class c ON c.oid = p.polrelid
--          WHERE c.relname='class_action_log') AS so_policy,   -- kỳ vọng 2
--        (SELECT count(*) FROM pg_trigger t
--           JOIN pg_class c ON c.oid = t.tgrelid
--          WHERE c.relname='class_action_log' AND NOT t.tgisinternal) AS so_trigger;
--
-- Và thử CHÍNH hợp đồng "chỉ thêm" — hai lệnh dưới phải BÁO LỖI:
--   UPDATE class_action_log SET action='due_change' WHERE false;
--   DELETE FROM class_action_log WHERE false;
--
-- Không được có khoá ngoại nào trỏ ra khỏi bảng này — có là xoá bài giao/lớp sẽ
-- đụng trigger rồi hỏng. Kỳ vọng 0 dòng:
--   SELECT conname FROM pg_constraint
--    WHERE conrelid='class_action_log'::regclass AND contype='f';

-- ── Lệnh lùi ────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS class_action_log;
