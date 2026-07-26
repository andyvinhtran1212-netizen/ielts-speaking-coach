-- ============================================================================
-- Migration 163 — fn_merge_sitting_integrity (atomic soft-signal merge)
-- ============================================================================
--
-- services/mock_exam_service.record_integrity() read mock_exam_sittings.integrity
-- in Python, merged, and wrote the whole document back. Two overlapping reports
-- (a fast tab switch fires visibilitychange and pagehide close together) both
-- read the same value and the SMALLER total could write last — breaking the
-- monotonic guarantee the endpoint advertises.
--
-- Worse than an undercounted blur: void_sitting() writes the same column with
-- void_reason/voided_by merged from ITS own read, so an integrity report landing
-- in between could erase an AUDIT field.
--
-- Doing the merge in one statement fixes both. GREATEST per counter keeps the
-- monotonic promise real, and `integrity || jsonb_build_object(...)` preserves
-- every key the caller did not touch — including void_reason.
--
-- Backend-only, same as mig 161/108: SECURITY DEFINER + explicit REVOKE, since
-- this bypasses RLS by design.
--
-- Idempotent: CREATE OR REPLACE. Apply by hand in the Supabase SQL editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_merge_sitting_integrity(
    p_sitting_id     uuid,
    p_blur_count     integer DEFAULT NULL,
    p_blur_seconds   integer DEFAULT NULL,
    p_resumes        integer DEFAULT NULL,
    p_offline_events integer DEFAULT NULL,
    p_reported_at    timestamptz DEFAULT NOW()
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
       SET integrity = s.integrity || jsonb_build_object(
               -- GREATEST(old, new) per counter: a client keeps its running
               -- total in localStorage and sends an ABSOLUTE value, so a retry
               -- is idempotent and a stale report can never walk the record
               -- backwards.
               'blur_count',     GREATEST(COALESCE((s.integrity->>'blur_count')::int, 0),
                                          COALESCE(p_blur_count, 0)),
               'blur_seconds',   GREATEST(COALESCE((s.integrity->>'blur_seconds')::int, 0),
                                          COALESCE(p_blur_seconds, 0)),
               'resumes',        GREATEST(COALESCE((s.integrity->>'resumes')::int, 0),
                                          COALESCE(p_resumes, 0)),
               'offline_events', GREATEST(COALESCE((s.integrity->>'offline_events')::int, 0),
                                          COALESCE(p_offline_events, 0)),
               'reported_at',    p_reported_at)
     WHERE s.id = p_sitting_id
       AND s.status NOT IN ('released', 'void')
    RETURNING s.integrity INTO v_out;

    RETURN v_out;   -- NULL when nothing matched
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_merge_sitting_integrity(uuid, integer, integer, integer, integer, timestamptz)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_merge_sitting_integrity(uuid, integer, integer, integer, integer, timestamptz)
    TO service_role;

COMMENT ON FUNCTION fn_merge_sitting_integrity(uuid, integer, integer, integer, integer, timestamptz) IS
'Atomically merge soft integrity counters into mock_exam_sittings.integrity.
GREATEST per counter (monotonic, idempotent under retries) and jsonb-|| so keys
the caller did not touch — notably void_reason/voided_by — survive. Replaces a
Python read-modify-write that could lose a counter or an audit field to a
concurrent write. service_role ONLY: SECURITY DEFINER, bypasses RLS by design.';
