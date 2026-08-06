-- Migration: 196_delete_rpc_course_evidence.sql
--
-- Xoá bài giao KHÔNG được xoá mất bài tập THEO BUỔI mà học viên đã làm.
--
-- Chạy một lần (SAU mig 195):
--   export $(grep -m1 '^DATABASE_URL=' backend/.env | xargs) && \
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/196_delete_rpc_course_evidence.sql
--
-- ── VÌ SAO ───────────────────────────────────────────────────────────────────
-- `fn_delete_class_assignment_if_unsubmitted` (mig 179, siết ở 180, mở rộng ở
-- 181) từ chối xoá khi đã có người nộp, và nó tính BA loại bằng chứng: sổ cái
-- đã ghi, phiên Speaking đã hoàn thành, lượt làm đề Reading/Listening đã nộp.
--
-- Bài tập theo buổi ra đời sau (mig 188 nối `quiz_sessions`, mig 190 dựng
-- `course_writing_submissions`) và KHÔNG được thêm vào danh sách ấy. Hai khoá
-- ngoại đó đều `ON DELETE SET NULL` — cố ý, để bài giao bị xoá không kéo theo
-- bài học viên đã làm. Nhưng cộng lại thì thành cái bẫy này:
--
--   1. Học viên làm xong chặng cuối; lượt ghi sổ hỏng (ghi best-effort).
--   2. Giáo viên xoá bài giao trước khi ai kịp đối chiếu.
--   3. RPC không thấy bằng chứng nào ⇒ trả TRUE ⇒ mục bị xoá.
--   4. `quiz_sessions.class_assignment_item_id` và
--      `course_writing_submissions.class_assignment_item_id` thành NULL.
--
-- Bài học viên vẫn còn nguyên trên máy chủ, nhưng MẤT KHOÁ NỐI: đường đối chiếu
-- `reconcile_course_items` đi tìm theo đúng cột vừa bị xoá, nên nó không bao giờ
-- tìm lại được. Mất vĩnh viễn, không có đường lùi.
--
-- ── VÌ SAO CHẶN Ở "CÓ LÀM", KHÔNG PHẢI "ĐÃ XONG BÀI" ────────────────────────
-- RPC không tính nổi luật phủ-đủ-câu của `_course_work_is_done` (phải mở
-- `quiz_questions` và `quiz_attempts` ra đối chiếu tập qid). Nhưng cũng KHÔNG
-- CẦN: đây là phép xoá không thể hoàn tác, nên chặn rộng là chiều an toàn, và
-- nó khớp đúng nhịp ba loại bằng chứng có sẵn — một phiên Speaking đã hoàn
-- thành cũng chặn xoá, dù em ấy mới trả lời một câu.
--
-- Không có đường "gỡ em ấy ra rồi xoá": bài giao chỉ THÊM người nhận, không bao
-- giờ bớt (`admin_class_assignments`), và bớt thì cũng xoá đúng cái bằng chứng
-- hàm này đang giữ. Bài giao đã có người làm thì đường đúng là LƯU TRỮ, không
-- phải xoá. Chiều ngược lại — xoá nhầm — không có đường bù nào.
--
-- ── VÌ SAO PHẢI KHOÁ DÒNG ───────────────────────────────────────────────────
-- Cùng lý do mig 180: `end_session` và `submit_course_writing` ghi vào các bảng
-- này mà không chạm dòng cha, nên khoá cha một mình không xếp hàng được với
-- chúng. Không khoá thì có cửa sổ: RPC đọc "chưa có gì", học viên kết phiên,
-- RPC xoá — đúng cảnh hỏng ở trên, chỉ khác là nó xảy ra trong vài mili giây.

BEGIN;

