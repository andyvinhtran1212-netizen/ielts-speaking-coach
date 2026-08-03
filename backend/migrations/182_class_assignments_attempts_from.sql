-- ============================================================================
-- Migration 182 — mốc "tính bài nộp từ lúc nào" cho bài giao Reading/Listening
-- ============================================================================
--
-- Codex review round 7 on the GĐ 5 branch.
--
-- VẤN ĐỀ. Hai kỹ năng Reading/Listening không có móc hoàn thành: trang làm đề
-- nộp bài mà không biết sổ cái lớp tồn tại, nên bài nộp được nhận ra bằng cách
-- dò bảng lượt làm bài. Muốn dò đúng thì phải có MỐC: chỉ lượt nộp từ lúc lớp
-- được giao bài trở đi mới tính. Cho tới nay mốc ấy được suy ra tại chỗ:
--
--     GREATEST(created_at, COALESCE(publish_at, created_at))
--
-- Suy ra được, cho tới khi bài giao bị LƯU TRỮ RỒI MỞ LẠI. Admin có nút đó
-- (PATCH … status) và dùng nó để đóng một bài đã có người nộp. Trong quãng bài
-- đóng, trang lớp không hiện nó nữa — nhưng thư viện đề vẫn mở, học viên vẫn tự
-- luyện được đúng đề ấy. Mở lại bài thì lượt luyện tự do đó thoả mốc cũ và bị
-- ghi thành bài nộp của lớp. Giáo viên thấy một bài nộp chưa từng xảy ra.
--
-- Không suy được từ `updated_at`: sửa tiêu đề cũng đẩy nó đi, và làm thế sẽ
-- HUỶ công nhận những bài đã nộp thật.
--
-- CÁCH LÀM. Một cột riêng, chỉ nhúc nhích khi ngữ nghĩa "bài này được giao từ
-- lúc nào" thật sự đổi:
--
--   * lúc tạo   → GREATEST(created_at, publish_at)
--   * mở lại    → NOW()   (router ghi, xem admin_class_assignments.py)
--   * mọi sửa khác → không đụng tới
--
-- Bài Speaking cũng có cột này nhưng không ai đọc — chúng có móc hoàn thành
-- riêng (sessions.class_assignment_item_id), không dò ngược bao giờ.
--
-- BACKFILL. Bài giao đang có lấy đúng công thức cũ, nên hành vi không đổi với
-- dữ liệu hiện tại — đây là migration mở đường, không phải migration sửa số.
--
-- TO REVERSE: ALTER TABLE class_assignments DROP COLUMN attempts_from;
--             (rồi áp lại 181 để hàm xoá quay về công thức suy tại chỗ)
--
-- Idempotent. Apply by hand.
-- ============================================================================

BEGIN;

ALTER TABLE class_assignments
    ADD COLUMN IF NOT EXISTS attempts_from TIMESTAMPTZ;

UPDATE class_assignments
   SET attempts_from = GREATEST(created_at, COALESCE(publish_at, created_at))
 WHERE attempts_from IS NULL;

ALTER TABLE class_assignments
    ALTER COLUMN attempts_from SET DEFAULT NOW();

COMMENT ON COLUMN class_assignments.attempts_from IS
'Chỉ tính lượt làm đề Reading/Listening nộp TỪ mốc này trở đi là bài nộp của bài
giao. Bằng GREATEST(created_at, publish_at) lúc tạo; nhảy lên NOW() khi bài được
MỞ LẠI sau lưu trữ, để việc học viên tự luyện trong lúc bài đang đóng không bị
ghi thành bài nộp. Mọi sửa đổi khác không đụng tới cột này.';


-- ── hàm xoá đọc mốc mới, và tôn trọng luật "lần giao cũ nhất giữ chỗ" ───────
--
-- Hai thay đổi so với mig 181:
--
--   1. `v_since` lấy từ attempts_from thay vì suy tại chỗ, để hàm này và
--      reconcile_test_attempts() không bao giờ nói khác nhau về cùng một bài.
--
--   2. Một lượt CHƯA bị tiêu vẫn chưa chắc là bằng chứng cho bài giao ĐANG XOÁ.
--      reconcile_test_attempts() trao nó cho lần giao CŨ NHẤT còn nợ. Nếu một
--      lượt rơi vào giữa lúc router vá xong và lúc hàm này chạy, mig 181 coi nó
--      là bằng chứng cho bài đang xoá — trong khi Python sẽ trao cho lần giao
--      cũ hơn. Màn hình ghi "0 đã nộp" mà bấm xoá lại 409. Nay loại trừ đúng
--      như vậy: có lần giao cũ hơn cùng đề, cùng học viên, còn mục chưa nộp và
--      cũng nhận được lượt ấy → lượt ấy không phải của bài này.

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
    v_since      timestamptz;
