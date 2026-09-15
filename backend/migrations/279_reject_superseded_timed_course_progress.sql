-- Migration 279 — reject progress from a timed Course session after another
-- browser has changed the learner's canonical retry entitlement.
--
-- Session creation already checks the latest mastery action under the
-- assignment-item lock.  Progress admission must make the same decision under
-- that lock: otherwise an old full-run tab can keep writing after a near-pass
-- authorizes only a short retake, or after a newer full-retry generation starts.

BEGIN;

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
    v_mastery JSONB;
    v_attempts JSONB;
    v_latest JSONB;
    v_latest_at TIMESTAMPTZ;
    v_prior_action TEXT;
    v_generation_started_at TIMESTAMPTZ;
    v_session_kind TEXT;
    v_session_created_at TIMESTAMPTZ;
    v_status TEXT;
    v_publish_at TIMESTAMPTZ;
    v_due_at TIMESTAMPTZ;
    v_config JSONB;
    v_limit_text TEXT;
    v_limit_minutes INTEGER;
    v_pass_text TEXT;
    v_pass_pct INTEGER;
    v_latest_pct NUMERIC;
    v_accepted_at TIMESTAMPTZ;
BEGIN
    IF jsonb_typeof(COALESCE(p_attempts, '[]'::JSONB)) <> 'array'
       OR jsonb_array_length(COALESCE(p_attempts, '[]'::JSONB)) > 200 THEN
        RAISE EXCEPTION 'timed_course_progress_invalid'
            USING ERRCODE = '22023';
    END IF;

    SELECT qs.bank_id, COALESCE(qs.kind, 'run'), qs.created_at,
           cai.opened_at, cai.passed_at, cai.mastery,
           NULLIF(cai.mastery ->> 'section_attempt_started_at', '')::TIMESTAMPTZ,
           ca.status, ca.publish_at, ca.due_at, ca.content_config
      INTO v_bank_id, v_session_kind, v_session_created_at,
           v_opened_at, v_passed_at, v_mastery, v_generation_started_at,
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

    v_attempts := COALESCE(v_mastery -> 'attempts', '[]'::JSONB);
    IF jsonb_typeof(v_attempts) <> 'array' THEN
        v_attempts := '[]'::JSONB;
    END IF;
    IF jsonb_array_length(v_attempts) > 0 THEN
        v_latest := v_attempts -> (jsonb_array_length(v_attempts) - 1);
        v_latest_at := NULLIF(v_latest ->> 'at', '')::TIMESTAMPTZ;
        IF COALESCE((v_latest ->> 'completed')::BOOLEAN, v_latest ? 'pct')
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

    IF v_session_kind NOT IN ('run', 'retake')
       OR (v_session_kind = 'retake' AND (
            v_prior_action IS DISTINCT FROM 'retake'
            OR v_latest_at IS NULL
            OR v_session_created_at <= v_latest_at
       ))
       OR (v_session_kind = 'run' AND (
            v_prior_action IN ('retake', 'passed', 'timed_out')
            OR (v_prior_action = 'retry_full' AND (
                v_latest_at IS NULL
                OR v_session_created_at < v_latest_at
                OR (v_generation_started_at IS NOT NULL
                    AND v_session_created_at < v_generation_started_at)
            ))
       )) THEN
        RAISE EXCEPTION 'timed_course_progress_not_entitled'
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

COMMENT ON FUNCTION public.quiz_insert_timed_course_attempts(UUID, UUID, JSONB) IS
'Atomically admits only the current entitled timed Course generation and stamps
answers with the same server-side cutoff timestamp; service_role only.';

REVOKE ALL ON FUNCTION public.quiz_insert_timed_course_attempts(UUID, UUID, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_insert_timed_course_attempts(UUID, UUID, JSONB)
    TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
