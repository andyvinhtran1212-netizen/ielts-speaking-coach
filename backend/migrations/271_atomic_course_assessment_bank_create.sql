-- Migration 271 — create a Course assessment bank and its questions atomically.
--
-- Existing-bank replacement is transactional since migration 267.  The new
-- bank path must have the same no-half-update guarantee: if validation or the
-- question write fails, PostgreSQL rolls the bank INSERT back with the RPC.

CREATE OR REPLACE FUNCTION public.quiz_create_course_assessment_bank(
    p_payload JSONB,
    p_rows JSONB
)
RETURNS TABLE(bank_id UUID, written INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bank_id UUID;
    v_written INTEGER;
BEGIN
    -- The replacement RPC is the canonical strict validator for this payload
    -- and row count.  Any exception it raises rolls this preceding INSERT back
    -- in the same function transaction.
    INSERT INTO public.quiz_banks (
        code, title, skill_area, course_id, lesson_no, words_count,
        source, is_published, meta
    ) VALUES (
        p_payload ->> 'code',
        p_payload ->> 'title',
        'course',
        (p_payload ->> 'course_id')::UUID,
        NULLIF(p_payload ->> 'lesson_no', '')::INTEGER,
        (p_payload ->> 'words_count')::INTEGER,
        p_payload ->> 'source',
        FALSE,
        p_payload -> 'meta'
    ) RETURNING id INTO v_bank_id;

    v_written := public.quiz_replace_course_assessment_bank(
        v_bank_id, p_payload, p_rows
    );
    RETURN QUERY SELECT v_bank_id, v_written;
END;
$$;

REVOKE ALL ON FUNCTION public.quiz_create_course_assessment_bank(JSONB, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_create_course_assessment_bank(JSONB, JSONB)
    TO service_role;

COMMENT ON FUNCTION public.quiz_create_course_assessment_bank(JSONB, JSONB) IS
'Atomically creates one private Course assessment bank and all validated questions; service_role only.';

NOTIFY pgrst, 'reload schema';