BEGIN
    SELECT TRUE, a.skill, a.content_id,
           COALESCE(a.attempts_from,
                    GREATEST(a.created_at, COALESCE(a.publish_at, a.created_at)))
      INTO v_exists, v_skill, v_content_id, v_since
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

    -- THREE kinds of evidence.
    --
    --   1. submitted_at               — the recorded hand-in
    --   2. a linked completed session — Speaking, before the ledger caught up
    --   3. a submitted attempt        — Reading/Listening, which have no hook at
    --                                   all and are ONLY repaired on read
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
                           -- Transferred learners keep their old items; work
                           -- they do now belongs to their CURRENT class.
                           AND st.cohort_id = p_cohort_id
                           AND r.test_id::text = v_content_id
                           AND r.status = 'submitted'
                           AND r.submitted_at >= v_since
                           -- Already spent on ANOTHER give of the same paper.
                           AND NOT EXISTS (
                                   SELECT 1 FROM class_assignment_items i2
                                    WHERE i2.artifact_id = r.id
                                      AND i2.assignment_id <> p_assignment_id
                               )
                           -- Claimed FIRST by an older give of the same paper.
                           AND NOT EXISTS (
                                   SELECT 1
                                     FROM class_assignments a2
                                     JOIN class_assignment_items i3
                                       ON i3.assignment_id = a2.id
                                      AND i3.student_id = i.student_id
                                    WHERE a2.id <> p_assignment_id
                                      AND a2.content_id = v_content_id
                                      AND a2.status = 'published'
                                      AND i3.submitted_at IS NULL
                                      AND r.submitted_at >= COALESCE(
                                              a2.attempts_from,
                                              GREATEST(a2.created_at,
                                                       COALESCE(a2.publish_at,
                                                                a2.created_at)))
                                      AND COALESCE(a2.attempts_from, a2.created_at)
                                          < v_since
                               )
                    )
                )
             OR (
                    v_skill = 'listening' AND v_content_id IS NOT NULL
                AND EXISTS (
                        SELECT 1
                          FROM listening_test_attempts l
                          JOIN students st ON st.id = i.student_id
                         WHERE l.user_id = st.user_id
                           AND st.cohort_id = p_cohort_id
                           AND l.test_id::text = v_content_id
                           AND l.status = 'submitted'
                           AND l.submitted_at >= v_since
                           AND NOT EXISTS (
                                   SELECT 1 FROM class_assignment_items i2
                                    WHERE i2.artifact_id = l.id
                                      AND i2.assignment_id <> p_assignment_id
                               )
                           AND NOT EXISTS (
                                   SELECT 1
                                     FROM class_assignments a2
                                     JOIN class_assignment_items i3
                                       ON i3.assignment_id = a2.id
                                      AND i3.student_id = i.student_id
                                    WHERE a2.id <> p_assignment_id
                                      AND a2.content_id = v_content_id
                                      AND a2.status = 'published'
                                      AND i3.submitted_at IS NULL
                                      AND l.submitted_at >= COALESCE(
                                              a2.attempts_from,
                                              GREATEST(a2.created_at,
                                                       COALESCE(a2.publish_at,
                                                                a2.created_at)))
                                      AND COALESCE(a2.attempts_from, a2.created_at)
                                          < v_since
                               )
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
(mig 179, siết ở 180, mở rộng ở 181/182). "Đã nộp" tính BA loại bằng chứng: sổ
cái đã ghi, phiên Speaking đã hoàn thành, và lượt làm đề Reading/Listening đã
nộp — đúng học viên còn trong lớp, đúng đề, từ attempts_from trở đi, chưa bị
tiêu cho lần giao khác và không bị lần giao CŨ HƠN giành trước.
NULL = không tìm thấy, FALSE = đã có người nộp, TRUE = đã xoá.';

-- SECURITY DEFINER functions default to EXECUTE for PUBLIC. Without this the
-- function is callable by any authenticated student, straight past require_admin.
REVOKE EXECUTE ON FUNCTION fn_delete_class_assignment_if_unsubmitted(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_delete_class_assignment_if_unsubmitted(uuid, uuid)
    TO service_role;

COMMIT;
