-- Migration 263 — atomically anchor a timed Course assessment and its first session.
--
-- The Course player receives answer-bearing questions.  Its first read must
-- therefore start the canonical clock before those questions are released.
-- Updating class_assignment_items.opened_at and inserting quiz_sessions in two
-- HTTP operations can strand a learner if only the first write succeeds.  This
-- function makes the two writes one transaction and re-checks ownership at the
-- database boundary even though the backend calls it with the service role.

CREATE OR REPLACE FUNCTION public.quiz_start_timed_course_session(
    p_item_id UUID,
    p_user_id UUID,
    p_bank_id UUID,
    p_code TEXT DEFAULT NULL
)
RETURNS TABLE(session_id UUID, timer_started_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_opened_at TIMESTAMPTZ;
    v_submitted_at TIMESTAMPTZ;
    v_config JSONB;
    v_due_at TIMESTAMPTZ;
    v_limit_text TEXT;
    v_limit_minutes INTEGER;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_session_id UUID;
BEGIN
    SELECT cai.opened_at, cai.submitted_at, ca.content_config, ca.due_at
      INTO v_opened_at, v_submitted_at, v_config, v_due_at
      FROM public.class_assignment_items AS cai
      JOIN public.class_assignments AS ca ON ca.id = cai.assignment_id
      JOIN public.students AS s ON s.id = cai.student_id
      JOIN public.quiz_banks AS qb ON qb.id = ca.content_id
     WHERE cai.id = p_item_id
       AND s.user_id = p_user_id
       AND ca.content_id = p_bank_id
       AND ca.skill = 'course'
       AND qb.skill_area = 'course'
     FOR UPDATE OF cai;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'timed_course_item_not_owned'
            USING ERRCODE = '42501';
    END IF;
    IF v_submitted_at IS NOT NULL THEN
        RAISE EXCEPTION 'timed_course_item_submitted'
            USING ERRCODE = '55000';
    END IF;
    IF v_due_at IS NOT NULL AND v_due_at <= v_now THEN
        RAISE EXCEPTION 'timed_course_assignment_expired'
            USING ERRCODE = '55000';
    END IF;

    v_limit_text := v_config ->> 'time_limit_minutes';
    IF v_limit_text IS NULL OR v_limit_text !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'timed_course_limit_invalid'
            USING ERRCODE = '22023';
    END IF;
    v_limit_minutes := v_limit_text::INTEGER;
    IF v_limit_minutes < 1 OR v_limit_minutes > 720 THEN
        RAISE EXCEPTION 'timed_course_limit_invalid'
            USING ERRCODE = '22023';
    END IF;

    -- Another request already won the row lock and created the first session.
    -- Returning NULL is intentional: callers may reuse the winner discovered by
    -- course-resume, while a direct session-start request may create its next
    -- ordinary stage session after checking that the clock is still live.
    IF v_opened_at IS NOT NULL THEN
        IF LEAST(
            v_opened_at + make_interval(mins => v_limit_minutes),
            COALESCE(v_due_at, 'infinity'::TIMESTAMPTZ)
        ) <= v_now THEN
            RAISE EXCEPTION 'timed_course_assignment_expired'
                USING ERRCODE = '55000';
        END IF;
        RETURN QUERY SELECT NULL::UUID, v_opened_at;
        RETURN;
    END IF;

    INSERT INTO public.quiz_sessions (
        user_id, bank_id, code, class_assignment_item_id, kind
    ) VALUES (
        p_user_id, p_bank_id, p_code, p_item_id, 'run'
    ) RETURNING id INTO v_session_id;

    UPDATE public.class_assignment_items
       SET opened_at = v_now,
           state = CASE WHEN state = 'assigned' THEN 'opened' ELSE state END,
           updated_at = v_now
     WHERE id = p_item_id;

    RETURN QUERY SELECT v_session_id, v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.quiz_start_timed_course_session(UUID, UUID, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_start_timed_course_session(UUID, UUID, UUID, TEXT)
    TO service_role;

COMMENT ON FUNCTION public.quiz_start_timed_course_session(UUID, UUID, UUID, TEXT) IS
'Atomically anchors a timed Course assignment and inserts its first quiz session before answer-bearing questions are released.';
