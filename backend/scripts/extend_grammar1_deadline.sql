-- Dời hạn bài giao "Grammar 1" của lớp TUE-FRI (18H): 07/08 19:00 → 09/08 19:00.
--
-- ĐÃ CHẠY trên prod 07/08/2026 16:5x (UPDATE 1). Chạy lần nữa sẽ HUỶ giao dịch
-- vì chốt so-sánh-rồi-đổi thấy hạn không còn là 07/08 — đó là hành vi đúng.
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

-- SO SÁNH RỒI ĐỔI. Lệnh `UPDATE` chỉ nêu id thì nó ghi đè bất kể giá trị đang
-- có là gì — và giữa lúc chạy thử với lúc chạy thật, hoặc giữa hai lần chạy,
-- hạn có thể đã được ai đó đổi. Khi ấy kịch bản lặng lẽ thay một giá trị MỚI
-- HƠN bằng giá trị cũ, và chốt phía dưới vẫn xanh vì nó chỉ hỏi "hạn có đúng
-- 09/08 không" chứ không hỏi "ta có đổi đúng thứ mình tưởng không" (codex #996).
--
-- Nêu hạn CŨ trong điều kiện, rồi đòi ĐÚNG MỘT dòng đổi. 0 dòng nghĩa là tiền
-- đề sai — hạn đã khác — và đúng lúc ấy phải DỪNG chứ không phải ghi tiếp.
--
-- Hệ quả có chủ ý: chạy kịch bản này LẦN THỨ HAI sẽ huỷ giao dịch, vì hạn lúc
-- ấy đã là 09/08. Đó là hành vi đúng.
DO $$
DECLARE n INT;
BEGIN
    UPDATE class_assignments
       SET due_at = TIMESTAMPTZ '2026-08-09 19:00:00+07',
           updated_at = NOW()
     WHERE id = 'd98b87b9-f79f-4a91-8083-54f7cdadc856'
       AND cohort_id = '086919d4-c968-4486-890d-633d9a8b575f'
       AND due_at = TIMESTAMPTZ '2026-08-07 19:00:00+07';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
        RAISE EXCEPTION
          'không đổi: kỳ vọng ĐÚNG 1 dòng đang mang hạn cũ 07/08 19:00, thấy % dòng. '
          'Hạn đã bị đổi từ lúc soạn kịch bản (hoặc kịch bản đã chạy rồi) — '
          'đọc lại hạn hiện tại trước khi làm gì tiếp.', n;
    END IF;

    -- Không được có ai từ "nộp trễ" thành "đúng hạn" — dời hạn không phải để
    -- xoá lịch sử của người khác. "Nộp trễ" là SUY RA lúc đọc chứ không lưu,
    -- nên dời hạn về sau viết lại hồ sơ ấy. Ở lớp này con số vốn là 0; khác 0
    -- thì tiền đề của cả việc này sai.
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
