-- Migration 270 — create every timed Course session inside the authorization lock.
--
-- The first bank read already anchored the timer transactionally, but later
-- stage/revision starts could fall back to a plain quiz_sessions INSERT after
-- the RPC released its assignment and membership locks.  This revision lets a
-- read adopt without creating, while an explicit session start creates/adopts
-- the requested kind only after rechecking the live timer and retry entitlement.

DROP FUNCTION IF EXISTS public.quiz_start_timed_course_session(
    UUID, UUID, UUID, TEXT
);

CREATE FUNCTION public.quiz_start_timed_course_session(
    p_item_id UUID,
    p_user_id UUID,
    p_bank_id UUID,
    p_code TEXT DEFAULT NULL,
    p_kind TEXT DEFAULT 'run',
    p_create_if_missing BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(session_id UUID, timer_started_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_opened_at TIMESTAMPTZ;
    v_passed_at TIMESTAMPTZ;
    v_mastery JSONB;
    v_attempts JSONB;
    v_latest JSONB;
    v_latest_at TIMESTAMPTZ;
    v_prior_action TEXT;
    v_generation_started_at TIMESTAMPTZ;
    v_config JSONB;
    v_status TEXT;
    v_publish_at TIMESTAMPTZ;
    v_due_at TIMESTAMPTZ;
    v_limit_text TEXT;
    v_limit_minutes INTEGER;
    v_pass_text TEXT;
    v_pass_pct INTEGER;
    v_latest_pct NUMERIC;
    v_now TIMESTAMPTZ;
    v_session_id UUID;
BEGIN
    IF p_kind NOT IN ('run', 'retake') THEN
        RAISE EXCEPTION 'timed_course_session_kind_invalid'
            USING ERRCODE = '22023';
    END IF;

    SELECT cai.opened_at, cai.passed_at, cai.mastery,
           NULLIF(cai.mastery ->> 'section_attempt_started_at', '')::TIMESTAMPTZ,
           ca.content_config, ca.status, ca.publish_at, ca.due_at
      INTO v_opened_at, v_passed_at, v_mastery,
           v_generation_started_at, v_config, v_status, v_publish_at, v_due_at
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

    v_now := clock_timestamp();
    IF v_status <> 'published'
       OR (v_publish_at IS NOT NULL AND v_publish_at > v_now)
       OR (v_due_at IS NOT NULL AND v_due_at <= v_now) THEN
        RAISE EXCEPTION 'timed_course_item_not_accessible'
            USING ERRCODE = '42501';
    END IF;
    IF v_passed_at IS NOT NULL THEN
        RAISE EXCEPTION 'timed_course_item_passed'
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

    IF v_opened_at IS NOT NULL AND LEAST(
        v_opened_at + make_interval(mins => v_limit_minutes),
        COALESCE(v_due_at, 'infinity'::TIMESTAMPTZ)
    ) <= v_now THEN
        RAISE EXCEPTION 'timed_course_assignment_expired'
            USING ERRCODE = '55000';
    END IF;

    v_attempts := COALESCE(v_mastery -> 'attempts', '[]'::JSONB);
    IF jsonb_typeof(v_attempts) <> 'array' THEN
        v_attempts := '[]'::JSONB;
    END IF;
    IF jsonb_array_length(v_attempts) > 0 THEN
        v_latest := v_attempts -> (jsonb_array_length(v_attempts) - 1);
        v_latest_at := NULLIF(v_latest ->> 'at', '')::TIMESTAMPTZ;
        IF COALESCE((v_latest ->> 'completed')::BOOLEAN,
                    v_latest ? 'pct')
           AND v_latest ->> 'pct' IS NOT NULL THEN
            v_prior_action := v_latest ->> 'next_action';
            IF v_prior_action NOT IN ('passed', 'retake', 'retry_full', 'timed_out') THEN
                v_pass_text := v_config ->> 'pass_pct';
                v_pass_pct := CASE
                    WHEN v_pass_text ~ '^[0-9]+$'
                        THEN GREATEST(50, LEAST(100, v_pass_text::INTEGER))
                    ELSE 80
                END;
                v_latest_pct := (v_latest ->> 'pct')::NUMERIC;
                v_prior_action := CASE
                    WHEN v_latest_pct >= v_pass_pct THEN 'passed'
                    WHEN v_latest_pct >= GREATEST(0, v_pass_pct - 10) THEN 'retake'
                    ELSE 'retry_full'
                END;
            END IF;
        END IF;
    END IF;

    IF p_kind = 'retake' AND v_prior_action IS DISTINCT FROM 'retake' THEN
        RAISE EXCEPTION 'timed_course_session_not_entitled'
            USING ERRCODE = '55000';
    END IF;
    IF p_kind = 'run' AND v_prior_action IN ('retake', 'passed', 'timed_out') THEN
        RAISE EXCEPTION 'timed_course_session_not_entitled'
            USING ERRCODE = '55000';
    END IF;
    IF p_kind = 'run' AND v_prior_action = 'retry_full'
       AND v_latest_at IS NOT NULL
       AND (v_generation_started_at IS NULL
            OR v_latest_at > v_generation_started_at) THEN
        v_generation_started_at := v_latest_at;
    END IF;

    IF v_opened_at IS NULL THEN
        IF p_kind <> 'run' THEN
            RAISE EXCEPTION 'timed_course_session_not_entitled'
                USING ERRCODE = '55000';
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
        RETURN;
    END IF;

    SELECT qs.id
      INTO v_session_id
      FROM public.quiz_sessions AS qs
     WHERE qs.class_assignment_item_id = p_item_id
       AND qs.user_id = p_user_id
       AND qs.bank_id = p_bank_id
       AND COALESCE(qs.kind, 'run') = p_kind
       AND qs.ended_at IS NULL
       AND qs.ended_by IS NULL
       AND (
           (p_kind = 'run' AND (
               v_generation_started_at IS NULL
               OR qs.created_at >= v_generation_started_at
           ))
           OR (p_kind = 'retake' AND (
               v_latest_at IS NULL OR qs.created_at > v_latest_at
           ))
       )
     ORDER BY qs.created_at ASC, qs.id ASC
     LIMIT 1
     FOR UPDATE;

    IF v_session_id IS NULL AND p_create_if_missing THEN
        INSERT INTO public.quiz_sessions (
            user_id, bank_id, code, class_assignment_item_id, kind
        ) VALUES (
            p_user_id, p_bank_id, p_code, p_item_id, p_kind
        ) RETURNING id INTO v_session_id;
    END IF;

    RETURN QUERY SELECT v_session_id, v_opened_at;
END;
$$;

REVOKE ALL ON FUNCTION public.quiz_start_timed_course_session(
    UUID, UUID, UUID, TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_start_timed_course_session(
    UUID, UUID, UUID, TEXT, TEXT, BOOLEAN
) TO service_role;

COMMENT ON FUNCTION public.quiz_start_timed_course_session(
    UUID, UUID, UUID, TEXT, TEXT, BOOLEAN
) IS 'Atomically authorizes, creates, or adopts every timed Course run/retake session; service_role only.';

NOTIFY pgrst, 'reload schema';
