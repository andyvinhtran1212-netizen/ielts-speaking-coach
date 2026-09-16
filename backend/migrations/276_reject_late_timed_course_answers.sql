-- Migration 276 — reject every new answer after a timed Course cutoff.
--
-- The prior 15-second final-batch lane stamped newly supplied rows at the
-- cutoff, but a client cannot prove that an answer was actually chosen before
-- expiry.  Timeout finalization is now verification-only: eager progress must
-- already have admitted every submitted client_id while the timer was open.
-- Session totals are derived from that canonical ledger, never from the client.

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
    v_total INTEGER;
    v_correct INTEGER;
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

    -- The session lock serializes this proof with both the timeout reaper and
    -- every other finalizer.  A retry may repeat already-canonical IDs, but it
    -- can never use this endpoint to create a new answer row.
    IF EXISTS (
        SELECT 1
          FROM jsonb_to_recordset(
                   COALESCE(p_attempts, '[]'::JSONB)
               ) AS submitted(client_id UUID)
         WHERE submitted.client_id IS NULL
            OR NOT EXISTS (
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

    IF v_session.ended_at IS NOT NULL OR v_session.ended_by IS NOT NULL THEN
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

    SELECT COUNT(*)::INTEGER,
           COUNT(*) FILTER (WHERE qa.is_correct)::INTEGER
      INTO v_total, v_correct
      FROM public.quiz_attempts AS qa
     WHERE qa.session_id = p_session_id
       AND qa.user_id = p_user_id;

    UPDATE public.quiz_sessions
       SET ended_at = v_cutoff,
           ended_by = 'time_cap',
           duration_sec = GREATEST(
               0, FLOOR(EXTRACT(EPOCH FROM (v_cutoff - v_opened_at)))::INTEGER
           ),
           total_questions = v_total,
           total_correct = v_correct,
           total_wrong = v_total - v_correct,
           accuracy = CASE
               WHEN v_total > 0 THEN v_correct::NUMERIC / v_total
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
) IS 'Verifies every timeout client_id was admitted before cutoff and derives the immutable score from canonical attempts; service_role only.';

NOTIFY pgrst, 'reload schema';
