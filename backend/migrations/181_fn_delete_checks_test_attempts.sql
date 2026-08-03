-- ============================================================================
-- Migration 181 — xoá bài giao phải nhìn CẢ lượt làm đề Reading/Listening
-- ============================================================================
--
-- Codex review round 4 on the GĐ 5 branch. Migration 180 is already applied to
-- production, so this is CREATE OR REPLACE in a new file rather than an edit in
-- place — forward-only, as the directory README requires.
--
-- BỐI CẢNH. Migration 180 dạy hàm xoá rằng "đã nộp" gồm CẢ phiên nói đã hoàn
-- thành, vì lệnh ghi sổ lúc hoàn thành là best-effort và có thể trượt. GĐ 5 thêm
-- hai kỹ năng nữa vào cùng sổ cái — nhưng bằng chứng của chúng nằm ở CHỖ KHÁC.
--
--   Speaking : sessions.class_assignment_item_id  (trang luyện tự gắn)
--   Reading  : reading_test_attempts              (trang làm đề KHÔNG hề biết
--   Listening: listening_test_attempts             sổ cái lớp tồn tại)
--
-- Vì hai trang làm đề không gắn gì cả, bài nộp của chúng chỉ được vá vào sổ khi
-- CÓ AI ĐÓ ĐỌC. Router đã vá trước khi gọi hàm này, nhưng đó là hai lệnh riêng:
-- một em nộp lọt vào giữa thì hàm chỉ thấy submitted_at IS NULL và xoá — kéo
-- theo ON DELETE CASCADE xoá luôn mục, và không còn gì để vá lại. Bài nộp mất
-- hẳn, đúng cái kết cục mà chốt này sinh ra để chặn.
--
-- CÁCH ĐÓNG. Đưa phép kiểm vào TRONG cùng giao dịch, và khoá các dòng lượt làm
-- bài trước khi đọc chúng — y hệt cách 180 khoá sessions. Lượt nộp đang chạy
-- phải chờ, nên không có khe nào để lọt.
--
-- "BẰNG CHỨNG" Ở ĐÂY LÀ GÌ. Một lượt đã nộp của ĐÚNG học viên trong lớp, ĐÚNG
-- đề được giao, và nộp TỪ LÚC bài được giao trở đi — cùng ba điều kiện mà
-- reconcile_test_attempts() dùng. Lỏng hơn (bỏ mốc thời gian) thì một đề học
-- viên từng luyện từ tháng trước sẽ khoá cứng bài giao, không ai xoá nổi.
--
-- Đề Speaking không có content_id nên nhánh này bỏ qua chúng; phép kiểm phiên
-- của 180 giữ nguyên.
--
-- TO REVERSE: re-apply migration 180.
--
-- Idempotent. Apply by hand.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_delete_class_assignment_if_unsubmitted(
    p_assignment_id uuid,
    p_cohort_id     uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_exists     boolean;
    v_submitted  boolean;
    v_skill      text;
    v_content_id text;
    v_created_at timestamptz;
BEGIN
    SELECT TRUE, a.skill, a.content_id, a.created_at
      INTO v_exists, v_skill, v_content_id, v_created_at
      FROM class_assignments a
     WHERE a.id = p_assignment_id AND a.cohort_id = p_cohort_id
     FOR UPDATE;

    IF v_exists IS NOT TRUE THEN
        RETURN NULL;          -- not found (or not in this class) — caller 404s
    END IF;

    -- Lock the item rows: mark_item_submitted updates a child and never touches
    -- the parent, so the parent lock alone does not serialise it.
    PERFORM 1 FROM class_assignment_items
      WHERE assignment_id = p_assignment_id
      FOR UPDATE;

    -- Lock the linked SESSIONS too, before reading their status (mig 180).
    PERFORM 1
       FROM sessions s
       JOIN class_assignment_items i ON i.id = s.class_assignment_item_id
      WHERE i.assignment_id = p_assignment_id
      FOR UPDATE OF s;

    -- Lock the ATTEMPT rows of this class for this paper, before reading them.
    -- Same reason as the sessions lock above: an in-flight submit must wait for
    -- us rather than slip in between the read and the DELETE.
    IF v_skill = 'reading' AND v_content_id IS NOT NULL THEN
        PERFORM 1
           FROM reading_test_attempts r
           JOIN students st ON st.user_id = r.user_id
          WHERE st.cohort_id = p_cohort_id
            AND r.test_id::text = v_content_id
          FOR UPDATE OF r;
    ELSIF v_skill = 'listening' AND v_content_id IS NOT NULL THEN
        PERFORM 1
           FROM listening_test_attempts l
           JOIN students st ON st.user_id = l.user_id
          WHERE st.cohort_id = p_cohort_id
            AND l.test_id::text = v_content_id
          FOR UPDATE OF l;
    END IF;

    -- THREE kinds of evidence now.
    --
    --   1. submitted_at            — the recorded hand-in
    --   2. a linked completed session — Speaking, before the ledger caught up
    --   3. a submitted attempt     — Reading/Listening, which have no hook at
    --                                all and are ONLY ever repaired on read
    SELECT EXISTS (
        SELECT 1
          FROM class_assignment_items i
         WHERE i.assignment_id = p_assignment_id
           AND (
                i.submitted_at IS NOT NULL
             OR EXISTS (
                    SELECT 1 FROM sessions s
                     WHERE s.class_assignment_item_id = i.id
                       AND s.status = 'completed'
                )
             OR (
                    v_skill = 'reading' AND v_content_id IS NOT NULL
                AND EXISTS (
                        SELECT 1
                          FROM reading_test_attempts r
                          JOIN students st ON st.id = i.student_id
                         WHERE r.user_id = st.user_id
                           AND r.test_id::text = v_content_id
                           AND r.status = 'submitted'
                           AND r.submitted_at >= v_created_at
                    )
                )
             OR (
                    v_skill = 'listening' AND v_content_id IS NOT NULL
                AND EXISTS (
                        SELECT 1
                          FROM listening_test_attempts l
                          JOIN students st ON st.id = i.student_id
                         WHERE l.user_id = st.user_id
                           AND l.test_id::text = v_content_id
                           AND l.status = 'submitted'
                           AND l.submitted_at >= v_created_at
                    )
                )
           )
    ) INTO v_submitted;

    IF v_submitted THEN
        RETURN FALSE;
    END IF;

    DELETE FROM class_assignments WHERE id = p_assignment_id;
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION fn_delete_class_assignment_if_unsubmitted IS
'Xoá bài giao CHỈ KHI chưa ai nộp, kiểm và xoá trong cùng giao dịch có khoá dòng
(mig 179, siết ở 180, mở rộng ở 181). "Đã nộp" tính BA loại bằng chứng: sổ cái
đã ghi, phiên Speaking đã hoàn thành còn gắn với bài, và lượt làm đề
Reading/Listening đã nộp của học viên trong lớp — đúng đề, từ lúc giao trở đi.
NULL = không tìm thấy, FALSE = đã có người nộp, TRUE = đã xoá.';

-- SECURITY DEFINER functions default to EXECUTE for PUBLIC. Without this the
-- function is callable by any authenticated student, straight past require_admin.
REVOKE EXECUTE ON FUNCTION fn_delete_class_assignment_if_unsubmitted(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_delete_class_assignment_if_unsubmitted(uuid, uuid)
    TO service_role;

COMMIT;
