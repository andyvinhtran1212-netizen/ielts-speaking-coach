-- Dời hạn bài giao "Grammar 1" của lớp TUE-FRI (18H): 07/08 19:00 → 09/08 19:00.
--
--   export $(grep -m1 '^DATABASE_URL=' backend/.env | xargs) && \
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f backend/scripts/extend_grammar1_deadline.sql
--
-- ── VÌ SAO PHẢI LÀ SQL ───────────────────────────────────────────────────────
-- `PATCH /admin/cohorts/{id}/assignments/{id}` CHỈ nhận `status` (lưu trữ / mở
-- lại). Không có đường nào trong sản phẩm để đổi hạn nộp — đó là một lỗ hổng
-- riêng, đã ghi lại; chạy tay là đường duy nhất hôm nay.
--
-- ── AI ĐƯỢC LỢI ──────────────────────────────────────────────────────────────
--   Hà Linh     — 65%, cần thêm một lượt kiểm tra lại để chạm ngưỡng 75
--   Nam Nguyễn  — vừa đạt 95% lúc 16:30 nhưng CHƯA nộp tự luận; quá hạn thì sổ
--                 của em ấy treo mãi (mục chỉ đóng bằng lượt nộp tự luận)
--   Phan ViVi, Andy (Test) — chưa làm gì
--
-- ── VÌ SAO KHÔNG HẠI AI ──────────────────────────────────────────────────────
-- "Nộp trễ" là SUY RA lúc đọc (`submitted_at > due_at`), không lưu — nên dời
-- hạn về sau sẽ VIẾT LẠI hồ sơ đúng-hạn của những em đã nộp trễ. Ở lớp này
-- không có ai như thế: cả 11 lượt nộp đều trước 19:00. Chốt bên dưới kiểm đúng
-- điều đó và HUỶ giao dịch nếu sai.
--
-- Bài giao cũng mở lại (`is_accepting_submissions` = còn hạn), nên bảng tổng
-- kết quay về "đang nhận bài" — đúng ý, và các em đã đạt không đổi gì.

\timing on
\set ON_ERROR_STOP on

\echo '=== TRƯỚC ==='
SELECT a.title,
       to_char(a.due_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'Dy DD/MM HH24:MI') AS han_cu,
       (a.due_at > NOW())                                   AS con_nhan_bai,
       COUNT(*) FILTER (WHERE i.submitted_at IS NOT NULL)    AS da_nop,
       COUNT(*) FILTER (WHERE i.submitted_at > a.due_at)     AS dang_tinh_la_tre,
       COUNT(*)                                             AS si_so
  FROM class_assignments a
  JOIN class_assignment_items i ON i.assignment_id = a.id
 WHERE a.id = 'd98b87b9-f79f-4a91-8083-54f7cdadc856'
 GROUP BY a.title, a.due_at;

BEGIN;

-- Ghi bằng giờ VIỆT NAM viết tường minh, không bằng UTC quy đổi tay: quy đổi
-- tay là chỗ lệch một tiếng không ai thấy cho tới khi có em nộp lúc 19:30.
UPDATE class_assignments
   SET due_at = TIMESTAMPTZ '2026-08-09 19:00:00+07',
       updated_at = NOW()
 WHERE id = 'd98b87b9-f79f-4a91-8083-54f7cdadc856'
   AND cohort_id = '086919d4-c968-4486-890d-633d9a8b575f';

-- ── CHỐT TRƯỚC KHI CHỐT SỔ ──────────────────────────────────────────────────
DO $$
DECLARE n INT; d TIMESTAMPTZ;
BEGIN
    SELECT due_at INTO d FROM class_assignments
     WHERE id = 'd98b87b9-f79f-4a91-8083-54f7cdadc856';
    IF d IS DISTINCT FROM TIMESTAMPTZ '2026-08-09 19:00:00+07' THEN
        RAISE EXCEPTION 'hạn mới không đúng: %', d;
    END IF;

    -- Không được có ai từ "nộp trễ" thành "đúng hạn" — dời hạn không phải để
    -- xoá lịch sử của người khác. Ở lớp này con số ấy vốn là 0; nếu nó khác 0
    -- thì tiền đề của cả việc này sai và phải dừng lại.
    SELECT COUNT(*) INTO n
      FROM class_assignment_items i
     WHERE i.assignment_id = 'd98b87b9-f79f-4a91-8083-54f7cdadc856'
       AND i.submitted_at > TIMESTAMPTZ '2026-08-07 19:00:00+07';
    IF n > 0 THEN
        RAISE EXCEPTION 'có % lượt nộp SAU hạn cũ — dời hạn sẽ xoá dấu nộp trễ của họ', n;
    END IF;
END $$;

COMMIT;

\echo '=== SAU ==='
SELECT a.title,
       to_char(a.due_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'Dy DD/MM HH24:MI') AS han_moi,
       (a.due_at > NOW())                                AS con_nhan_bai,
       COUNT(*) FILTER (WHERE i.submitted_at IS NULL)     AS con_cho_nop
  FROM class_assignments a
  JOIN class_assignment_items i ON i.assignment_id = a.id
 WHERE a.id = 'd98b87b9-f79f-4a91-8083-54f7cdadc856'
 GROUP BY a.title, a.due_at;
