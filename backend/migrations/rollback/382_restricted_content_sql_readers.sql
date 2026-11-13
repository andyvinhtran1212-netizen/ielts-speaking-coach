-- Manual M-B rollback: close importer and revert dependent Python before running.
-- Fail closed on changed bodies or restricted data. Columns (including the
-- appended catalog restricted column) are intentionally retained per SA ruling.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.listening_tests, public.listening_content, public.listening_test_attempts,
    public.dictation_sessions IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_admin_exam_content_page_ids(text,text,uuid,boolean,boolean,text,text,integer,integer)'::pg_catalog.regprocedure) IS DISTINCT FROM 'b070513c72437b6c7af3c831ac39dd683147b0dacba89d53d985aa39f4e1e1c4'
       OR (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_admin_exam_content_levels(text)'::pg_catalog.regprocedure) IS DISTINCT FROM '1ee77de939793459a841597d6f76f535881af47e9223764037b21f58278270f8'
       OR EXISTS (SELECT 1 FROM public.listening_tests WHERE restricted IS DISTINCT FROM false)
       OR EXISTS (SELECT 1 FROM public.listening_content WHERE restricted IS DISTINCT FROM false)
       OR EXISTS (SELECT 1 FROM public.listening_test_attempts WHERE restricted IS DISTINCT FROM false)
       OR EXISTS (SELECT 1 FROM public.dictation_sessions WHERE restricted IS DISTINCT FROM false)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid IN ('public.fn_admin_exam_content_page_ids(text,text,uuid,boolean,boolean,text,text,integer,integer)'::pg_catalog.regprocedure, 'public.fn_admin_exam_content_levels(text)'::pg_catalog.regprocedure)
          AND (NOT p.prosecdef OR p.provolatile <> 's' OR p.proowner <> 'postgres'::pg_catalog.regrole
               OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
               OR NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
        WHERE p.oid IN ('public.fn_admin_exam_content_page_ids(text,text,uuid,boolean,boolean,text,text,integer,integer)'::pg_catalog.regprocedure, 'public.fn_admin_exam_content_levels(text)'::pg_catalog.regprocedure)
          AND (acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole) OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable))
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c WHERE c.oid = 'public.listening_public_practice_catalog'::pg_catalog.regclass
                    AND c.reloptions @> ARRAY['security_barrier=true'] AND pg_catalog.has_table_privilege('service_role',c.oid,'SELECT'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) AS acl
        WHERE c.oid = 'public.listening_public_practice_catalog'::pg_catalog.regclass AND acl.grantee <> c.relowner
          AND (acl.grantee <> 'service_role'::pg_catalog.regrole OR acl.privilege_type <> 'SELECT' OR acl.is_grantable))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a
        JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
        CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS acl
        WHERE c.oid = 'public.listening_public_practice_catalog'::pg_catalog.regclass AND acl.grantee <> c.relowner
          AND (acl.grantee <> 'service_role'::pg_catalog.regrole OR acl.privilege_type <> 'SELECT' OR acl.is_grantable))
       OR pg_catalog.pg_get_viewdef('public.listening_public_practice_catalog'::pg_catalog.regclass) !~ 'NOT ([a-z_]+[.])?restricted' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '382 rollback unsafe: body drift or restricted data; roll forward';
    END IF;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.fn_admin_exam_content_levels(p_kind text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_result jsonb;
BEGIN
    IF p_kind IS NULL OR p_kind NOT IN ('reading', 'listening', 'writing') THEN
        RAISE EXCEPTION 'invalid_admin_exam_content_level_kind' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(pg_catalog.jsonb_agg(level ORDER BY level), '[]'::jsonb)
      INTO v_result
      FROM (
          SELECT DISTINCT pg_catalog.btrim(course_level) AS level
            FROM public.reading_tests WHERE p_kind = 'reading'
          UNION
          SELECT DISTINCT pg_catalog.btrim(course_level)
            FROM public.listening_tests WHERE p_kind = 'listening'
          UNION
          SELECT DISTINCT pg_catalog.btrim(course_level)
            FROM public.writing_prompts WHERE p_kind = 'writing'
      ) AS levels
     WHERE level IS NOT NULL AND level <> '';
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_exam_content_levels(text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_exam_content_levels(text)
    TO service_role;

CREATE OR REPLACE VIEW public.listening_public_practice_catalog WITH (security_barrier=true) AS
    SELECT t.* FROM public.listening_tests t WHERE public.fn_mock_public_practice_allowed('listening',t.id);
REVOKE ALL ON public.listening_public_practice_catalog FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.listening_public_practice_catalog TO service_role;

DO $$
BEGIN
    IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_admin_exam_content_page_ids(text,text,uuid,boolean,boolean,text,text,integer,integer)'::pg_catalog.regprocedure) IS DISTINCT FROM '2e9d91fb7d1a8c7e5f173ad3747c72e839e99a23dd4b337d19137903a6b438e7'
       OR (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_admin_exam_content_levels(text)'::pg_catalog.regprocedure) IS DISTINCT FROM 'f1cd4fe03508d72548f5f34c2c3ecb52260d2a9db6d2e31f7338c6796414050c'
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid IN ('public.fn_admin_exam_content_page_ids(text,text,uuid,boolean,boolean,text,text,integer,integer)'::pg_catalog.regprocedure, 'public.fn_admin_exam_content_levels(text)'::pg_catalog.regprocedure)
          AND (NOT p.prosecdef OR p.provolatile <> 's' OR p.proowner <> 'postgres'::pg_catalog.regrole
               OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
               OR NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
        WHERE p.oid IN ('public.fn_admin_exam_content_page_ids(text,text,uuid,boolean,boolean,text,text,integer,integer)'::pg_catalog.regprocedure, 'public.fn_admin_exam_content_levels(text)'::pg_catalog.regprocedure)
          AND (acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole) OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable))
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c WHERE c.oid = 'public.listening_public_practice_catalog'::pg_catalog.regclass
                    AND c.reloptions @> ARRAY['security_barrier=true'] AND pg_catalog.has_table_privilege('service_role',c.oid,'SELECT'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) AS acl
        WHERE c.oid = 'public.listening_public_practice_catalog'::pg_catalog.regclass AND acl.grantee <> c.relowner
          AND (acl.grantee <> 'service_role'::pg_catalog.regrole OR acl.privilege_type <> 'SELECT' OR acl.is_grantable))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a
        JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
        CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS acl
        WHERE c.oid = 'public.listening_public_practice_catalog'::pg_catalog.regclass AND acl.grantee <> c.relowner
          AND (acl.grantee <> 'service_role'::pg_catalog.regrole OR acl.privilege_type <> 'SELECT' OR acl.is_grantable))
       OR pg_catalog.pg_get_viewdef('public.listening_public_practice_catalog'::pg_catalog.regclass) ~ 'NOT ([a-z_]+[.])?restricted' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '382 rollback postcondition failed';
    END IF;
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
