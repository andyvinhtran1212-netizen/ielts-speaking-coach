-- Mở khoá bài Speaking 003 cho em Trúc Nguyễn (lớp MON-THURS 20H).
--
--   export $(grep -m1 '^DATABASE_URL=' backend/.env | xargs) && \
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f backend/scripts/unblock_truc_speaking_003.sql
--
-- ── VÌ SAO ───────────────────────────────────────────────────────────────────
-- Em ấy bấm "Làm bài" lúc 15:18: `/start` chạy xong (mục chuyển sang `opened`,
-- `opened_at` = 15:18) nhưng KHÔNG có phiên nào được tạo. Luồng dừng giữa
-- `/start` và `POST /sessions`.
--
-- Đã loại trừ, bằng dữ liệu thật:
--   · trần phiên/ngày            — 0 phiên hôm nay
--   · quota trọn đời của mã      — 120/210 lượt đã hoàn thành
--   · tài khoản chưa kích hoạt   — is_active = true
--   · quyền                      — ["practice_single"], GIỐNG HỆT các bạn đã làm được
--   · bài chưa mở / quá hạn      — published, hạn 19:00 hôm nay
--   · lệch mode/part/topic       — practice / 1 / "Going out", khớp content_config
--   · RPC gắn phiên vào mục      — ba điều kiện của nó đều đúng cho em ấy
--   · RPC tạo phiên              — gọi thử với đúng dữ liệu ấy: CHẠY ĐƯỢC
--   · tệp trang + đường API      — 200, cú pháp OK
--   · hỏng cả lớp                — KHÔNG: 8 bạn mở cùng bài hôm nay đều có phiên,
--                                  kể cả hai bạn mở SAU em ấy (16:37 và 17:06)
--
-- Nghĩa là đường đi vẫn tốt; lượt gọi của riêng em ấy không tới nơi. Kịch bản
-- này làm ĐÚNG việc mà cú bấm đáng lẽ làm, bằng CHÍNH hai hàm mà máy chủ gọi —
-- không dựng đường thứ hai để nó trôi khỏi đường thật.

\timing on
\set ON_ERROR_STOP on

\echo '=== TRƯỚC ==='
SELECT s.full_name, i.state,
       to_char(i.opened_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI') AS mo_luc,
       (SELECT COUNT(*) FROM sessions x WHERE x.class_assignment_item_id = i.id) AS so_phien
  FROM class_assignment_items i
  JOIN students s ON s.id = i.student_id
 WHERE i.id = 'f02cca99-4bea-4771-b0da-de6a8819a566';

BEGIN;

DO $$
DECLARE
    v_item  UUID := 'f02cca99-4bea-4771-b0da-de6a8819a566';
    v_user  UUID := '01f22256-5a67-4066-876c-503702958de7';
    v_n     INT;
    v_sid   UUID;
    v_bound BOOLEAN;
BEGIN
    -- Đã có phiên rồi thì DỪNG: dựng phiên thứ hai nghĩa là bài em ấy vừa nói
    -- nằm lại phiên cũ và màn hình mở ra trắng trơn — đúng lỗi #931 đã chữa.
    SELECT COUNT(*) INTO v_n FROM sessions WHERE class_assignment_item_id = v_item;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'mục này đã có % phiên — KHÔNG dựng thêm, hãy mở phiên có sẵn', v_n;
    END IF;

    -- Còn hạn thì mới dựng. Quá hạn mà dựng là mở một phiên không nộp được.
    SELECT COUNT(*) INTO v_n FROM class_assignments a
      JOIN class_assignment_items i ON i.assignment_id = a.id
     WHERE i.id = v_item AND a.status = 'published' AND a.due_at > NOW();
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'bài giao không còn nhận bài — dời hạn trước đã';
    END IF;

    -- CHÍNH hàm mà `POST /sessions` gọi (trần ngày để rộng: em ấy 0 phiên hôm nay).
    SELECT id INTO v_sid FROM fn_create_session_daily_capped(
        v_user, 'practice', 1, 'Going out',
        (NOW() - INTERVAL '18 hours')::timestamptz, 1000);
    IF v_sid IS NULL THEN
        RAISE EXCEPTION 'không tạo được phiên';
    END IF;

    -- CHÍNH hàm mà `attach_session_to_class_item` gọi. Nó tự đọc lại quyền sở
    -- hữu và trạng thái bài giao dưới khoá dòng.
    SELECT fn_bind_session_to_class_item(v_sid, v_item, v_user) INTO v_bound;
    IF v_bound IS NOT TRUE THEN
        RAISE EXCEPTION 'không gắn được phiên vào mục bài giao';
    END IF;

    RAISE NOTICE 'ĐƯỜNG VÀO: https://www.averlearning.com/pages/practice.html?session_id=%', v_sid;
END $$;

COMMIT;

\echo '=== SAU: gửi đường dẫn này cho em ấy ==='
SELECT 'https://www.averlearning.com/pages/practice.html?session_id=' || s.id AS duong_vao,
       s.status, s.mode, s.part, s.topic
  FROM sessions s
 WHERE s.class_assignment_item_id = 'f02cca99-4bea-4771-b0da-de6a8819a566';
