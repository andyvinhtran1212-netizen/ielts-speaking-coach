-- Migration 259 — gán phạm vi đề + giao bài trong cùng một transaction
--
-- Trang lớp đã xác định đúng lớp đích. Với Reading/Listening, việc thêm mapping
-- exam_content_cohorts và tạo class_assignment phải thành công hoặc thất bại
-- cùng nhau; hai request riêng để lại mapping mồ côi nếu roster/fan-out lỗi.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_create_scoped_exam_class_assignment(
    p_cohort_id      uuid,
    p_skill          text,
    p_title          text,
    p_scope_kind     text,
    p_lesson_id      uuid        DEFAULT NULL,
    p_content_config jsonb       DEFAULT '{}'::jsonb,
    p_content_id     uuid        DEFAULT NULL,
    p_instructions   text        DEFAULT NULL,
    p_due_at         timestamptz DEFAULT NULL,
    p_publish_at     timestamptz DEFAULT NULL,
    p_status         text        DEFAULT 'published',
    p_assigned_by    uuid        DEFAULT NULL,
    p_kind           text        DEFAULT 'daily',
    p_student_ids    uuid[]      DEFAULT NULL
)
RETURNS TABLE (
    assignment jsonb, student_count integer, unactivated_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_scope_kind NOT IN ('reading', 'listening')
       OR p_skill IS DISTINCT FROM p_scope_kind
       OR p_content_id IS NULL THEN
        RAISE EXCEPTION 'invalid_exam_scope';
    END IF;

    IF p_scope_kind = 'reading' THEN
        PERFORM 1 FROM public.reading_tests
         WHERE id = p_content_id AND status = 'published';
    ELSE
        PERFORM 1 FROM public.listening_tests
         WHERE id = p_content_id AND status = 'published';
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam_content_not_published';
    END IF;

    INSERT INTO public.exam_content_cohorts (
        content_kind, content_id, cohort_id, created_by
    ) VALUES (
        p_scope_kind, p_content_id, p_cohort_id, p_assigned_by
    ) ON CONFLICT (content_kind, content_id, cohort_id) DO NOTHING;

    RETURN QUERY
    SELECT * FROM public.fn_create_class_assignment(
        p_cohort_id      => p_cohort_id,
        p_skill          => p_skill,
        p_title          => p_title,
        p_lesson_id      => p_lesson_id,
        p_content_config => p_content_config,
        p_content_id     => p_content_id,
        p_instructions   => p_instructions,
        p_due_at         => p_due_at,
        p_publish_at     => p_publish_at,
        p_status         => p_status,
        p_assigned_by    => p_assigned_by,
        p_kind           => p_kind,
        p_student_ids    => p_student_ids
    );
END;
$$;

COMMENT ON FUNCTION public.fn_create_scoped_exam_class_assignment(
    uuid, text, text, text, uuid, jsonb, uuid, text, timestamptz,
    timestamptz, text, uuid, text, uuid[]
) IS 'Thêm phạm vi lớp cho đề Reading/Listening rồi tạo bài giao + fan-out trong một transaction (migration 259).';

REVOKE ALL ON FUNCTION public.fn_create_scoped_exam_class_assignment(
    uuid, text, text, text, uuid, jsonb, uuid, text, timestamptz,
    timestamptz, text, uuid, text, uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_scoped_exam_class_assignment(
    uuid, text, text, text, uuid, jsonb, uuid, text, timestamptz,
    timestamptz, text, uuid, text, uuid[]
) TO service_role;

COMMIT;
