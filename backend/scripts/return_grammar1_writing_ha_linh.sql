-- TRẢ BÀI phần TỰ LUẬN của "Grammar 1" cho em Lê Ngọc Hà Linh (lớp TUE-FRI 18H).
--
--   export $(grep -m1 '^DATABASE_URL=' backend/.env | xargs) && \
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f backend/scripts/return_grammar1_writing_ha_linh.sql
--
-- ── CHUYỆN GÌ ĐÃ XẢY RA ──────────────────────────────────────────────────────
-- 07/08 08:22:02 bản nháp phần tự luận được lưu đủ 10 câu; 08:22:06 — bốn giây
-- sau — lượt nộp đi. Bộ chấm trả 0/10 câu sạch, và 8/10 câu bị trừ chỉ vì viết
-- thường đầu câu (5 câu KHÔNG có lỗi nào khác). Đây là một cú bấm nhầm, không
-- phải một bài đã xong.
--
-- Phần tự luận CHỈ NỘP ĐƯỢC MỘT LẦN (`uq_course_writing_per_item`, mig 192), nên
-- em ấy đang bị khoá ở màn "bài đã chấm" và không viết lại được.
--
-- ── LÀM GÌ ───────────────────────────────────────────────────────────────────
-- 1. GỠ lượt nộp khỏi mục bài giao (`class_assignment_item_id` = NULL) thay vì
--    xoá dòng: bài em ấy viết và bản chấm còn nguyên để tra lại, mà ràng buộc
--    "một lượt mỗi mục" thì thôi va (chốt UNIQUE ấy chỉ tính dòng CÓ mục).
-- 2. MỞ LẠI mục: `submitted_at` về NULL, `state` về `opened`, `artifact_*` về
--    NULL. `score` (65.0) và sổ `mastery` GIỮ NGUYÊN — với bộ đề có trắc nghiệm
--    thì điểm của mục LÀ kết quả trắc nghiệm và chỉ `course_verdict` được ghi nó
--    (`course_hand_in_score`, #994). Xoá nó ở đây là xoá đúng thứ em ấy đã làm
--    được.
--
-- Bản nháp KHÔNG đụng tới: nó còn đủ 10 câu, và `course_writing_state` chỉ rót
-- nháp ra khi mục chưa có lượt nộp — nên gỡ xong là khung viết hiện lại kèm
-- nguyên văn bài cũ, em ấy sửa tiếp chứ không gõ lại từ đầu.
--
-- ── VÌ SAO PHẢI GỠ LƯỢT NỘP, KHÔNG CHỈ MỞ LẠI MỤC ────────────────────────────
-- Hai đường vá sổ đều tìm "mục chưa nộp mà đã có dòng tự luận" rồi đóng dấu lại:
-- `assignment_tally` (giáo viên mở bảng tổng kết) và `reconcile_course_items`
-- (mở trang lớp). Chỉ mở lại mục thì lần đầu có người mở bảng là nó đóng lại,
-- trong vài giây, không một lời báo.
--
-- Đường vá thứ hai — bằng chứng từ phiên trắc nghiệm — KHÔNG chạm tới mục này:
-- `_reconcile_chunk` bỏ qua mọi bộ đề còn phần viết (`if writing: continue`), và
-- bộ C1-B01 có 10 câu tự luận.
--
-- ── KHÔNG ĐỘNG TỚI AI KHÁC ───────────────────────────────────────────────────
-- Đúng một mục, đúng một lượt nộp, nêu tên tường minh. Hạn nộp đã dời sang
-- 09/08 19:00 nên em ấy còn cửa nộp lại — chốt bên dưới kiểm đúng điều đó và
-- HUỶ giao dịch nếu hạn đã qua (trả về một bài không nộp được thì tệ hơn là để
-- yên).
--
-- Chạy lần thứ hai sẽ HUỶ giao dịch: chốt so-sánh-rồi-đổi đòi mục đang mang
-- đúng dấu nộp cũ. Đó là hành vi đúng.

\timing on
\set ON_ERROR_STOP on

\echo '=== TRƯỚC ==='
SELECT s.full_name, i.state, i.score,
       to_char(i.submitted_at AT TIME ZONE 'Asia/Ho_Chi_Minh','DD/MM HH24:MI:SS') AS nop_luc,
       i.artifact_kind, i.artifact_id,
       (SELECT count(*) FROM course_writing_submissions w
         WHERE w.class_assignment_item_id = i.id)                       AS luot_nop_tu_luan,
       (SELECT count(*) FROM jsonb_object_keys(d.answers))              AS cau_trong_nhap
  FROM class_assignment_items i
  JOIN students s ON s.id = i.student_id
  LEFT JOIN course_writing_drafts d ON d.class_assignment_item_id = i.id
 WHERE i.id = '14238570-3930-40ef-819e-ca5c0d60db4f';

BEGIN;

DO $$
DECLARE
    v_item UUID := '14238570-3930-40ef-819e-ca5c0d60db4f';
    v_sub  UUID := '8466f86b-ec2a-4f55-8499-9813b62b83d8';
    n INT;
BEGIN
    -- Còn hạn thì mới trả. Quá hạn mà trả là mở một khung viết không nộp được:
    -- `_assignment_item_for` đòi `is_accepting_submissions`, nên em ấy sẽ gõ
    -- xong rồi ăn 404 lúc bấm Nộp.
    SELECT COUNT(*) INTO n
      FROM class_assignments a
      JOIN class_assignment_items i ON i.assignment_id = a.id
     WHERE i.id = v_item AND a.status = 'published' AND a.due_at > NOW();
    IF n <> 1 THEN
        RAISE EXCEPTION 'bài giao không còn nhận bài — dời hạn trước đã';
    END IF;

    -- GỠ lượt nộp khỏi mục. Nêu CẢ mục trong điều kiện: dòng này mà đã trỏ đi
    -- nơi khác thì tiền đề sai, và ghi tiếp là gỡ nhầm bài của một lần giao khác.
    UPDATE course_writing_submissions
       SET class_assignment_item_id = NULL
     WHERE id = v_sub AND class_assignment_item_id = v_item;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
        RAISE EXCEPTION
          'không gỡ được lượt nộp: kỳ vọng ĐÚNG 1 dòng đang gắn vào mục này, '
          'thấy % dòng. Đọc lại trạng thái trước khi làm gì tiếp.', n;
    END IF;

    -- MỞ LẠI mục. So-sánh-rồi-đổi trên chính dấu nộp cũ: giữa lúc soạn và lúc
    -- chạy mà em ấy (hay một lượt vá sổ) đã đổi dòng này thì DỪNG, đừng ghi đè.
    --
    -- `state` về 'opened' chứ không 'assigned': em ấy đã mở bài từ 05/08, và
    -- ràng buộc `class_assignment_items_submitted_at_required` cấm giữ
    -- 'graded' khi `submitted_at` trống.
    UPDATE class_assignment_items
       SET state = 'opened',
           submitted_at = NULL,
           artifact_kind = NULL,
           artifact_id = NULL,
           updated_at = NOW()
     WHERE id = v_item
       AND submitted_at = TIMESTAMPTZ '2026-08-07 01:22:06.497667+00'
       AND artifact_id = v_sub;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
        RAISE EXCEPTION
          'không mở lại được mục: kỳ vọng ĐÚNG 1 dòng mang dấu nộp cũ, thấy % '
          'dòng (hoặc kịch bản đã chạy rồi).', n;
    END IF;

    -- Bản nháp là thứ quyết định em ấy phải gõ lại bao nhiêu. Thiếu thì KHÔNG
    -- huỷ việc trả bài — chỉ nói ra, để người trả bài biết mà báo trước.
    SELECT COALESCE((SELECT count(*) FROM course_writing_drafts d,
                            jsonb_object_keys(d.answers)
                      WHERE d.class_assignment_item_id = v_item), 0) INTO n;
    IF n < 10 THEN
        RAISE NOTICE 'CHÚ Ý: bản nháp chỉ còn %/10 câu — em ấy sẽ phải gõ lại phần thiếu.', n;
    ELSE
        RAISE NOTICE 'Bản nháp còn đủ %/10 câu — khung viết sẽ hiện lại nguyên văn bài cũ.', n;
    END IF;
END $$;

COMMIT;

\echo '=== SAU: mục đã mở lại, bài cũ còn trong nháp ==='
SELECT s.full_name, i.state, i.score,
       i.submitted_at, i.artifact_kind,
       (SELECT count(*) FROM course_writing_submissions w
         WHERE w.class_assignment_item_id = i.id)              AS luot_nop_tu_luan,
       (SELECT count(*) FROM jsonb_object_keys(d.answers))     AS cau_trong_nhap,
       (i.mastery -> 'attempts' -> -1 ->> 'pct')               AS diem_luot_gan_nhat
  FROM class_assignment_items i
  JOIN students s ON s.id = i.student_id
  LEFT JOIN course_writing_drafts d ON d.class_assignment_item_id = i.id
 WHERE i.id = '14238570-3930-40ef-819e-ca5c0d60db4f';

\echo '=== Lượt nộp cũ vẫn còn, chỉ là đã gỡ khỏi mục (tra lại bằng id này) ==='
SELECT id, class_assignment_item_id AS con_gan_vao_muc, total, clean,
       to_char(graded_at AT TIME ZONE 'Asia/Ho_Chi_Minh','DD/MM HH24:MI') AS cham_luc
  FROM course_writing_submissions
 WHERE id = '8466f86b-ec2a-4f55-8499-9813b62b83d8';
