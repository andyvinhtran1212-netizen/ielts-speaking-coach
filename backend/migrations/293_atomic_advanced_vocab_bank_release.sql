-- Atomically import and optionally publish one Advanced Vocabulary bank.
--
-- The importer previously wrote bank metadata/publication and replaced the 48
-- questions in separate PostgREST transactions.  A failed replacement could
-- therefore expose a published bank whose runtime checksum and questions did
-- not describe the same revision.  This RPC owns the course/bank lock and
-- commits metadata, questions, and the explicit publication decision together.

BEGIN;

CREATE OR REPLACE FUNCTION public.upsert_advanced_vocab_bank(
    p_payload JSONB,
    p_rows JSONB,
    p_publish BOOLEAN DEFAULT FALSE
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
    v_course_id UUID;
    v_words_count INTEGER;
    v_version INTEGER;
    v_runtime JSONB;
    v_expected_qids JSONB;
    v_row_qids JSONB;
    v_written INTEGER;
    v_action TEXT;
    v_publish BOOLEAN;
BEGIN
    IF jsonb_typeof(p_payload) <> 'object'
       OR jsonb_typeof(p_rows) <> 'array'
       OR jsonb_typeof(p_payload -> 'meta') <> 'object'
       OR jsonb_typeof(p_payload -> 'meta' -> 'runtime') <> 'object'
       OR NULLIF(p_payload ->> 'code', '') IS NULL
       OR NULLIF(p_payload ->> 'title', '') IS NULL
       OR NULLIF(p_payload ->> 'course_id', '') IS NULL
       OR p_payload ->> 'skill_area' <> 'course'
       OR (p_payload ->> 'is_published')::BOOLEAN IS DISTINCT FROM FALSE
       OR NULLIF(p_payload -> 'meta' -> 'runtime' ->> 'kind', '')
            IS DISTINCT FROM 'advanced_vocab'
       OR NULLIF(p_payload -> 'meta' -> 'runtime' ->> 'lesson_id', '') IS NULL
       OR NULLIF(p_payload -> 'meta' -> 'runtime' ->> 'content_checksum', '') IS NULL
       OR jsonb_typeof(
            p_payload -> 'meta' -> 'runtime' -> 'practice_question_ids'
          ) <> 'array'
       OR jsonb_array_length(p_rows) <> 48
       OR jsonb_array_length(
            p_payload -> 'meta' -> 'runtime' -> 'practice_question_ids'
          ) <> 48 THEN
        RAISE EXCEPTION 'advanced_vocab_bank_payload_invalid'
            USING ERRCODE = '22023';
    END IF;

    BEGIN
        v_course_id := (p_payload ->> 'course_id')::UUID;
        v_words_count := (p_payload ->> 'words_count')::INTEGER;
        v_version := COALESCE((p_payload ->> 'version')::INTEGER, 1);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'advanced_vocab_bank_payload_invalid'
            USING ERRCODE = '22023';
    END;
    IF v_words_count <> 24 OR v_version < 1
       OR NULLIF(p_payload ->> 'lesson_no', '') IS NOT NULL THEN
        RAISE EXCEPTION 'advanced_vocab_bank_payload_invalid'
            USING ERRCODE = '22023';
    END IF;

    v_runtime := p_payload -> 'meta' -> 'runtime';
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

    -- A new bank has no row to lock yet.  Locking its Course parent serializes
    -- two concurrent creators; existing-bank updates additionally lock the
    -- same quiz_banks row that assignment issuance locks.
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

    IF FOUND THEN
        IF v_bank.skill_area <> 'course'
           OR COALESCE(v_bank.meta -> 'runtime' ->> 'kind', '')
                <> 'advanced_vocab' THEN
            RAISE EXCEPTION 'advanced_vocab_bank_identity_conflict'
                USING ERRCODE = '55000';
        END IF;
        -- An issued assignment freezes this complete runtime contract, not
        -- merely its checksum.  Never let an importer mutate either the
        -- questions or their learner-flow metadata underneath that snapshot.
        IF v_bank.meta -> 'runtime' IS DISTINCT FROM v_runtime
           AND EXISTS (
               SELECT 1 FROM public.class_assignments AS ca
                WHERE ca.content_id = v_bank.id
           ) THEN
            RAISE EXCEPTION 'advanced_vocab_bank_revision_in_use'
                USING ERRCODE = '55000';
        END IF;
        v_action := 'updated';
        v_publish := CASE WHEN p_publish THEN TRUE ELSE v_bank.is_published END;
    ELSE
        INSERT INTO public.quiz_banks (
            code, title, skill_area, course_id, lesson_no, words_count,
            source, version, is_published, meta
        ) VALUES (
            p_payload ->> 'code',
            p_payload ->> 'title',
            'course',
            v_course_id,
            NULL,
            v_words_count,
            p_payload ->> 'source',
            v_version,
            FALSE,
            p_payload -> 'meta'
        ) RETURNING * INTO v_bank;
        v_action := 'created';
        v_publish := p_publish;
    END IF;

    v_written := public.quiz_replace_questions(v_bank.id, p_rows);
    IF v_written <> 48 THEN
        RAISE EXCEPTION 'advanced_vocab_bank_question_count_mismatch'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.quiz_banks
       SET title = p_payload ->> 'title',
           skill_area = 'course',
           course_id = v_course_id,
           lesson_no = NULL,
           words_count = v_words_count,
           source = p_payload ->> 'source',
           version = v_version,
           is_published = v_publish,
           meta = p_payload -> 'meta'
     WHERE id = v_bank.id
     RETURNING * INTO v_bank;

    RETURN QUERY SELECT v_bank.id, v_written, v_bank.is_published, v_action;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_advanced_vocab_bank(JSONB, JSONB, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_advanced_vocab_bank(JSONB, JSONB, BOOLEAN)
    TO service_role;

COMMENT ON FUNCTION public.upsert_advanced_vocab_bank(JSONB, JSONB, BOOLEAN) IS
'Atomically locks, imports, verifies, and optionally publishes one immutable Advanced Vocabulary bank; service_role only.';

NOTIFY pgrst, 'reload schema';

COMMIT;
