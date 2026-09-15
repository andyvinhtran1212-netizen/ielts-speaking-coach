-- Migration 275 — make terminal timeout retries truthful under a reaper race.
--
-- Migration 274 bounded delivery to 15 seconds, but its terminal-session fast
-- path returned success without proving that a submitted retry batch had been
-- persisted. If the reaper acquired the session lock first, the browser could
-- therefore clear answers that never reached quiz_attempts. Keep the atomic
-- lock and reject that terminal response unless every submitted client_id is
-- already canonical for this session.

CREATE OR REPLACE FUNCTION public.quiz_finalize_timed_course_session(
    p_session_id UUID,
    p_user_id UUID,
    p_attempts JSONB DEFAULT '[]'::JSONB,
    p_summary JSONB DEFAULT '{}'::JSONB
)
RETURNS SETOF public.quiz_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session public.quiz_sessions%ROWTYPE;
    v_opened_at TIMESTAMPTZ;
    v_due_at TIMESTAMPTZ;
    v_config JSONB;
    v_limit_text TEXT;
    v_limit_minutes INTEGER;
    v_cutoff TIMESTAMPTZ;
    v_now TIMESTAMPTZ;
BEGIN
    IF jsonb_typeof(COALESCE(p_attempts, '[]'::JSONB)) <> 'array'
       OR jsonb_array_length(COALESCE(p_attempts, '[]'::JSONB)) > 200
       OR jsonb_typeof(COALESCE(p_summary, '{}'::JSONB)) <> 'object' THEN
        RAISE EXCEPTION 'timed_course_finalize_invalid'
            USING ERRCODE = '22023';
    END IF;

    SELECT qs.*
      INTO v_session
      FROM public.quiz_sessions AS qs
     WHERE qs.id = p_session_id
       AND qs.user_id = p_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'timed_course_finalize_not_accessible'
            USING ERRCODE = '42501';
    END IF;
    IF v_session.ended_at IS NOT NULL OR v_session.ended_by IS NOT NULL THEN
        IF EXISTS (
            SELECT 1
              FROM jsonb_to_recordset(
                       COALESCE(p_attempts, '[]'::JSONB)
                   ) AS submitted(client_id UUID)
             WHERE submitted.client_id IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1
                     FROM public.quiz_attempts AS stored
                    WHERE stored.session_id = p_session_id
                      AND stored.user_id = p_user_id
                      AND stored.client_id = submitted.client_id
               )
        ) THEN
            RAISE EXCEPTION 'timed_course_final_batch_missing'
                USING ERRCODE = '55000';
        END IF;
        RETURN NEXT v_session;
        RETURN;
    END IF;

    SELECT cai.opened_at, ca.due_at, ca.content_config
      INTO v_opened_at, v_due_at, v_config
      FROM public.class_assignment_items AS cai
      JOIN public.class_assignments AS ca ON ca.id = cai.assignment_id
     WHERE cai.id = v_session.class_assignment_item_id
       AND ca.skill = 'course'
       AND ca.content_id = v_session.bank_id
     FOR UPDATE OF cai, ca;

    IF NOT FOUND OR v_opened_at IS NULL THEN
        RAISE EXCEPTION 'timed_course_finalize_not_accessible'
            USING ERRCODE = '42501';
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

    v_cutoff := LEAST(
        v_opened_at + make_interval(mins => v_limit_minutes),
        COALESCE(v_due_at, 'infinity'::TIMESTAMPTZ)
    );
    v_now := clock_timestamp();
    IF v_cutoff > v_now THEN
        RAISE EXCEPTION 'timed_course_finalize_not_expired'
            USING ERRCODE = '55000';
    END IF;
    IF jsonb_array_length(COALESCE(p_attempts, '[]'::JSONB)) > 0
       AND v_now > v_cutoff + interval '15 seconds' THEN
        RAISE EXCEPTION 'timed_course_final_batch_expired'
            USING ERRCODE = '55000';
    END IF;

    INSERT INTO public.quiz_attempts (
        user_id, session_id, bank_id, client_id, item_key, qid, skill,
        type, subtype, is_correct, answer_given, response_time_ms,
        attempt_no, created_at
    )
    SELECT p_user_id, p_session_id, v_session.bank_id, x.client_id,
           x.item_key, x.qid, x.skill, x.type, x.subtype, x.is_correct,
           x.answer_given, x.response_time_ms, x.attempt_no, v_cutoff
      FROM jsonb_to_recordset(COALESCE(p_attempts, '[]'::JSONB)) AS x(
          client_id UUID, item_key TEXT, qid TEXT, skill TEXT, type TEXT,
          subtype TEXT, is_correct BOOLEAN, answer_given TEXT,
          response_time_ms INTEGER, attempt_no INTEGER
      )
     WHERE x.client_id IS NOT NULL
       AND x.item_key IS NOT NULL
       AND x.is_correct IS NOT NULL
    ON CONFLICT (client_id) DO NOTHING;

    UPDATE public.quiz_sessions
       SET ended_at = v_cutoff,
           ended_by = 'time_cap',
           duration_sec = GREATEST(0, COALESCE((p_summary ->> 'duration_sec')::INTEGER, 0)),
           total_questions = GREATEST(0, COALESCE((p_summary ->> 'total_questions')::INTEGER, 0)),
           total_correct = GREATEST(0, COALESCE((p_summary ->> 'total_correct')::INTEGER, 0)),
           total_wrong = GREATEST(0, COALESCE((p_summary ->> 'total_wrong')::INTEGER, 0)),
           accuracy = CASE
               WHEN COALESCE((p_summary ->> 'total_questions')::INTEGER, 0) > 0
               THEN GREATEST(0, COALESCE((p_summary ->> 'total_correct')::NUMERIC, 0))
                    / (p_summary ->> 'total_questions')::NUMERIC
               ELSE NULL
           END
     WHERE id = p_session_id
     RETURNING * INTO v_session;

    RETURN NEXT v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.quiz_finalize_timed_course_session(
    UUID, UUID, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_finalize_timed_course_session(
    UUID, UUID, JSONB, JSONB
) TO service_role;

COMMENT ON FUNCTION public.quiz_finalize_timed_course_session(
    UUID, UUID, JSONB, JSONB
) IS 'Atomically stores a final batch within the 15-second cutoff grace; terminal retries succeed only when every submitted client_id is already stored.';

NOTIFY pgrst, 'reload schema';
