-- ============================================================================
-- Migration 181 — nối thẳng lượt làm đề với mục bài tập của lớp
-- ============================================================================
--
-- VÌ SAO CÓ FILE NÀY. Speaking ghi sổ bằng SỰ KIỆN: phiên luyện mang sẵn
-- `sessions.class_assignment_item_id`, nên lúc hoàn thành chỉ việc ghi vào đúng
-- mục đó. Reading/Listening ban đầu được làm theo lối khác — trang làm đề không
-- biết sổ cái lớp tồn tại, nên phía sau ĐOÁN: quét bảng lượt làm bài rồi suy ra
-- lượt nào thuộc lần giao nào.
--
-- Phép đoán ấy không có đáy. Muốn đoán đúng phải trả lời được: bài giao lúc
-- nào, lộ ra lúc nào, có bị lưu trữ rồi mở lại không, học viên đã chuyển lớp
-- chưa, cùng đề giao mấy lần, lần nào giành lượt trước, và lượt vừa nộp có rơi
-- vào đúng khe giữa hai lệnh không. Mỗi câu là một trạng thái nữa; tám vòng
-- review lôi ra mười hai lỗi thì cả mười hai đều là cùng một câu hỏi đó.
--
-- CÁCH LÀM ĐÚNG là đừng đoán. Học viên mở bài tập từ trang lớp, đường dẫn mang
-- theo id của mục, trang làm đề gắn id ấy vào lượt ngay lúc tạo. Từ đó "lượt này
-- thuộc bài tập nào" không còn là câu hỏi — nó là dữ liệu.
--
-- HAI CỘT NÀY XOÁ ĐI: mốc thời gian, thứ tự lần-giao-cũ-trước, sổ giữ chỗ, phép
-- gom bài giao anh em, phép khớp lớp hiện tại, và cả hai khối NOT EXISTS trong
-- hàm xoá. Tất cả tồn tại chỉ để đoán.
--
-- ON DELETE SET NULL, KHÔNG PHẢI CASCADE. Xoá một bài giao không được xoá lượt
-- làm bài của học viên — bài các em làm là của các em, không phải của lớp.
--
-- KHÔNG UNIQUE. Trang đề cho phép làm lại: một mục có thể có nhiều lượt, và
-- phía Python lấy lượt ĐÃ NỘP sớm nhất. Ràng buộc duy nhất ở đây sẽ làm lệnh
-- "làm lại" đổ vỡ.
--
-- TO REVERSE:
--   ALTER TABLE reading_test_attempts   DROP COLUMN class_assignment_item_id;
--   ALTER TABLE listening_test_attempts DROP COLUMN class_assignment_item_id;
--   rồi áp lại migration 180 để hàm xoá quay về bản trước.
--
-- Idempotent. Apply by hand.
-- ============================================================================

BEGIN;

ALTER TABLE reading_test_attempts
    ADD COLUMN IF NOT EXISTS class_assignment_item_id UUID
        REFERENCES class_assignment_items(id) ON DELETE SET NULL;

ALTER TABLE listening_test_attempts
    ADD COLUMN IF NOT EXISTS class_assignment_item_id UUID
        REFERENCES class_assignment_items(id) ON DELETE SET NULL;

-- Partial: the overwhelming majority of attempts are free practice and carry
-- NULL. The repair path only ever asks for the ones that are class work.
CREATE INDEX IF NOT EXISTS idx_reading_attempts_class_item
    ON reading_test_attempts (class_assignment_item_id)
    WHERE class_assignment_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_listening_attempts_class_item
    ON listening_test_attempts (class_assignment_item_id)
    WHERE class_assignment_item_id IS NOT NULL;

COMMENT ON COLUMN reading_test_attempts.class_assignment_item_id IS
'Mục bài tập lớp mà lượt này được làm để nộp, gắn lúc TẠO lượt từ đường dẫn
trang lớp đưa sang. NULL = luyện tự do. Đây là câu trả lời cho "lượt này thuộc
bài tập nào" — thay cho việc suy đoán từ thời điểm và đề (mig 181).';

COMMENT ON COLUMN listening_test_attempts.class_assignment_item_id IS
'Xem reading_test_attempts.class_assignment_item_id.';


-- ── hàm xoá: bằng chứng giờ là một phép nối, không còn là phép đoán ─────────
--
-- So với mig 180 chỉ thêm ĐÚNG một loại bằng chứng nữa, và nó ngắn vì không
-- phải hỏi lúc nào/của ai/của lần giao nào — cột đã trả lời sẵn.
--
-- Vẫn khoá các dòng lượt trước khi đọc, cùng lý do như khoá sessions ở mig 180:
-- một lượt đang nộp dở phải chờ mình, chứ không được lọt vào giữa phép đọc và
-- lệnh DELETE.

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
    v_exists    boolean;
    v_submitted boolean;
BEGIN
    SELECT TRUE INTO v_exists
      FROM class_assignments
     WHERE id = p_assignment_id AND cohort_id = p_cohort_id
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

    -- Lock the linked ATTEMPTS, same reason.
    PERFORM 1
       FROM reading_test_attempts r
       JOIN class_assignment_items i ON i.id = r.class_assignment_item_id
      WHERE i.assignment_id = p_assignment_id
      FOR UPDATE OF r;

    PERFORM 1
       FROM listening_test_attempts l
       JOIN class_assignment_items i ON i.id = l.class_assignment_item_id
      WHERE i.assignment_id = p_assignment_id
      FOR UPDATE OF l;

    -- THREE kinds of evidence.
    --
    --   1. submitted_at               — the recorded hand-in
    --   2. a linked completed session — Speaking, before the ledger caught up
    --   3. a linked submitted attempt — Reading/Listening, same idea
    --
    -- All three are a JOIN, not a guess. Deleting on submitted_at alone
    -- destroys the item and, via ON DELETE SET NULL, the link that any later
    -- repair would have followed — so the hand-in becomes unfindable.
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
             OR EXISTS (
                    SELECT 1 FROM reading_test_attempts r
                     WHERE r.class_assignment_item_id = i.id
                       AND r.status = 'submitted'
                )
             OR EXISTS (
                    SELECT 1 FROM listening_test_attempts l
                     WHERE l.class_assignment_item_id = i.id
                       AND l.status = 'submitted'
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
đã ghi, phiên Speaking đã hoàn thành còn gắn với mục, và lượt làm đề
Reading/Listening đã nộp còn gắn với mục. Cả ba là phép nối, không phải phép
suy. NULL = không tìm thấy, FALSE = đã có người nộp, TRUE = đã xoá.';

-- SECURITY DEFINER functions default to EXECUTE for PUBLIC. Without this the
-- function is callable by any authenticated student, straight past require_admin.
REVOKE EXECUTE ON FUNCTION fn_delete_class_assignment_if_unsubmitted(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_delete_class_assignment_if_unsubmitted(uuid, uuid)
    TO service_role;

COMMIT;
