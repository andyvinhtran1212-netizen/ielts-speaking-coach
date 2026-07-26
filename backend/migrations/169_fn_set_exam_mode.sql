-- ============================================================================
-- Migration 169 — fn_set_exam_mode (atomic mode change)
--
-- WHY. mock_exams.exam_mode is not a setting, it is the contract every sitting
-- is READ under: _sitting_sections() resolves the mode from the exam row on
-- every read, and nothing stores it on the sitting. Flipping a sequential exam
-- that has live sittings to retake makes those rows resolve to an EMPTY skill
-- set (they carry no assigned_skills) — the runner shows an empty menu, the
-- reaper skips them, and the papers can never be collected or finalised.
--
-- The service checked for dependents and then PATCHed the row: two separate
-- PostgREST requests. A sitting inserted between the two is read under the
-- wrong mode (Codex review, PR #859). PostgREST has no cross-table transaction
-- from Python, so the invariant has to be expressed as ONE statement.
--
-- WHAT THIS DOES AND DOES NOT GUARANTEE. The UPDATE's NOT EXISTS predicates are
-- evaluated in the same statement as the write, so a sitting or assignment that
-- is already committed makes the mode change fail — atomically, with no window.
-- It does NOT serialise against a sitting that commits DURING this statement:
-- under READ COMMITTED that row is invisible to the subquery snapshot. Closing
-- that last gap would require locking the exam row in create_sitting/assign as
-- well; this migration deliberately stops short of that, and the residual race
-- is one round-trip wide on an action only an admin performs.
--
-- Idempotent: CREATE OR REPLACE. Apply by hand in the Supabase SQL editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_set_exam_mode(
    p_exam_id uuid,
    p_mode    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_out jsonb;
BEGIN
    IF p_mode NOT IN ('sequential', 'retake') THEN
        RAISE EXCEPTION 'invalid exam_mode: %', p_mode;
    END IF;

    UPDATE mock_exams e
       SET exam_mode = p_mode
     WHERE e.id = p_exam_id
       -- Already the requested mode → not a change; the caller short-circuits
       -- before reaching here, but the predicate keeps this callable safely.
       AND COALESCE(e.exam_mode, 'sequential') IS DISTINCT FROM p_mode
       -- A VOIDED sitting does not count: it is a closed record nothing reads a
       -- skill set out of, so an admin who genuinely needs to convert an exam
       -- has a way through (cancel the sittings, remove the assignments, flip).
       AND NOT EXISTS (
               SELECT 1 FROM mock_exam_sittings s
                WHERE s.mock_exam_id = e.id
                  AND s.status <> 'void'
           )
       AND NOT EXISTS (
               SELECT 1 FROM mock_exam_assignments a
                WHERE a.exam_id = e.id
           )
    RETURNING to_jsonb(e) INTO v_out;

    RETURN v_out;   -- NULL when refused (missing exam, no-op, or dependents)
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_set_exam_mode(uuid, text)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_set_exam_mode(uuid, text)
    TO service_role;

COMMENT ON FUNCTION fn_set_exam_mode(uuid, text) IS
'Atomically change mock_exams.exam_mode, refusing when the exam already has a
non-void sitting or any assignment. Replaces a read-then-write in
mock_exam_service.admin_update_exam whose gap let a concurrently-created sitting
be interpreted under the wrong mode (Codex review, PR #859). Returns the updated
row, or NULL when the change was refused.';