CREATE OR REPLACE FUNCTION fn_delete_class_assignment_if_unsubmitted(
    p_assignment_id UUID,
    p_cohort_id     UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_exists    BOOLEAN;
    v_submitted BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM class_assignments
         WHERE id = p_assignment_id
           AND cohort_id = p_cohort_id
           FOR UPDATE
    ) INTO v_exists;

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

    -- Khoá phiên làm bài tập THEO BUỔI, cùng lý do (mig 196).
    PERFORM 1
       FROM quiz_sessions q
       JOIN class_assignment_items i ON i.id = q.class_assignment_item_id
      WHERE i.assignment_id = p_assignment_id
      FOR UPDATE OF q;

    -- Và bài TỰ LUẬN đã chấm.
    PERFORM 1
       FROM course_writing_submissions w
       JOIN class_assignment_items i ON i.id = w.class_assignment_item_id
      WHERE i.assignment_id = p_assignment_id
      FOR UPDATE OF w;

    -- FIVE kinds of evidence.
    --
    --   1. submitted_at               — the recorded hand-in
    --   2. a linked completed session — Speaking, before the ledger caught up
    --   3. a linked submitted attempt — Reading/Listening, same idea
    --   4. a linked ended course-quiz session      — mig 196, run hoặc retake
    --   5. a linked graded course essay            — mig 196
    --
    -- All five are a JOIN, not a guess. Deleting on submitted_at alone
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
             -- KHÔNG lọc `kind`, khác `reconcile_course_items`. Hai nơi hỏi
             -- hai câu khác nhau: bên kia phải CHỌN một phiên làm bằng chứng
             -- chốt sổ nên chỉ nhận lượt chính; ở đây chỉ cần biết em ấy CÓ
             -- làm hay không, và một lượt kiểm tra lại đã kết cũng là công sức
             -- sẽ mất khoá nối nếu xoá.
             OR EXISTS (
                    SELECT 1 FROM quiz_sessions q
                     WHERE q.class_assignment_item_id = i.id
                       AND q.ended_by = 'completed'
                )
             -- Dòng ở bảng này CHỈ sinh ra sau khi đã chấm (`graded_at` NOT
             -- NULL), nên có dòng là có bài nộp.
             OR EXISTS (
                    SELECT 1 FROM course_writing_submissions w
                     WHERE w.class_assignment_item_id = i.id
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
(mig 179, siết ở 180, mở rộng ở 181 và 196). "Đã nộp" tính NĂM loại bằng chứng:
sổ cái đã ghi, phiên Speaking đã hoàn thành, lượt làm đề Reading/Listening đã
nộp, phiên bài-tập-theo-buổi đã kết (run hoặc retake), và bài tự luận đã chấm — tất cả còn gắn với
mục. Cả năm là phép nối, không phải phép suy. NULL = không tìm thấy,
FALSE = đã có người nộp, TRUE = đã xoá.';

-- SECURITY DEFINER functions default to EXECUTE for PUBLIC. Không thu hồi thì
-- một người dùng đã đăng nhập gọi thẳng được hàm xoá này.
REVOKE EXECUTE ON FUNCTION fn_delete_class_assignment_if_unsubmitted(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_delete_class_assignment_if_unsubmitted(uuid, uuid)
    TO service_role;

COMMIT;


-- ── Kiểm sau khi chạy ────────────────────────────────────────────────────────
-- 1) Hàm đã nhận hai loại bằng chứng mới chưa:
--
-- SELECT (prosrc LIKE '%quiz_sessions q%')             AS co_phien_theo_buoi,
--        (prosrc LIKE '%course_writing_submissions w%') AS co_bai_tu_luan
--   FROM pg_proc WHERE proname = 'fn_delete_class_assignment_if_unsubmitted';
-- Kỳ vọng: t | t
--
-- 2) Quyền vẫn chỉ dành cho backend:
--
-- SELECT has_function_privilege('anon',
--          'fn_delete_class_assignment_if_unsubmitted(uuid,uuid)', 'EXECUTE') AS anon_goi_duoc,
--        has_function_privilege('authenticated',
--          'fn_delete_class_assignment_if_unsubmitted(uuid,uuid)', 'EXECUTE') AS hv_goi_duoc,
--        has_function_privilege('service_role',
--          'fn_delete_class_assignment_if_unsubmitted(uuid,uuid)', 'EXECUTE') AS backend_goi_duoc;
-- Kỳ vọng: f | f | t
--
-- 3) Có bao nhiêu bài giao theo buổi hiện KHÔNG xoá được nữa (trước đây xoá được):
--
-- SELECT COUNT(DISTINCT a.id) AS bai_giao_nay_duoc_bao_ve
--   FROM class_assignments a
--   JOIN class_assignment_items i ON i.assignment_id = a.id
--  WHERE a.skill = 'course'
--    AND i.submitted_at IS NULL
--    AND (EXISTS (SELECT 1 FROM quiz_sessions q
--                  WHERE q.class_assignment_item_id = i.id
--                    AND q.ended_by = 'completed')
--      OR EXISTS (SELECT 1 FROM course_writing_submissions w
--                  WHERE w.class_assignment_item_id = i.id));
--
-- Rollback: chạy lại phần CREATE OR REPLACE của mig 181.
