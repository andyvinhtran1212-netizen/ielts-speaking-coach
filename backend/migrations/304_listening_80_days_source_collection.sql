-- LISTENING80-0009: independent source collection; no attempt-store changes.
BEGIN;
ALTER TABLE public.listening_content_packages DROP CONSTRAINT listening_content_packages_programme_id_check;
ALTER TABLE public.listening_content_packages ADD CONSTRAINT listening_content_packages_programme_id_check
 CHECK (programme_id IN ('general-listening-practice','ielts-listening-practice','ielts-80-days-listening'));
ALTER TABLE public.listening_lessons DROP CONSTRAINT listening_lessons_programme_id_check;
ALTER TABLE public.listening_lessons ADD CONSTRAINT listening_lessons_programme_id_check
 CHECK (programme_id IN ('general-listening-practice','ielts-listening-practice','ielts-80-days-listening'));
ALTER TABLE public.listening_tests DROP CONSTRAINT listening_tests_programme_id_check;
ALTER TABLE public.listening_tests ADD CONSTRAINT listening_tests_programme_id_check
 CHECK (programme_id IN ('ielts','general-listening-practice','ielts-listening-practice','ielts-80-days-listening'));

-- Missing alignment is explicit only for the source collection. Old packages
-- retain complete provenance, guarded by parent namespace instead of fake hashes.
ALTER TABLE public.listening_package_stimuli ALTER COLUMN source_timing_path DROP NOT NULL;
ALTER TABLE public.listening_package_stimuli ALTER COLUMN source_timing_sha256 DROP NOT NULL;
CREATE OR REPLACE FUNCTION public.fn_guard_listening_source_provenance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_programme TEXT;
BEGIN
 SELECT programme_id INTO v_programme FROM public.listening_content_packages WHERE id=NEW.package_id;
 IF v_programme IS NULL THEN RAISE EXCEPTION 'listening_source_package_missing'; END IF;
 IF (NEW.source_timing_path IS NULL) <> (NEW.source_timing_sha256 IS NULL)
    OR (v_programme = 'ielts-80-days-listening' AND NEW.controlled_transcript_path IS NULL) THEN
    RAISE EXCEPTION 'listening_source_provenance_pair_mismatch' USING ERRCODE='22023';
 END IF;
 IF v_programme <> 'ielts-80-days-listening' AND
    (NEW.source_timing_path IS NULL OR NEW.source_timing_sha256 IS NULL OR NEW.controlled_transcript_sha256 IS NULL) THEN
    RAISE EXCEPTION 'listening_generic_provenance_required' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_guard_listening_source_provenance() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_guard_listening_source_provenance ON public.listening_package_stimuli;
CREATE TRIGGER trg_guard_listening_source_provenance BEFORE INSERT OR UPDATE ON public.listening_package_stimuli
 FOR EACH ROW EXECUTE FUNCTION public.fn_guard_listening_source_provenance();

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
           'general-listening-practice', 'ielts-listening-practice',
           'ielts-80-days-listening'
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
COMMIT;
