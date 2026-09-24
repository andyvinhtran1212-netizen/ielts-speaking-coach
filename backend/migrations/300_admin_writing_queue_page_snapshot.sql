-- Migration 300: hydrate the bounded admin Writing page inside the same
-- PostgreSQL statement that computes its filtered IDs and exact total.
-- Migration 297 stays immutable because it has already run on staging.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_admin_writing_queue_page(
    p_status     text DEFAULT NULL,
    p_cohort_id  uuid DEFAULT NULL,
    p_mock       boolean DEFAULT NULL,
    p_query      text DEFAULT NULL,
    p_overdue    boolean DEFAULT false,
    p_limit      integer DEFAULT 25,
    p_offset     integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
    v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
    v_query  text := NULLIF(pg_catalog.btrim(COALESCE(p_query, '')), '');
BEGIN
    IF p_status IS NOT NULL AND p_status NOT IN (
        'pending', 'grading', 'graded', 'reviewed', 'delivered', 'failed'
    ) THEN
        RAISE EXCEPTION 'invalid_writing_queue_status'
            USING ERRCODE = '22023';
    END IF;

    RETURN (
        WITH filtered AS MATERIALIZED (
            SELECT essay.id, essay.created_at
              FROM public.writing_essays AS essay
              JOIN public.students AS student ON student.id = essay.student_id
             WHERE essay.deleted_at IS NULL
               AND (p_status IS NULL OR essay.status = p_status)
               AND (
                    p_mock IS NULL
                    OR (p_mock AND essay.sitting_id IS NOT NULL)
                    OR (NOT p_mock AND essay.sitting_id IS NULL)
               )
               AND (
                    v_query IS NULL
                    OR pg_catalog.strpos(
                        pg_catalog.lower(student.full_name),
                        pg_catalog.lower(v_query)
                    ) > 0
                    OR pg_catalog.strpos(
                        pg_catalog.lower(student.student_code),
                        pg_catalog.lower(v_query)
                    ) > 0
                    OR pg_catalog.lower(student.id::text) = pg_catalog.lower(v_query)
               )
               AND (
                    p_cohort_id IS NULL
                    OR EXISTS (
                        SELECT 1
                          FROM public.student_cohort_memberships AS membership
                         WHERE membership.student_id = essay.student_id
                           AND membership.cohort_id = p_cohort_id
                           AND membership.is_active
                    )
               )
               AND (
                    NOT COALESCE(p_overdue, false)
                    OR (
                        essay.status <> 'delivered'
                        AND EXISTS (
                            SELECT 1
                              FROM public.writing_assignments AS assignment
                             WHERE assignment.essay_id = essay.id
                               AND assignment.deadline < pg_catalog.now()
                        )
                    )
               )
        ), page AS (
            SELECT filtered.id, filtered.created_at
              FROM filtered
             ORDER BY filtered.created_at DESC, filtered.id DESC
             LIMIT v_limit OFFSET v_offset
        ), page_rows AS (
            SELECT essay.id, essay.student_id, essay.task_type, essay.status,
                   essay.analysis_level, essay.selected_model, essay.word_count,
                   essay.created_at, essay.delivered_at, essay.error_message,
                   essay.sitting_id, essay.grading_skipped_at,
                   student.full_name AS student_full_name,
                   student.student_code,
                   (SELECT pg_catalog.min(assignment.deadline)
                      FROM public.writing_assignments AS assignment
                     WHERE assignment.essay_id = essay.id) AS deadline
              FROM page
              JOIN public.writing_essays AS essay ON essay.id = page.id
              JOIN public.students AS student ON student.id = essay.student_id
        )
        SELECT pg_catalog.jsonb_build_object(
            'essay_ids', COALESCE(
                (SELECT pg_catalog.jsonb_agg(page.id ORDER BY page.created_at DESC, page.id DESC)
                   FROM page),
                '[]'::jsonb
            ),
            'essay_rows', COALESCE(
                (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page_rows)
                    ORDER BY page_rows.created_at DESC, page_rows.id DESC)
                   FROM page_rows),
                '[]'::jsonb
            ),
            'total', (SELECT pg_catalog.count(*) FROM filtered)
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_writing_queue_page(
    text, uuid, boolean, text, boolean, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_writing_queue_page(
    text, uuid, boolean, text, boolean, integer, integer
) TO service_role;

COMMENT ON FUNCTION public.fn_admin_writing_queue_page(
    text, uuid, boolean, text, boolean, integer, integer
) IS
'Backend-only exact-count pagination for the admin Writing queue. Returns at most 100 essay IDs and their scoped row snapshot.';

COMMIT;
