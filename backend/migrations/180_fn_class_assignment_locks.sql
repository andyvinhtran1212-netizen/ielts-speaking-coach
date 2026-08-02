-- ============================================================================
-- Migration 180 — vá hai chỗ khoá/kiểm còn hở của migration 179
-- ============================================================================
--
-- Codex review round 7 on PR #902. Migration 179 is already applied to
-- production, so these are CREATE OR REPLACE in a new file rather than an edit
-- in place — forward-only, as the directory README requires.
--
--   1. XOÁ BÀI GIAO chỉ tra `class_assignment_items.submitted_at`.
--
--      But this feature explicitly treats a COMPLETED SESSION as the durable
--      evidence of a hand-in: reconcile_ledger_from_sessions() exists precisely
--      because the ledger write at completion time is best-effort and can fail.
--      So there is a window where the student has finished the work, the item
--      still says submitted_at IS NULL, and the guard happily allows DELETE.
--      The cascade then removes the item AND nulls the session's
--      class_assignment_item_id — after which no reconciliation can ever find it
--      again. The hand-in is gone for good, which is the one outcome this guard
--      exists to prevent.
--
--      The fix consults the same evidence the repair path does.
--
--   2. GẮN PHIÊN khoá `i` nhưng không khoá `a`.
--
--      `FOR UPDATE OF i` locks the item row only. The status it validates lives
--      on class_assignments, which stays free — so an archive can commit between
--      this SELECT seeing 'published' and the UPDATE that writes the link, and
--      POST /sessions returns a session bound to a task that has already closed.
--      Exactly what 179's own comment claimed was impossible.
--
--      Locking both rows in the same SELECT is what actually makes that claim
--      true. The archive path (PATCH … status) takes the ordinary row lock on
--      class_assignments, so it now waits.
--
-- TO REVERSE: re-apply migration 179 (it defines the earlier versions of both
-- functions with CREATE OR REPLACE).
--
-- Idempotent. Apply by hand.
-- ============================================================================

BEGIN;

-- ── 1. Xoá bài giao: phiên đã hoàn thành CŨNG là bằng chứng đã nộp ──────────
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

    -- Lock the linked SESSIONS too, before reading their status.
    --
    -- Without this the EXISTS below can read a session that PATCH /complete is
    -- mid-way through updating, see the pre-completion status, and let the
    -- delete through. The cascade then blocks on that same session update, and
    -- once it lands the item is gone and the session's link has been set to
    -- NULL — so the ledger write that follows finds no row and the hand-in is
    -- lost. Taking the lock first makes the completion wait for us instead.
    PERFORM 1
       FROM sessions s
       JOIN class_assignment_items i ON i.id = s.class_assignment_item_id
      WHERE i.assignment_id = p_assignment_id
      FOR UPDATE OF s;

    -- TWO kinds of evidence, not one.
    --
    -- submitted_at is the recorded hand-in. A linked COMPLETED SESSION is the
    -- same hand-in before the ledger caught up — the completion write is
    -- best-effort and reconcile_ledger_from_sessions() exists to repair it
    -- later. Deleting on the strength of submitted_at alone destroys the item
    -- and nulls the session link, after which the repair can never find it.
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
(mig 179, siết ở 180). "Đã nộp" tính CẢ phiên đã hoàn thành còn gắn với bài —
đó là bằng chứng bền khi lệnh ghi sổ lúc hoàn thành bị lỗi. NULL = không tìm
thấy, FALSE = đã có người nộp, TRUE = đã xoá.';


-- ── 2. Gắn phiên: khoá CẢ dòng bài giao ─────────────────────────────────────
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
    -- FOR UPDATE OF i, a — locking the item alone left the assignment row free,
    -- so an archive could commit between this SELECT seeing 'published' and the
    -- UPDATE below, and the session would be bound to a closed task.
    SELECT TRUE INTO v_ok
      FROM class_assignment_items i
      JOIN class_assignments a ON a.id = i.assignment_id
      JOIN students s          ON s.id = i.student_id
     WHERE i.id = p_item_id
       AND s.user_id = p_user_id
       AND a.status = 'published'
       AND (a.publish_at IS NULL OR a.publish_at <= NOW())
     FOR UPDATE OF i, a;

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
'Gắn phiên Speaking vào bài tập của lớp; kiểm quyền sở hữu + "bài còn mở" dưới
khoá CẢ dòng item LẪN dòng bài giao, cùng giao dịch với lệnh ghi (mig 179, siết
ở 180 — khoá thiếu dòng bài giao thì một lệnh lưu trữ vẫn chen vào giữa được).';


-- Grants are per-signature and neither signature changed, so 179''s
-- REVOKE/GRANT still hold. Re-stated anyway: CREATE OR REPLACE keeps existing
-- privileges, but saying it here means a reader never has to go and check.
REVOKE EXECUTE ON FUNCTION public.fn_delete_class_assignment_if_unsubmitted(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_delete_class_assignment_if_unsubmitted(uuid, uuid)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_bind_session_to_class_item(uuid, uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_bind_session_to_class_item(uuid, uuid, uuid)
    TO service_role;

COMMIT;
