-- Migration 265 — close the remaining timed Course boundary races.
--
-- 1. Every concurrent first bank read must receive the same open run session;
--    otherwise a stale browser creates a second session and the empty timer
--    anchor is later graded as a spurious timeout.
-- 2. Progress admission and its `created_at` evidence use one transaction and
--    one server timestamp.  A write admitted before the cutoff must not commit
--    afterward with a timestamp that makes the verdict discard it.

CREATE OR REPLACE FUNCTION public.quiz_start_timed_course_session(
    p_item_id UUID,
    p_user_id UUID,
    p_bank_id UUID,
    p_code TEXT DEFAULT NULL
)
RETURNS TABLE(session_id UUID, timer_started_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
        -- The assignment row lock serializes concurrent first reads.  The
        -- loser can therefore adopt the exact open session inserted by the
        -- winner instead of creating another one outside this transaction.
        SELECT qs.id
          INTO v_session_id
          FROM public.quiz_sessions AS qs
         WHERE qs.class_assignment_item_id = p_item_id
           AND qs.user_id = p_user_id
           AND qs.bank_id = p_bank_id
           AND COALESCE(qs.kind, 'run') = 'run'
           AND qs.ended_at IS NULL
           AND qs.ended_by IS NULL
         ORDER BY qs.created_at ASC, qs.id ASC
         LIMIT 1
         FOR UPDATE;
        RETURN QUERY SELECT v_session_id, v_opened_at;
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


CREATE OR REPLACE FUNCTION public.quiz_insert_timed_course_attempts(
    p_session_id UUID,
    p_user_id UUID,
    p_attempts JSONB
)
RETURNS SETOF public.quiz_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bank_id UUID;
    v_opened_at TIMESTAMPTZ;
    v_passed_at TIMESTAMPTZ;
    v_status TEXT;
    v_publish_at TIMESTAMPTZ;
    v_due_at TIMESTAMPTZ;
    v_config JSONB;
    v_limit_text TEXT;
    v_limit_minutes INTEGER;
    v_accepted_at TIMESTAMPTZ;
BEGIN
    IF jsonb_typeof(COALESCE(p_attempts, '[]'::JSONB)) <> 'array'
       OR jsonb_array_length(COALESCE(p_attempts, '[]'::JSONB)) > 200 THEN
        RAISE EXCEPTION 'timed_course_progress_invalid'
            USING ERRCODE = '22023';
    END IF;

    SELECT qs.bank_id, cai.opened_at, cai.passed_at,
           ca.status, ca.publish_at, ca.due_at, ca.content_config
      INTO v_bank_id, v_opened_at, v_passed_at,
           v_status, v_publish_at, v_due_at, v_config
      FROM public.quiz_sessions AS qs
      JOIN public.class_assignment_items AS cai
        ON cai.id = qs.class_assignment_item_id
      JOIN public.class_assignments AS ca ON ca.id = cai.assignment_id
      JOIN public.students AS s ON s.id = cai.student_id
      JOIN public.student_cohort_memberships AS scm
        ON scm.student_id = s.id
       AND scm.cohort_id = ca.cohort_id
       AND scm.is_active = TRUE
      JOIN public.quiz_banks AS qb ON qb.id = ca.content_id
     WHERE qs.id = p_session_id
       AND qs.user_id = p_user_id
       AND qs.ended_at IS NULL
       AND qs.ended_by IS NULL
       AND s.user_id = p_user_id
       AND ca.content_id = qs.bank_id
       AND ca.skill = 'course'
       AND qb.skill_area = 'course'
     FOR UPDATE OF qs, cai, ca, scm;

    IF NOT FOUND OR v_opened_at IS NULL OR v_passed_at IS NOT NULL THEN
        RAISE EXCEPTION 'timed_course_progress_not_writable'
            USING ERRCODE = '55000';
    END IF;

    -- This timestamp is both the admission decision and the persisted evidence.
    -- A slow INSERT can commit after the cutoff without turning an on-time
    -- accepted answer into a late one.
    v_accepted_at := clock_timestamp();
    IF v_status <> 'published'
       OR (v_publish_at IS NOT NULL AND v_publish_at > v_accepted_at)
       OR (v_due_at IS NOT NULL AND v_due_at <= v_accepted_at) THEN
        RAISE EXCEPTION 'timed_course_progress_not_writable'
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
    IF LEAST(
        v_opened_at + make_interval(mins => v_limit_minutes),
        COALESCE(v_due_at, 'infinity'::TIMESTAMPTZ)
    ) <= v_accepted_at THEN
        RAISE EXCEPTION 'timed_course_progress_expired'
            USING ERRCODE = '55000';
    END IF;

    RETURN QUERY
    INSERT INTO public.quiz_attempts (
        user_id, session_id, bank_id, client_id, item_key, qid, skill,
        type, subtype, is_correct, answer_given, response_time_ms,
        attempt_no, created_at
    )
    SELECT p_user_id, p_session_id, v_bank_id, x.client_id, x.item_key,
           x.qid, x.skill, x.type, x.subtype, x.is_correct, x.answer_given,
           x.response_time_ms, x.attempt_no, v_accepted_at
      FROM jsonb_to_recordset(COALESCE(p_attempts, '[]'::JSONB)) AS x(
          client_id UUID, item_key TEXT, qid TEXT, skill TEXT, type TEXT,
          subtype TEXT, is_correct BOOLEAN, answer_given TEXT,
          response_time_ms INTEGER, attempt_no INTEGER
      )
     WHERE x.item_key IS NOT NULL AND x.is_correct IS NOT NULL
    ON CONFLICT (client_id) DO NOTHING
    RETURNING quiz_attempts.*;
END;
$$;

REVOKE ALL ON FUNCTION public.quiz_insert_timed_course_attempts(UUID, UUID, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_insert_timed_course_attempts(UUID, UUID, JSONB)
    TO service_role;

COMMENT ON FUNCTION public.quiz_start_timed_course_session(UUID, UUID, UUID, TEXT) IS
'Atomically authorizes a timed Course start and returns its canonical open run session.';
COMMENT ON FUNCTION public.quiz_insert_timed_course_attempts(UUID, UUID, JSONB) IS
'Atomically admits timed Course answers and stamps them with the same server-side cutoff timestamp; service_role only.';
