-- Migration 277 — stop reaping a settled on-time Course failure forever.
--
-- A failed timed attempt may finish on time with a retake/retry_full outcome.
-- Once its clock expires without a new generation, passed_at intentionally
-- remains NULL and the minute reaper otherwise scans its entire session
-- history forever. The proof and marker must share the item lock with timed
-- session creation; a Python scan followed by a write could hide a retake that
-- was committing concurrently.

CREATE OR REPLACE FUNCTION public.quiz_close_expired_course_retry(
    p_item_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_opened_at TIMESTAMPTZ;
    v_submitted_at TIMESTAMPTZ;
    v_mastery JSONB;
    v_attempts JSONB;
    v_latest JSONB;
    v_latest_at TIMESTAMPTZ;
    v_action TEXT;
    v_section_started_at TIMESTAMPTZ;
    v_config JSONB;
    v_due_at TIMESTAMPTZ;
    v_limit_text TEXT;
    v_limit_minutes INTEGER;
    v_cutoff TIMESTAMPTZ;
BEGIN
    SELECT cai.opened_at, cai.submitted_at, COALESCE(cai.mastery, '{}'::JSONB),
           ca.content_config, ca.due_at
      INTO v_opened_at, v_submitted_at, v_mastery, v_config, v_due_at
      FROM public.class_assignment_items AS cai
      JOIN public.class_assignments AS ca ON ca.id = cai.assignment_id
      JOIN public.quiz_banks AS qb ON qb.id = ca.content_id
     WHERE cai.id = p_item_id
       AND ca.skill = 'course'
       AND qb.skill_area = 'course'
     FOR UPDATE OF cai;

    IF NOT FOUND OR v_opened_at IS NULL OR v_submitted_at IS NULL THEN
        RETURN FALSE;
    END IF;
    IF v_mastery ? 'timed_retry_closed_at' THEN
        RETURN TRUE;
    END IF;

    v_limit_text := v_config ->> 'time_limit_minutes';
    IF v_limit_text IS NULL OR v_limit_text !~ '^[0-9]+$' THEN
        RETURN FALSE;
    END IF;
    v_limit_minutes := v_limit_text::INTEGER;
    IF v_limit_minutes < 1 OR v_limit_minutes > 720 THEN
        RETURN FALSE;
    END IF;
    v_cutoff := LEAST(
        v_opened_at + make_interval(mins => v_limit_minutes),
        COALESCE(v_due_at, 'infinity'::TIMESTAMPTZ)
    );
    IF v_cutoff > clock_timestamp() THEN
        RETURN FALSE;
    END IF;

    v_attempts := COALESCE(v_mastery -> 'attempts', '[]'::JSONB);
    IF jsonb_typeof(v_attempts) <> 'array'
       OR jsonb_array_length(v_attempts) = 0 THEN
        RETURN FALSE;
    END IF;
    v_latest := v_attempts -> (jsonb_array_length(v_attempts) - 1);
    v_action := v_latest ->> 'next_action';
    v_latest_at := NULLIF(v_latest ->> 'at', '')::TIMESTAMPTZ;
    IF v_action NOT IN ('retake', 'retry_full') OR v_latest_at IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Full-course retries persist their generation boundary before any
    -- section starts. Retakes are quiz-only, so their locked session row is
    -- the generation marker. The item lock serializes both checks with
    -- quiz_start_timed_course_session.
    v_section_started_at := NULLIF(
        v_mastery ->> 'section_attempt_started_at', ''
    )::TIMESTAMPTZ;
    IF v_action = 'retry_full'
       AND COALESCE(v_mastery ->> 'section_attempt_pending', 'false') = 'true'
       AND v_section_started_at IS NOT NULL
       AND v_section_started_at > v_latest_at THEN
        RETURN FALSE;
    END IF;
    IF EXISTS (
        SELECT 1
          FROM public.quiz_sessions AS qs
         WHERE qs.class_assignment_item_id = p_item_id
           AND qs.created_at > v_latest_at
           AND (
               (v_action = 'retake' AND COALESCE(qs.kind, 'run') = 'retake')
               OR (v_action = 'retry_full' AND COALESCE(qs.kind, 'run') = 'run')
           )
    ) THEN
        RETURN FALSE;
    END IF;

    UPDATE public.class_assignment_items
       SET mastery = jsonb_set(
               v_mastery, '{timed_retry_closed_at}', to_jsonb(v_cutoff), TRUE
           ),
           updated_at = clock_timestamp()
     WHERE id = p_item_id;
    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.quiz_close_expired_course_retry(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_close_expired_course_retry(UUID)
    TO service_role;

NOTIFY pgrst, 'reload schema';
