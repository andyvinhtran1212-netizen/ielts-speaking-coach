-- ============================================================================
-- Migration 179 — giao bài và xoá bài giao phải NGUYÊN TỬ
-- ============================================================================
--
-- Codex review on PR #902 found two ledger-integrity holes that no amount of
-- ordering in Python can close, because each PostgREST call is its own
-- transaction:
--
--   1. CREATE. The parent `class_assignments` row commits, then the per-student
--      `class_assignment_items` are inserted in a second request. If that second
--      request fails — transient error, constraint violation — the endpoint
--      returns 500 and leaves a PUBLISHED give with zero or partial recipients.
--      After a reload it looks like a real 0/N assignment, and students who
--      never got a row read as students who did not do the work.
--
--   2. DELETE. The "has anyone submitted?" check and the DELETE are two
--      requests. A student completing their session in between is recorded as
--      submitted and then erased by ON DELETE CASCADE — destroying exactly the
--      evidence the guard exists to protect, and nulling the link on their
--      completed session so nothing points back.
--
-- Both are now single statements inside one function, so either everything
-- happens or nothing does.
--
-- WHY FUNCTIONS AND NOT A PYTHON TRANSACTION. The backend talks to Postgres
-- through PostgREST, which has no multi-statement transaction. This repo already
-- solves the same class of problem the same way — fn_create_session_daily_capped
-- (mig 126) for the count-then-insert race, fn_insert_listening_answer_once
-- (mig 174) for read-then-write. This is that pattern, applied twice more.
--
-- SECURITY DEFINER + a pinned search_path, matching mig 108/113 hardening. Both
-- functions are called only by the service-role backend, which has already
-- checked admin rights; they enforce data integrity, not authorisation.
--
-- TO REVERSE:
--   DROP FUNCTION IF EXISTS fn_create_class_assignment(uuid, uuid, text, uuid, jsonb, text, text, timestamptz, timestamptz, text, uuid);
--   DROP FUNCTION IF EXISTS fn_delete_class_assignment_if_unsubmitted(uuid, uuid);
--
-- Idempotent (CREATE OR REPLACE). Apply by hand.
-- ============================================================================

BEGIN;

