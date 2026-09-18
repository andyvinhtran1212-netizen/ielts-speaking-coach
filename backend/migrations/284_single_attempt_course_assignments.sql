-- Migration 284 — database guard for one-sitting Course assignments.
--
-- The application still opens one quiz session per stage, so the durable
-- boundary is the terminal assignment ledger, not the first session row.
-- Once a single-attempt assignment is submitted or records its canonical
-- `completed` verdict, neither a new session nor a late answer may be inserted
-- through a stale/internal write path.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_single_attempt_course_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_mode TEXT;
    v_submitted_at TIMESTAMPTZ;
    v_mastery JSONB;
    v_attempts JSONB;
    v_latest JSONB;
BEGIN
    IF NEW.class_assignment_item_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT ca.content_config ->> 'completion_mode', cai.submitted_at, cai.mastery
      INTO v_mode, v_submitted_at, v_mastery
      FROM public.class_assignment_items AS cai
      JOIN public.class_assignments AS ca ON ca.id = cai.assignment_id
     WHERE cai.id = NEW.class_assignment_item_id
       AND ca.skill = 'course'
     FOR UPDATE OF cai, ca;

    IF NOT FOUND OR v_mode IS DISTINCT FROM 'single_attempt' THEN
        RETURN NEW;
    END IF;
    IF COALESCE(NEW.kind, 'run') <> 'run' THEN
        RAISE EXCEPTION 'single_attempt_course_retake_forbidden'
            USING ERRCODE = '55000';
    END IF;

    v_attempts := COALESCE(v_mastery -> 'attempts', '[]'::JSONB);
    IF jsonb_typeof(v_attempts) = 'array' AND jsonb_array_length(v_attempts) > 0 THEN
        v_latest := v_attempts -> (jsonb_array_length(v_attempts) - 1);
    END IF;
    IF v_submitted_at IS NOT NULL
       OR v_latest ->> 'next_action' = 'completed' THEN
        RAISE EXCEPTION 'single_attempt_course_session_closed'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_single_attempt_course_session
    ON public.quiz_sessions;
CREATE TRIGGER guard_single_attempt_course_session
BEFORE INSERT ON public.quiz_sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_single_attempt_course_session();

CREATE OR REPLACE FUNCTION public.guard_single_attempt_course_answer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_mode TEXT;
    v_submitted_at TIMESTAMPTZ;
    v_mastery JSONB;
    v_attempts JSONB;
    v_latest JSONB;
BEGIN
    SELECT ca.content_config ->> 'completion_mode', cai.submitted_at, cai.mastery
      INTO v_mode, v_submitted_at, v_mastery
      FROM public.quiz_sessions AS qs
      JOIN public.class_assignment_items AS cai
        ON cai.id = qs.class_assignment_item_id
      JOIN public.class_assignments AS ca ON ca.id = cai.assignment_id
     WHERE qs.id = NEW.session_id
       AND ca.skill = 'course'
     FOR UPDATE OF cai, ca;

    IF NOT FOUND OR v_mode IS DISTINCT FROM 'single_attempt' THEN
        RETURN NEW;
    END IF;
    v_attempts := COALESCE(v_mastery -> 'attempts', '[]'::JSONB);
    IF jsonb_typeof(v_attempts) = 'array' AND jsonb_array_length(v_attempts) > 0 THEN
        v_latest := v_attempts -> (jsonb_array_length(v_attempts) - 1);
    END IF;
    IF v_submitted_at IS NOT NULL
       OR v_latest ->> 'next_action' = 'completed' THEN
        RAISE EXCEPTION 'single_attempt_course_answer_closed'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_single_attempt_course_answer
    ON public.quiz_attempts;
CREATE TRIGGER guard_single_attempt_course_answer
BEFORE INSERT ON public.quiz_attempts
FOR EACH ROW EXECUTE FUNCTION public.guard_single_attempt_course_answer();

REVOKE ALL ON FUNCTION public.guard_single_attempt_course_session() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_single_attempt_course_answer() FROM PUBLIC;

COMMENT ON FUNCTION public.guard_single_attempt_course_session() IS
'Prevents retakes and post-verdict sessions for single-attempt Course assignments.';
COMMENT ON FUNCTION public.guard_single_attempt_course_answer() IS
'Prevents late answer insertion after a single-attempt Course assignment is terminal.';

COMMIT;
