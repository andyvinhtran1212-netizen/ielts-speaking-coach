-- ============================================================================
-- Migration 168 — fn_void_sitting (atomic void + audit merge)
-- ============================================================================
--
-- Migration 163 made the integrity COUNTER path atomic, but void_sitting() was
-- left as a Python read-modify-write of the same column: it reads
-- mock_exam_sittings.integrity, adds void_reason/voided_by, and writes the whole
-- document back. So the interleaving
--
--     void_sitting reads integrity   →   fn_merge_sitting_integrity commits
--     new counters                   →   void_sitting writes its STALE copy
--
-- erases the counters that just landed, and the monotonic guarantee 163
-- advertises is broken from the other side (Codex review, PR #849).
--
-- Doing the whole transition in one statement fixes it: `integrity || {...}`
-- keeps every key the void path did not touch — including the counters — while
-- stamping the two audit fields.
--
-- The status guard is duplicated from the service on purpose. A RELEASED sitting
-- must not be voided: it is a published result the student can already see, and
-- voiding would leave a `void` row whose seal was lifted at release, i.e. a
-- cancelled sitting still exposing scores. NULL means "nothing matched", which
-- the caller reports rather than swallowing.
--
-- Backend-only, same as mig 161/163: SECURITY DEFINER + explicit REVOKE.
--
-- Idempotent: CREATE OR REPLACE. Apply by hand in the Supabase SQL editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_void_sitting(
    p_sitting_id uuid,
    p_admin_id   text,
    p_reason     text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_out jsonb;
BEGIN
    UPDATE mock_exam_sittings s
       SET status    = 'void',
           -- Keep the sitting SEALED. A voided exam never publishes results;
           -- only release_results ever lifts the seal.
           integrity = COALESCE(s.integrity, '{}'::jsonb) || jsonb_build_object(
               'void_reason', p_reason,
               'voided_by',   p_admin_id,
               'voided_at',   NOW())
     WHERE s.id = p_sitting_id
       AND s.status <> 'released'
    RETURNING to_jsonb(s) INTO v_out;

    RETURN v_out;   -- NULL when nothing matched (missing, or already released)
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_void_sitting(uuid, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_void_sitting(uuid, text, text)
    TO service_role;

COMMENT ON FUNCTION fn_void_sitting(uuid, text, text) IS
'Atomically void a mock sitting and stamp its audit fields, merging into
integrity with jsonb-|| so counters committed by fn_merge_sitting_integrity are
preserved rather than clobbered by a stale read-modify-write. Refuses a released
sitting (returns NULL). service_role ONLY: SECURITY DEFINER, bypasses RLS.';
