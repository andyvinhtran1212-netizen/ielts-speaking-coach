-- ============================================================================
-- Migration 172 — fn_set_exam_content_cohorts (thay tập lớp một cách nguyên tử)
--
-- WHY. set_cohorts() advertises a full REPLACEMENT of the classes a paper is
-- meant for, but did it as two PostgREST calls: insert the additions, then
-- delete the removals. If the delete fails — or fails on a later chunk — the PUT
-- returns an error while the database keeps {old ∪ new}. The endpoint has then
-- both failed AND widened the assignment, which can leave a paper visible to a
-- class the admin was in the middle of taking it away from (Codex review,
-- PR #864).
--
-- Ordering could not fix it: deleting first leaves the paper assigned to nobody
-- if the insert then fails. Only one transaction removes both failure modes, and
-- PostgREST gives Python no cross-statement transaction — so it becomes an RPC,
-- the same pattern as mig 163/168/169.
--
-- TO REVERSE:
--   DROP FUNCTION IF EXISTS fn_set_exam_content_cohorts(text, uuid, uuid[], uuid);
--   (the service falls back to nothing — restore the previous two-call version)
--
-- Apply by hand in the Supabase SQL editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_set_exam_content_cohorts(
    p_kind       text,
    p_content_id uuid,
    p_cohort_ids uuid[],
    p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_added   uuid[];
    v_removed integer;
BEGIN
    IF p_kind NOT IN ('reading', 'listening', 'writing') THEN
        RAISE EXCEPTION 'invalid content_kind: %', p_kind;
    END IF;

    -- Both statements run in ONE implicit transaction: either the set ends up
    -- exactly as asked, or it is untouched. Never a partial widening.
    WITH wanted AS (
        SELECT DISTINCT unnest(COALESCE(p_cohort_ids, '{}'::uuid[])) AS cohort_id
    ),
    gone AS (
        DELETE FROM exam_content_cohorts e
         WHERE e.content_kind = p_kind
           AND e.content_id   = p_content_id
           AND e.cohort_id NOT IN (SELECT cohort_id FROM wanted)
        RETURNING 1
    ),
    ins AS (
        INSERT INTO exam_content_cohorts (content_kind, content_id, cohort_id, created_by)
        SELECT p_kind, p_content_id, w.cohort_id, p_created_by
          FROM wanted w
        -- Re-sending the same set is a no-op, not a churn of rows: the admin
        -- screen sends the whole state on every save, and a double-click must
        -- not rewrite what is already there.
        ON CONFLICT (content_kind, content_id, cohort_id) DO NOTHING
        RETURNING cohort_id
    )
    SELECT COALESCE(array_agg(ins.cohort_id), '{}'::uuid[]),
           (SELECT count(*) FROM gone)
      INTO v_added, v_removed
      FROM ins;

    RETURN jsonb_build_object(
        'added',      COALESCE(to_jsonb(v_added), '[]'::jsonb),
        'removed',    COALESCE(v_removed, 0),
        'cohort_ids', COALESCE(
            (SELECT jsonb_agg(DISTINCT c) FROM unnest(COALESCE(p_cohort_ids, '{}'::uuid[])) c),
            '[]'::jsonb)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_set_exam_content_cohorts(text, uuid, uuid[], uuid)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_set_exam_content_cohorts(text, uuid, uuid[], uuid)
    TO service_role;

COMMENT ON FUNCTION fn_set_exam_content_cohorts(text, uuid, uuid[], uuid) IS
'Atomically replace the set of cohorts a mock-exam paper is assigned to. Replaces
a two-call insert-then-delete whose failure left {old ∪ new} persisted while the
request reported an error (Codex review, PR #864).';
