-- Migration 268 — never replace an assessment bank already bound to history.
--
-- A live assignment/session is graded against quiz_questions. Replacing those
-- rows in place would make old evidence use a new answer key.  The bank row
-- lock also serializes foreign-key inserts, so an assignment/session cannot
-- appear between this check and the replacement.

CREATE OR REPLACE FUNCTION public.quiz_replace_course_assessment_bank(
    p_bank_id UUID,
    p_payload JSONB,
    p_rows JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_written INTEGER;
    v_existing_skill TEXT;
    v_words_count INTEGER;
BEGIN
    IF jsonb_typeof(p_payload) <> 'object'
       OR jsonb_typeof(p_rows) <> 'array'
       OR jsonb_typeof(p_payload -> 'meta') <> 'object'
       OR NULLIF(p_payload ->> 'code', '') IS NULL
       OR NULLIF(p_payload ->> 'course_id', '') IS NULL
       OR p_payload ->> 'skill_area' <> 'course'
       OR (p_payload ->> 'is_published')::BOOLEAN IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'course_assessment_bank_payload_invalid'
            USING ERRCODE = '22023';
    END IF;

    BEGIN
        v_words_count := (p_payload ->> 'words_count')::INTEGER;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'course_assessment_bank_payload_invalid'
            USING ERRCODE = '22023';
    END;
    IF v_words_count < 1 OR jsonb_array_length(p_rows) <> v_words_count THEN
        RAISE EXCEPTION 'course_assessment_bank_count_mismatch'
            USING ERRCODE = '22023';
    END IF;

    SELECT qb.skill_area
      INTO v_existing_skill
      FROM public.quiz_banks AS qb
     WHERE qb.id = p_bank_id
     FOR UPDATE;
    IF NOT FOUND OR v_existing_skill <> 'course' THEN
        RAISE EXCEPTION 'course_assessment_bank_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.class_assignments AS ca
         WHERE ca.content_id = p_bank_id
    ) OR EXISTS (
        SELECT 1 FROM public.quiz_sessions AS qs
         WHERE qs.bank_id = p_bank_id
    ) THEN
        RAISE EXCEPTION 'course_assessment_bank_in_use'
            USING ERRCODE = '55000';
    END IF;

    v_written := public.quiz_replace_questions(p_bank_id, p_rows);

    UPDATE public.quiz_banks
       SET code = p_payload ->> 'code',
           title = p_payload ->> 'title',
           skill_area = 'course',
           course_id = (p_payload ->> 'course_id')::UUID,
           lesson_no = NULLIF(p_payload ->> 'lesson_no', '')::INTEGER,
           words_count = v_words_count,
           source = p_payload ->> 'source',
           is_published = FALSE,
           meta = p_payload -> 'meta'
     WHERE id = p_bank_id;

    RETURN v_written;
END;
$$;

REVOKE ALL ON FUNCTION public.quiz_replace_course_assessment_bank(UUID, JSONB, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_replace_course_assessment_bank(UUID, JSONB, JSONB)
    TO service_role;

COMMENT ON FUNCTION public.quiz_replace_course_assessment_bank(UUID, JSONB, JSONB) IS
'Atomically replaces an unused private Course assessment bank; assigned/session-bound banks are immutable; service_role only.';
