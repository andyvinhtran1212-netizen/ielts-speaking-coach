-- One canonical transaction for quiz-bank revision import and publication.
--
-- `POST /admin/quiz/import` historically inserted/updated the bank and replaced
-- its questions in separate PostgREST transactions.  Advanced Vocabulary also
-- needs an explicit preserve/published/unpublished contract which serializes
-- with assignment issuance on the same quiz_banks row lock.

BEGIN;

CREATE OR REPLACE FUNCTION public.import_quiz_bank_atomic(
    p_payload JSONB,
    p_rows JSONB,
    p_publish_state TEXT DEFAULT 'preserve'
)
RETURNS TABLE (
    bank_id UUID,
    written INTEGER,
    is_published BOOLEAN,
    action TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bank public.quiz_banks%ROWTYPE;
    v_topic_id UUID;
    v_course_id UUID;
    v_lesson_no INTEGER;
    v_words_count INTEGER;
    v_version INTEGER;
    v_runtime JSONB;
    v_advanced BOOLEAN;
    v_expected_qids JSONB;
    v_row_qids JSONB;
    v_written INTEGER;
    v_action TEXT;
    v_publish BOOLEAN;
BEGIN
    IF jsonb_typeof(p_payload) <> 'object'
       OR jsonb_typeof(p_rows) <> 'array'
       OR jsonb_array_length(p_rows) < 1
       OR NULLIF(p_payload ->> 'code', '') IS NULL
       OR NULLIF(p_payload ->> 'skill_area', '') IS NULL
       OR p_publish_state NOT IN ('preserve', 'published', 'unpublished') THEN
        RAISE EXCEPTION 'quiz_bank_import_payload_invalid'
            USING ERRCODE = '22023';
    END IF;

    BEGIN
        v_topic_id := NULLIF(p_payload ->> 'topic_id', '')::UUID;
        v_course_id := NULLIF(p_payload ->> 'course_id', '')::UUID;
        v_lesson_no := NULLIF(p_payload ->> 'lesson_no', '')::INTEGER;
        v_words_count := COALESCE((p_payload ->> 'words_count')::INTEGER, 0);
        v_version := COALESCE((p_payload ->> 'version')::INTEGER, 1);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'quiz_bank_import_payload_invalid'
            USING ERRCODE = '22023';
    END;
    IF v_words_count < 0 OR v_version < 1 OR v_lesson_no < 1 THEN
        RAISE EXCEPTION 'quiz_bank_import_payload_invalid'
            USING ERRCODE = '22023';
    END IF;

    v_runtime := COALESCE(p_payload -> 'meta' -> 'runtime', '{}'::JSONB);
    v_advanced := COALESCE(v_runtime ->> 'kind', '') = 'advanced_vocab';

    IF v_advanced THEN
        IF p_payload ->> 'skill_area' <> 'course'
           OR v_course_id IS NULL
           OR v_topic_id IS NOT NULL
           OR v_lesson_no IS NOT NULL
           OR v_words_count <> 24
           OR jsonb_array_length(p_rows) <> 48
           OR NULLIF(v_runtime ->> 'lesson_id', '') IS NULL
           OR NULLIF(v_runtime ->> 'content_checksum', '') IS NULL
           OR jsonb_typeof(v_runtime -> 'practice_question_ids') <> 'array'
           OR jsonb_array_length(v_runtime -> 'practice_question_ids') <> 48 THEN
            RAISE EXCEPTION 'advanced_vocab_bank_payload_invalid'
                USING ERRCODE = '22023';
        END IF;
        v_expected_qids := v_runtime -> 'practice_question_ids';
        SELECT jsonb_agg(row_value ->> 'qid' ORDER BY ordinality)
          INTO v_row_qids
          FROM jsonb_array_elements(p_rows) WITH ORDINALITY
               AS question_rows(row_value, ordinality);
        IF v_row_qids IS DISTINCT FROM v_expected_qids
           OR (SELECT count(DISTINCT value)
                 FROM jsonb_array_elements_text(v_expected_qids) AS ids(value)) <> 48 THEN
            RAISE EXCEPTION 'advanced_vocab_bank_question_set_mismatch'
                USING ERRCODE = '22023';
        END IF;
        PERFORM 1 FROM public.courses WHERE id = v_course_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'advanced_vocab_course_not_found'
                USING ERRCODE = 'P0002';
        END IF;
        SELECT qb.* INTO v_bank
          FROM public.quiz_banks AS qb
         WHERE qb.course_id = v_course_id
           AND qb.code = p_payload ->> 'code'
         FOR UPDATE;
    ELSE
        IF v_topic_id IS NULL OR v_course_id IS NOT NULL THEN
            RAISE EXCEPTION 'quiz_bank_topic_required'
                USING ERRCODE = '22023';
        END IF;
        PERFORM 1 FROM public.content_topics WHERE id = v_topic_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'quiz_bank_topic_not_found'
                USING ERRCODE = 'P0002';
        END IF;
        SELECT qb.* INTO v_bank
          FROM public.quiz_banks AS qb
         WHERE qb.skill_area = p_payload ->> 'skill_area'
           AND qb.topic_id = v_topic_id
           AND qb.code = p_payload ->> 'code'
         FOR UPDATE;
    END IF;

    IF FOUND THEN
        IF (COALESCE(v_bank.meta -> 'runtime' ->> 'kind', '') = 'advanced_vocab')
              IS DISTINCT FROM v_advanced THEN
            RAISE EXCEPTION 'quiz_bank_runtime_identity_conflict'
                USING ERRCODE = '55000';
        END IF;
        IF v_advanced
           AND v_bank.meta -> 'runtime' IS DISTINCT FROM v_runtime
           AND EXISTS (
               SELECT 1 FROM public.class_assignments AS ca
                WHERE ca.content_id = v_bank.id
           ) THEN
            RAISE EXCEPTION 'advanced_vocab_bank_revision_in_use'
                USING ERRCODE = '55000';
        END IF;
        v_action := 'updated';
        v_publish := CASE p_publish_state
            WHEN 'published' THEN TRUE
            WHEN 'unpublished' THEN FALSE
            ELSE v_bank.is_published
        END;
    ELSE
        INSERT INTO public.quiz_banks (
            topic_id, code, title, skill_area, course_id, lesson_no,
            words_count, source, version, is_published, import_batch_id, meta
        ) VALUES (
            v_topic_id,
            p_payload ->> 'code',
            p_payload ->> 'title',
            p_payload ->> 'skill_area',
            v_course_id,
            v_lesson_no,
            v_words_count,
            p_payload ->> 'source',
            v_version,
            CASE p_publish_state
                WHEN 'published' THEN TRUE
                WHEN 'unpublished' THEN FALSE
                ELSE NOT v_advanced
            END,
            p_payload ->> 'import_batch_id',
            COALESCE(p_payload -> 'meta', '{}'::JSONB)
        ) RETURNING * INTO v_bank;
        v_action := 'created';
        v_publish := v_bank.is_published;
    END IF;

    v_written := public.quiz_replace_questions(v_bank.id, p_rows);
    IF v_written <> jsonb_array_length(p_rows) THEN
        RAISE EXCEPTION 'quiz_bank_question_count_mismatch'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.quiz_banks
       SET topic_id = v_topic_id,
           title = p_payload ->> 'title',
           skill_area = p_payload ->> 'skill_area',
           course_id = v_course_id,
           lesson_no = v_lesson_no,
           words_count = v_words_count,
           source = p_payload ->> 'source',
           version = v_version,
           is_published = v_publish,
           import_batch_id = p_payload ->> 'import_batch_id',
           meta = COALESCE(p_payload -> 'meta', '{}'::JSONB)
     WHERE id = v_bank.id
     RETURNING * INTO v_bank;

    RETURN QUERY SELECT v_bank.id, v_written, v_bank.is_published, v_action;
END;
$$;

REVOKE ALL ON FUNCTION public.import_quiz_bank_atomic(JSONB, JSONB, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_quiz_bank_atomic(JSONB, JSONB, TEXT)
    TO service_role;

COMMENT ON FUNCTION public.import_quiz_bank_atomic(JSONB, JSONB, TEXT) IS
'Atomically imports a complete quiz-bank revision and applies preserve/published/unpublished under the assignment-shared bank lock; service_role only.';

NOTIFY pgrst, 'reload schema';

COMMIT;