-- ── 1. Giao bài: cha + con trong MỘT giao dịch ──────────────────────────────
--
-- Returns the created assignment row plus the number of students it reached.
-- Raises when the roster is empty so the caller never has to clean up after a
-- give that reached nobody.
CREATE OR REPLACE FUNCTION fn_create_class_assignment(
    p_cohort_id      uuid,
    p_skill          text,
    p_title          text,
    p_lesson_id      uuid        DEFAULT NULL,
    p_content_config jsonb       DEFAULT '{}'::jsonb,
    p_content_id     uuid        DEFAULT NULL,
    p_instructions   text        DEFAULT NULL,
    p_due_at         timestamptz DEFAULT NULL,
    p_publish_at     timestamptz DEFAULT NULL,
    p_status         text        DEFAULT 'published',
    p_assigned_by    uuid        DEFAULT NULL
)
RETURNS TABLE (
    assignment        jsonb,
    student_count     integer,
    unactivated_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id        uuid;
    v_total     integer;
    v_unactive  integer;
    v_row       class_assignments%ROWTYPE;
BEGIN
    -- Roster first: an empty class must not leave a row behind, and counting
    -- here rather than in the caller keeps the check and the insert in the same
    -- transaction (a student added between the two would otherwise be missed).
    SELECT count(*), count(*) FILTER (WHERE user_id IS NULL)
      INTO v_total, v_unactive
      FROM students
     WHERE cohort_id = p_cohort_id;

    IF v_total = 0 THEN
        RAISE EXCEPTION 'empty_roster'
            USING HINT = 'Lớp này chưa có học viên nào để giao bài.';
    END IF;

    INSERT INTO class_assignments (
        cohort_id, lesson_id, skill, content_id, content_config,
        title, instructions, due_at, publish_at, status, assigned_by
    ) VALUES (
        p_cohort_id, p_lesson_id, p_skill, p_content_id, COALESCE(p_content_config, '{}'::jsonb),
        p_title, p_instructions, p_due_at, p_publish_at, COALESCE(p_status, 'published'), p_assigned_by
    )
    RETURNING * INTO v_row;

    v_id := v_row.id;

    -- Set-based, so the whole roster lands in one statement — no page loop that
    -- could stop halfway, and no PostgREST row cap to trip over.
    INSERT INTO class_assignment_items (assignment_id, student_id)
    SELECT v_id, s.id FROM students s WHERE s.cohort_id = p_cohort_id;

    assignment        := to_jsonb(v_row);
    student_count     := v_total;
    unactivated_count := v_unactive;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION fn_create_class_assignment IS
'Tạo bài giao + nở ra toàn bộ sĩ số trong MỘT giao dịch (mig 179). Trước đó cha
và con là hai request PostgREST riêng: con hỏng thì còn lại một bài đã publish
mà không tới ai, nhìn như bài 0/N thật. Lớp rỗng thì raise empty_roster.';


-- ── 2. Xoá bài giao: khoá, kiểm, rồi mới xoá ────────────────────────────────
--
-- Returns TRUE when the give was deleted, FALSE when someone had already
-- submitted. The caller turns FALSE into a 409.
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
    -- Lock the parent for the rest of the transaction. A completion landing
    -- between the check and the delete would otherwise be recorded and then
    -- erased by ON DELETE CASCADE — destroying the very evidence this guard
    -- protects, and nulling the link on the student's completed session.
    SELECT TRUE INTO v_exists
      FROM class_assignments
     WHERE id = p_assignment_id AND cohort_id = p_cohort_id
     FOR UPDATE;

    IF v_exists IS NOT TRUE THEN
        RETURN NULL;          -- not found (or not in this class) — caller 404s
    END IF;

    -- Lock the ITEM rows, not just the parent. mark_item_submitted updates a
    -- child row and never touches class_assignments, so FOR UPDATE on the parent
    -- does not block it: a completion could still commit between this scan and
    -- the cascading delete, and be erased along with the evidence. Locking the
    -- children is what actually serialises the two.
    PERFORM 1 FROM class_assignment_items
      WHERE assignment_id = p_assignment_id
      FOR UPDATE;

    SELECT EXISTS (
        SELECT 1 FROM class_assignment_items
         WHERE assignment_id = p_assignment_id AND submitted_at IS NOT NULL
    ) INTO v_submitted;

    IF v_submitted THEN
        RETURN FALSE;
    END IF;

    DELETE FROM class_assignments WHERE id = p_assignment_id;
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION fn_delete_class_assignment_if_unsubmitted IS
'Xoá bài giao CHỈ KHI chưa ai nộp, kiểm và xoá trong cùng một giao dịch có khoá
dòng (mig 179). NULL = không tìm thấy, FALSE = đã có người nộp, TRUE = đã xoá.';


-- ── 3. Gắn phiên vào bài tập: kiểm "còn mở" và ghi liên kết cùng lúc ────────
--
-- Validation in Python happens BEFORE the session is created (so a rejection
-- never burns a daily slot), but between that check and the write the assignment
-- can be archived. Re-checking here, inside the same statement as the UPDATE,
-- is the only way the link cannot be written for a task that is already closed.
--
-- Returns TRUE when linked, FALSE when the assignment is no longer open or the
-- item is gone. The caller deletes the session it just made when this is FALSE.
CREATE OR REPLACE FUNCTION fn_bind_session_to_class_item(
    p_session_id uuid,
    p_item_id    uuid,
    p_user_id    uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ok boolean;
BEGIN
    -- Ownership AND open-state in one read, locked so an archive landing now
    -- waits for this transaction instead of racing it.
    SELECT TRUE INTO v_ok
      FROM class_assignment_items i
      JOIN class_assignments a ON a.id = i.assignment_id
      JOIN students s          ON s.id = i.student_id
     WHERE i.id = p_item_id
       AND s.user_id = p_user_id
       AND a.status = 'published'
       AND (a.publish_at IS NULL OR a.publish_at <= NOW())
     FOR UPDATE OF i;

    IF v_ok IS NOT TRUE THEN
        RETURN FALSE;
    END IF;

    UPDATE sessions
       SET class_assignment_item_id = p_item_id
     WHERE id = p_session_id;

    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION fn_bind_session_to_class_item IS
'Gắn phiên Speaking vào bài tập của lớp, kiểm quyền sở hữu + "bài còn mở" trong
cùng giao dịch với lệnh ghi (mig 179). Trước đó hai bước tách rời: bài bị lưu trữ
xen vào giữa thì liên kết vẫn được ghi cho một bài đã đóng.';


-- ── Quyền gọi: BACKEND-ONLY ─────────────────────────────────────────────────
--
-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, and Supabase
-- exposes every function in `public` through PostgREST to `anon` and
-- `authenticated`. Without these REVOKEs a logged-in student who knows a cohort
-- or assignment id — both of which the student endpoints hand out — could call
-- these RPCs directly and create or delete class assignments, straight past
-- require_admin. Same lock as migrations 161/174 (see
-- tests/test_migration_161_rpc_grants.py).
REVOKE EXECUTE ON FUNCTION public.fn_create_class_assignment(uuid, text, text, uuid, jsonb, uuid, text, timestamptz, timestamptz, text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_create_class_assignment(uuid, text, text, uuid, jsonb, uuid, text, timestamptz, timestamptz, text, uuid)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_delete_class_assignment_if_unsubmitted(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_delete_class_assignment_if_unsubmitted(uuid, uuid)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_bind_session_to_class_item(uuid, uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_bind_session_to_class_item(uuid, uuid, uuid)
    TO service_role;

COMMIT;
