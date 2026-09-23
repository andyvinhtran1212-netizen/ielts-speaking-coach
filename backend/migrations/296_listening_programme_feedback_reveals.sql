-- LISTENING-0006: immutable evidence for per-question assisted review.
-- The first revealed answer is distinct from the mutable answer draft. A row
-- exists only after a saved, nonblank answer and a valid programme question
-- have been checked under the attempt row lock.

BEGIN;

CREATE TABLE IF NOT EXISTS public.listening_programme_feedback_reveals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.listening_test_attempts(id)
        ON DELETE CASCADE,
    q_num INTEGER NOT NULL CHECK (q_num > 0),
    first_answer TEXT NOT NULL CHECK (BTRIM(first_answer) <> ''),
    revealed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT listening_programme_feedback_reveals_attempt_question_key
        UNIQUE (attempt_id, q_num)
);

ALTER TABLE public.listening_programme_feedback_reveals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listening_programme_feedback_reveals
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.listening_programme_feedback_reveals TO service_role;

CREATE OR REPLACE FUNCTION public.fn_guard_listening_programme_feedback_reveal()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- A parent attempt is deleted by the existing user/test cascade contract.
    -- Let its FK cascade remove this dependent evidence, but reject a direct
    -- DELETE while the parent attempt still exists.
    IF TG_OP = 'DELETE' AND NOT EXISTS (
        SELECT 1 FROM public.listening_test_attempts AS attempt
         WHERE attempt.id = OLD.attempt_id
    ) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'listening_programme_feedback_reveal_immutable'
        USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guard_listening_programme_feedback_reveal()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_listening_programme_feedback_reveal
    ON public.listening_programme_feedback_reveals;
CREATE TRIGGER trg_guard_listening_programme_feedback_reveal
    BEFORE UPDATE OR DELETE ON public.listening_programme_feedback_reveals
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_listening_programme_feedback_reveal();

CREATE OR REPLACE FUNCTION public.fn_record_listening_programme_feedback_reveal(
    p_attempt_id UUID,
    p_user_id UUID,
    p_q_num INTEGER
)
RETURNS TABLE(first_answer TEXT, revealed_at TIMESTAMP WITH TIME ZONE,
              was_created BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt public.listening_test_attempts%ROWTYPE;
    v_saved_answer TEXT;
    v_first_answer TEXT;
    v_revealed_at TIMESTAMP WITH TIME ZONE;
    v_created BOOLEAN := FALSE;
BEGIN
    IF p_attempt_id IS NULL OR p_user_id IS NULL OR p_q_num IS NULL
       OR p_q_num <= 0 THEN
        RAISE EXCEPTION 'listening_programme_feedback_invalid_input'
            USING ERRCODE = '22023';
    END IF;

    SELECT attempt.* INTO v_attempt
      FROM public.listening_test_attempts AS attempt
      JOIN public.listening_tests AS test ON test.id = attempt.test_id
      JOIN public.listening_content_packages AS package
        ON package.id = test.content_package_id
     WHERE attempt.id = p_attempt_id
       AND attempt.user_id = p_user_id
       AND attempt.scoring_policy = 'report_only'
       AND attempt.class_assignment_item_id IS NULL
       AND attempt.sitting_id IS NULL
       AND test.scoring_policy = 'report_only'
       AND test.programme_id IN (
           'general-listening-practice', 'ielts-listening-practice'
       )
       AND test.status = 'published'
       AND test.is_public = TRUE
       AND package.status = 'published'
     FOR UPDATE OF attempt;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'listening_programme_feedback_not_available'
            USING ERRCODE = '55000';
    END IF;
    IF v_attempt.status <> 'in_progress'
       OR v_attempt.resume_expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'listening_programme_feedback_attempt_closed'
            USING ERRCODE = '55000';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.listening_content AS content
          JOIN public.listening_exercises AS exercise
            ON exercise.content_id = content.id
          CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(exercise.payload -> 'questions') = 'array'
                   THEN exercise.payload -> 'questions'
                   ELSE '[]'::JSONB END
          ) AS question(value)
         WHERE content.test_id = v_attempt.test_id
           AND content.status = 'published'
           AND exercise.status = 'published'
           AND exercise.payload ->> 'variant' = 'programme_form_v1'
           AND question.value ->> 'q_num' = p_q_num::TEXT
    ) THEN
        RAISE EXCEPTION 'listening_programme_feedback_question_not_found'
            USING ERRCODE = '22023';
    END IF;

    SELECT reveal.first_answer, reveal.revealed_at
      INTO v_first_answer, v_revealed_at
      FROM public.listening_programme_feedback_reveals AS reveal
     WHERE reveal.attempt_id = p_attempt_id AND reveal.q_num = p_q_num;
    IF FOUND THEN
        RETURN QUERY SELECT v_first_answer, v_revealed_at, FALSE;
        RETURN;
    END IF;

    SELECT answer.value ->> 'user_answer' INTO v_saved_answer
      FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(v_attempt.answers) = 'array'
               THEN v_attempt.answers ELSE '[]'::JSONB END
      ) WITH ORDINALITY AS answer(value, position)
     WHERE answer.value ->> 'q_num' = p_q_num::TEXT
     ORDER BY answer.position DESC
     LIMIT 1;
    IF v_saved_answer IS NULL OR BTRIM(v_saved_answer) = '' THEN
        RAISE EXCEPTION 'listening_programme_feedback_answer_required'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.listening_programme_feedback_reveals (
        attempt_id, q_num, first_answer
    ) VALUES (p_attempt_id, p_q_num, v_saved_answer)
    ON CONFLICT (attempt_id, q_num) DO NOTHING
    RETURNING listening_programme_feedback_reveals.first_answer,
              listening_programme_feedback_reveals.revealed_at
      INTO v_first_answer, v_revealed_at;
    v_created := FOUND;
    IF NOT v_created THEN
        SELECT reveal.first_answer, reveal.revealed_at
          INTO v_first_answer, v_revealed_at
          FROM public.listening_programme_feedback_reveals AS reveal
         WHERE reveal.attempt_id = p_attempt_id AND reveal.q_num = p_q_num;
    END IF;
    RETURN QUERY SELECT v_first_answer, v_revealed_at, v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_listening_programme_feedback_reveal(
    UUID, UUID, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_listening_programme_feedback_reveal(
    UUID, UUID, INTEGER
) TO service_role;

COMMENT ON TABLE public.listening_programme_feedback_reveals IS
    'Immutable first-answer evidence for assisted report-only programme practice.';

COMMIT;
