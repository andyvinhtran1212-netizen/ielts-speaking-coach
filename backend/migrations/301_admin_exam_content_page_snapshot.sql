-- Migration 301: keep the filtered content page, displayed rows, and their
-- filter-dependent associations in one PostgreSQL statement. Migration 299
-- remains immutable because it has already run on staging.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_admin_exam_content_page_ids(
    p_kind text,
    p_course_level text DEFAULT NULL,
    p_cohort_id uuid DEFAULT NULL,
    p_exam_only boolean DEFAULT NULL,
    p_is_public boolean DEFAULT NULL,
    p_query text DEFAULT NULL,
    p_attention text DEFAULT 'all',
    p_limit integer DEFAULT 25,
    p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_result jsonb;
    v_query text := NULLIF(pg_catalog.btrim(COALESCE(p_query, '')), '');
BEGIN
    IF p_kind IS NULL OR p_kind NOT IN ('reading', 'listening', 'writing')
       OR p_attention IS NULL OR p_attention NOT IN ('all', 'action', 'unassigned', 'no-level', 'draft')
       OR p_limit IS NULL OR p_limit < 0 OR p_limit > 100
       OR p_offset IS NULL OR p_offset < 0
       OR pg_catalog.length(COALESCE(v_query, '')) > 100 THEN
        RAISE EXCEPTION 'invalid_admin_exam_content_page_query' USING ERRCODE = '22023';
    END IF;

    WITH source AS (
        SELECT 'reading'::text AS kind, paper.id, paper.test_id AS code,
               paper.title, paper.course_level, paper.status,
               paper.exam_only, paper.is_public,
               paper.public_practice_enabled, paper.web_explanation_mode::text,
               paper.test_type::text, paper.passage_count, paper.total_questions,
               NULL::text AS audio_assembly_mode,
               NULL::text AS full_audio_storage_path,
               NULL::text AS assembled_audio_storage_path,
               CASE WHEN paper.test_type = 'mini'
                    THEN paper.passage_count = 1 AND paper.total_questions >= 1
                    ELSE paper.passage_count = 3 AND paper.total_questions = 40
               END AS publish_ready
          FROM public.reading_tests AS paper
         WHERE p_kind = 'reading'
        UNION ALL
        SELECT 'listening'::text, paper.id, paper.test_id,
               paper.title, paper.course_level, paper.status,
               paper.exam_only, paper.is_public,
               paper.public_practice_enabled, paper.web_explanation_mode::text,
               paper.test_type::text, NULL::integer, NULL::integer,
               paper.audio_assembly_mode::text,
               paper.full_audio_storage_path, paper.assembled_audio_storage_path,
               ((paper.audio_assembly_mode = 'full_premixed'
                   AND COALESCE(paper.full_audio_storage_path, '') <> '')
                OR (paper.audio_assembly_mode = 'parts_auto_assembled'
                   AND COALESCE(paper.assembled_audio_storage_path, '') <> ''))
          FROM public.listening_tests AS paper
         WHERE p_kind = 'listening'
        UNION ALL
        SELECT 'writing'::text, prompt.id, NULL::text,
               prompt.title, prompt.course_level,
               CASE WHEN prompt.is_active THEN 'published' ELSE 'archived' END,
               prompt.exam_only, NULL::boolean,
               NULL::boolean, NULL::text, NULL::text,
               NULL::integer, NULL::integer,
               NULL::text, NULL::text, NULL::text, false
          FROM public.writing_prompts AS prompt
         WHERE p_kind = 'writing'
    ), scoped AS (
        SELECT source.*,
               EXISTS (
                   SELECT 1 FROM public.exam_content_cohorts AS link
                    WHERE link.content_kind = source.kind
                      AND link.content_id = source.id
               ) AS has_cohort,
               EXISTS (
                   SELECT 1 FROM public.exam_content_cohorts AS link
                    WHERE link.content_kind = source.kind
                      AND link.content_id = source.id
                      AND link.cohort_id = p_cohort_id
               ) AS in_cohort,
               EXISTS (
                   SELECT 1 FROM public.mock_exams AS exam
                    WHERE (source.kind = 'reading' AND exam.reading_test_id = source.id)
                       OR (source.kind = 'listening' AND exam.listening_test_id = source.id)
                       OR (source.kind = 'writing' AND (
                           exam.writing_task1_prompt_id = source.id
                           OR exam.writing_task2_prompt_id = source.id))
               ) AS in_mock
          FROM source
    ), filtered AS MATERIALIZED (
        SELECT scoped.*
          FROM scoped
         WHERE (p_course_level IS NULL
                OR COALESCE(scoped.course_level, '') = p_course_level)
           AND (p_cohort_id IS NULL OR scoped.in_cohort)
           AND (p_exam_only IS NULL OR COALESCE(scoped.exam_only, false) = p_exam_only)
           AND (p_is_public IS NULL OR (scoped.kind <> 'writing'
                AND COALESCE(scoped.is_public, false) = p_is_public))
           AND (v_query IS NULL OR
                pg_catalog.strpos(pg_catalog.lower(scoped.id::text), pg_catalog.lower(v_query)) > 0 OR
                pg_catalog.strpos(pg_catalog.lower(COALESCE(scoped.code, '')), pg_catalog.lower(v_query)) > 0 OR
                pg_catalog.strpos(pg_catalog.lower(COALESCE(scoped.title, '')), pg_catalog.lower(v_query)) > 0 OR
                pg_catalog.strpos(pg_catalog.lower(COALESCE(scoped.course_level, '')), pg_catalog.lower(v_query)) > 0)
           AND CASE p_attention
               WHEN 'no-level' THEN COALESCE(scoped.course_level, '') = ''
               WHEN 'draft' THEN scoped.status = 'draft'
               WHEN 'unassigned' THEN NOT scoped.in_mock
               WHEN 'action' THEN scoped.status <> 'archived' AND (
                   (scoped.kind <> 'writing' AND
                    (scoped.status <> 'published' OR NOT COALESCE(scoped.publish_ready, false)))
                   OR COALESCE(scoped.course_level, '') = ''
                   OR NOT scoped.has_cohort)
               ELSE true
           END
    ), page AS (
        SELECT filtered.*
          FROM filtered
         ORDER BY pg_catalog.lower(COALESCE(filtered.code, filtered.title, '')),
                  filtered.id
         LIMIT p_limit OFFSET p_offset
    ), page_rows AS (
        SELECT page.*,
               COALESCE((
                   SELECT pg_catalog.jsonb_agg(link.cohort_id ORDER BY link.cohort_id)
                     FROM public.exam_content_cohorts AS link
                    WHERE link.content_kind = page.kind
                      AND link.content_id = page.id
               ), '[]'::jsonb) AS cohort_ids,
               COALESCE((
                   SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'id', exam.id, 'code', exam.code,
                       'title', exam.title, 'status', exam.status
                   ) ORDER BY exam.created_at DESC, exam.id DESC)
                     FROM public.mock_exams AS exam
                    WHERE (page.kind = 'reading' AND exam.reading_test_id = page.id)
                       OR (page.kind = 'listening' AND exam.listening_test_id = page.id)
                       OR (page.kind = 'writing' AND (
                           exam.writing_task1_prompt_id = page.id
                           OR exam.writing_task2_prompt_id = page.id))
               ), '[]'::jsonb) AS mock_exams
          FROM page
    )
    SELECT pg_catalog.jsonb_build_object(
        'ids', COALESCE((SELECT pg_catalog.jsonb_agg(page.id ORDER BY
            pg_catalog.lower(COALESCE(page.code, page.title, '')), page.id)
            FROM page), '[]'::jsonb),
        'rows', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page_rows) ORDER BY
            pg_catalog.lower(COALESCE(page_rows.code, page_rows.title, '')), page_rows.id)
            FROM page_rows), '[]'::jsonb),
        'total', (SELECT pg_catalog.count(*) FROM filtered)
    ) INTO v_result;
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_exam_content_page_ids(
    text, text, uuid, boolean, boolean, text, text, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_exam_content_page_ids(
    text, text, uuid, boolean, boolean, text, text, integer, integer
) TO service_role;

COMMENT ON FUNCTION public.fn_admin_exam_content_page_ids(
    text, text, uuid, boolean, boolean, text, text, integer, integer
) IS 'Backend-only bounded admin catalog. Filtered count, page rows, cohorts and mock references share one statement snapshot.';

COMMIT;
