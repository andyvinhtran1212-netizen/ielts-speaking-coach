-- Migration 264 — recheck Course access inside the atomic timed-start RPC.
--
-- Migration 263 made timer anchoring and first-session creation atomic, but
-- the transaction still trusted the backend's earlier access check.  Archive,
-- due-date and membership updates can race that check.  Lock the assignment
-- and canonical membership row together with the item, and require all live
-- access predicates at the transaction's linearization point.

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
    v_status TEXT;
    v_publish_at TIMESTAMPTZ;
    v_due_at TIMESTAMPTZ;
    v_limit_text TEXT;
    v_limit_minutes INTEGER;
    v_now TIMESTAMPTZ;
    v_session_id UUID;
BEGIN
    SELECT cai.opened_at, cai.submitted_at, ca.content_config,
           ca.status, ca.publish_at, ca.due_at
      INTO v_opened_at, v_submitted_at, v_config,
           v_status, v_publish_at, v_due_at
      FROM public.class_assignment_items AS cai
      JOIN public.class_assignments AS ca ON ca.id = cai.assignment_id
      JOIN public.students AS s ON s.id = cai.student_id
      JOIN public.student_cohort_memberships AS scm
        ON scm.student_id = s.id
       AND scm.cohort_id = ca.cohort_id
       AND scm.is_active = TRUE
      JOIN public.quiz_banks AS qb ON qb.id = ca.content_id
     WHERE cai.id = p_item_id
       AND s.user_id = p_user_id
       AND ca.content_id = p_bank_id
       AND ca.skill = 'course'
       AND qb.skill_area = 'course'
     FOR UPDATE OF cai, ca, scm;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'timed_course_item_not_accessible'
            USING ERRCODE = '42501';
    END IF;
    -- Take the clock after all row locks are held.  A request that waited on an
    -- admin update must not compare the deadline with a stale pre-wait time.
    v_now := clock_timestamp();
    IF v_status <> 'published'
       OR (v_publish_at IS NOT NULL AND v_publish_at > v_now)
       OR (v_due_at IS NOT NULL AND v_due_at <= v_now) THEN
        RAISE EXCEPTION 'timed_course_item_not_accessible'
            USING ERRCODE = '42501';
    END IF;
    IF v_submitted_at IS NOT NULL THEN
        RAISE EXCEPTION 'timed_course_item_submitted'
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
'Atomically authorizes and anchors a timed Course assignment before answer-bearing questions are released.';
