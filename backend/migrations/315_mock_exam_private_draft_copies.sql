-- Create class-only papers without taking away standalone practice/resume rights.
-- Source locks, copies, draft and explanation approval share one transaction.
-- Existing drafts/attempts and callers without the create-only flag are unchanged.
-- Hide selected public sources through the normal policy command; valid owned
-- practice can still resume, while the same questions leave the public catalog.
BEGIN;

ALTER TABLE public.web_explanation_objects
    DROP CONSTRAINT IF EXISTS web_explanation_object_identity;
ALTER TABLE public.web_explanation_objects
    ADD CONSTRAINT web_explanation_object_identity CHECK (
        object_id ~ '^cambridge-(1[3-9]|20|21)-test-[1-4]-(reading|listening)-q[0-9]{2}$'
        OR COALESCE(object_id = 'mock-' || COALESCE(reading_test_id, listening_test_id)::TEXT
            || '-' || skill || '-q' || lpad(question_number::TEXT, 2, '0'), FALSE)
    );

-- Global Cambridge imports must not count, deactivate or rewrite exam copies.
CREATE OR REPLACE FUNCTION public.fn_activate_web_explanation_version(
    p_content_version TEXT, p_expected_count INTEGER DEFAULT 2880
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count INTEGER;
BEGIN
    IF (SELECT COUNT(*) FROM public.web_explanation_objects
         WHERE content_version=p_content_version AND object_id LIKE 'cambridge-%') <> p_expected_count
       OR (SELECT COUNT(DISTINCT object_id) FROM public.web_explanation_objects
         WHERE content_version=p_content_version AND object_id LIKE 'cambridge-%') <> p_expected_count THEN
        RAISE EXCEPTION 'web_explanation_version_incomplete' USING ERRCODE='23514';
    END IF;
    UPDATE public.web_explanation_objects SET is_current=FALSE
     WHERE object_id LIKE 'cambridge-%' AND is_current AND content_version<>p_content_version;
    UPDATE public.web_explanation_objects SET is_current=TRUE
     WHERE object_id LIKE 'cambridge-%' AND content_version=p_content_version AND NOT is_current;
    GET DIAGNOSTICS v_count=ROW_COUNT;
    RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.fn_copy_mock_draft_paper(
    p_skill TEXT, p_source_id UUID, p_exam_id UUID, p_actor_id UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
    v_source JSONB;
    v_copy JSONB;
    v_id UUID := gen_random_uuid();
    v_child_id UUID;
    v_child RECORD;
    v_object RECORD;
BEGIN
    PERFORM public.fn_lock_mock_paper(p_skill,p_source_id);
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR SHARE',p_skill||'_tests')
        INTO v_source USING p_source_id;
    IF v_source IS NULL OR v_source->>'status' IS DISTINCT FROM 'published' THEN
        RAISE EXCEPTION 'mock_copy_source_not_published:%',p_skill USING ERRCODE='22023';
    END IF;
    IF COALESCE((v_source->>'is_public')::BOOLEAN,FALSE) THEN
        PERFORM public.fn_mutate_mock_paper_policy(p_skill,p_source_id,'{"is_public":false}',
            p_actor_id,(v_source->>'policy_revision')::BIGINT,NULL,NULL);
    END IF;
    v_copy := v_source || jsonb_build_object(
        'id',v_id,'test_id','MOCK-'||p_exam_id::TEXT||'-'||upper(p_skill),
        'title',COALESCE(v_source->>'title',p_skill)||' (bản riêng cho kỳ thi)',
        'is_public',FALSE,'exam_only',TRUE,'public_practice_enabled',FALSE,
        'web_explanation_mode','disabled','web_explanation_content_version',NULL,
        'web_explanations_released_at',NULL,'web_explanations_released_by',NULL,
        'approved_public_overlap',NULL,'policy_revision',0,'mock_content_revision',0,
        'created_by',p_actor_id,'created_at',now(),'updated_at',now(),
        'metadata',COALESCE(NULLIF(v_source->'metadata','null'::JSONB),'{}'::JSONB)
            || jsonb_build_object('mock_draft_copy',jsonb_build_object(
                'exam_id',p_exam_id,'source_test_id',p_source_id,
                'source_revision',v_source->'mock_content_revision','created_by',p_actor_id)));
    EXECUTE format('INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I,$1)',
        p_skill||'_tests',p_skill||'_tests') USING v_copy;

    IF p_skill='reading' THEN
        FOR v_child IN SELECT * FROM public.reading_passages WHERE test_id=p_source_id ORDER BY id LOOP
            v_child_id:=gen_random_uuid();
            INSERT INTO public.reading_passages SELECT * FROM jsonb_populate_record(
                NULL::public.reading_passages,to_jsonb(v_child)||jsonb_build_object(
                    'id',v_child_id,'test_id',v_id,'slug','mock-'||v_child_id::TEXT));
            INSERT INTO public.reading_questions SELECT r.* FROM public.reading_questions q
                CROSS JOIN LATERAL jsonb_populate_record(NULL::public.reading_questions,
                    to_jsonb(q)||jsonb_build_object('id',gen_random_uuid(),'passage_id',v_child_id)) r
                WHERE q.passage_id=v_child.id;
        END LOOP;
    ELSE
        FOR v_child IN SELECT * FROM public.listening_content WHERE test_id=p_source_id ORDER BY id LOOP
            v_child_id:=gen_random_uuid();
            INSERT INTO public.listening_content SELECT * FROM jsonb_populate_record(
                NULL::public.listening_content,to_jsonb(v_child)||jsonb_build_object('id',v_child_id,'test_id',v_id));
            INSERT INTO public.listening_exercises SELECT r.* FROM public.listening_exercises e
                CROSS JOIN LATERAL jsonb_populate_record(NULL::public.listening_exercises,
                    to_jsonb(e)||jsonb_build_object('id',gen_random_uuid(),'content_id',v_child_id)) r
                WHERE e.content_id=v_child.id;
        END LOOP;
    END IF;
    -- Separate identities preserve the source's current version and approvals.
    -- Payload/source_hash remain exact source evidence; binding is on the row.
    FOR v_object IN SELECT * FROM public.web_explanation_objects
        WHERE is_current AND ((p_skill='reading' AND reading_test_id=p_source_id)
            OR (p_skill='listening' AND listening_test_id=p_source_id)) ORDER BY question_number LOOP
        INSERT INTO public.web_explanation_objects SELECT * FROM jsonb_populate_record(
            NULL::public.web_explanation_objects,to_jsonb(v_object)||jsonb_build_object(
                'id',gen_random_uuid(),'object_id','mock-'||v_id::TEXT||'-'||p_skill||'-q'||lpad(v_object.question_number::TEXT,2,'0'),
                'reading_test_id',CASE WHEN p_skill='reading' THEN v_id END,
                'listening_test_id',CASE WHEN p_skill='listening' THEN v_id END,
                'created_at',now()));
    END LOOP;
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.fn_create_mock_exam_with_paper_policy(p_payload JSONB,p_actor_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
    v_row JSONB;
    v_patch JSONB;
    v_columns TEXT;
    v_select TEXT;
    v_exam JSONB;
    v_lock RECORD;
    v_private BOOLEAN:=COALESCE((p_payload->>'private_content_copy')::BOOLEAN,FALSE);
    v_copy_id UUID;
BEGIN
    v_row:=p_payload-ARRAY['reading_is_public','listening_is_public','web_explanation_content_version','private_content_copy'];
    v_row:=v_row||jsonb_build_object('created_by',p_actor_id,'web_explanation_mode','disabled');
    FOR v_lock IN SELECT ref->>'skill' skill,ref->>'id' id FROM jsonb_array_elements(jsonb_build_array(
        jsonb_build_object('skill','reading','id',p_payload->>'reading_test_id'),
        jsonb_build_object('skill','listening','id',p_payload->>'listening_test_id'))) ref
        WHERE NULLIF(ref->>'id','') IS NOT NULL ORDER BY skill,id LOOP
        PERFORM public.fn_lock_mock_paper(v_lock.skill,v_lock.id::UUID);
        IF NOT v_private AND p_payload ? (v_lock.skill||'_is_public') AND p_payload->>(v_lock.skill||'_is_public')='false' THEN
            PERFORM public.fn_mutate_mock_paper_policy(v_lock.skill,v_lock.id::UUID,'{"is_public":false}',p_actor_id,NULL,NULL,NULL);
        END IF;
    END LOOP;
    IF v_private THEN
        -- Reserve the code before copying. Failure at any later step rolls back all rows.
        v_row:=v_row-ARRAY['reading_test_id','listening_test_id']
            ||jsonb_build_object('status','draft','is_open',FALSE);
    END IF;
    SELECT string_agg(format('%I',key),',' ORDER BY key),string_agg(format('r.%I',key),',' ORDER BY key)
      INTO v_columns,v_select FROM jsonb_object_keys(v_row) key
      WHERE key=ANY(ARRAY['code','title','reading_test_id','listening_test_id','writing_task1_prompt_id','writing_task2_prompt_id',
          'speaking_topic_set','total_minutes','reading_minutes','writing_minutes','open_from','open_until','cohort_id',
          'review_sla_days','status','is_open','web_explanation_mode','post_test_capture_required','created_by','exam_mode']);
    EXECUTE format('INSERT INTO public.mock_exams(%s) SELECT %s FROM jsonb_populate_record(NULL::public.mock_exams,$1) r RETURNING to_jsonb(mock_exams)',v_columns,v_select)
        INTO v_exam USING v_row;
    v_patch:=jsonb_build_object('web_explanation_mode',COALESCE(p_payload->>'web_explanation_mode',CASE WHEN v_private THEN 'disabled' ELSE 'with_result' END),
        'web_explanation_content_version',p_payload->'web_explanation_content_version');
    IF v_private THEN
        FOR v_lock IN SELECT ref->>'skill' skill,ref->>'id' id FROM jsonb_array_elements(jsonb_build_array(
            jsonb_build_object('skill','reading','id',p_payload->>'reading_test_id'),
            jsonb_build_object('skill','listening','id',p_payload->>'listening_test_id'))) ref
            WHERE NULLIF(ref->>'id','') IS NOT NULL ORDER BY skill,id LOOP
            v_copy_id:=public.fn_copy_mock_draft_paper(v_lock.skill,v_lock.id::UUID,(v_exam->>'id')::UUID,p_actor_id);
            v_patch:=v_patch||jsonb_build_object(v_lock.skill||'_test_id',v_copy_id);
        END LOOP;
    ELSE
        IF p_payload?'reading_is_public' THEN v_patch:=v_patch||jsonb_build_object('reading_is_public',p_payload->'reading_is_public'); END IF;
        IF p_payload?'listening_is_public' THEN v_patch:=v_patch||jsonb_build_object('listening_is_public',p_payload->'listening_is_public'); END IF;
    END IF;
    RETURN public.fn_update_mock_exam_with_explanation_approval((v_exam->>'id')::UUID,v_patch,p_actor_id);
EXCEPTION WHEN deadlock_detected OR lock_not_available THEN
    PERFORM public.fn_mock_paper_error('mock_create','verification_unavailable','reading',NULLIF(p_payload->>'reading_test_id','')::UUID,NULL);
END $$;

REVOKE ALL ON FUNCTION public.fn_copy_mock_draft_paper(TEXT,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_copy_mock_draft_paper(TEXT,UUID,UUID,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.fn_create_mock_exam_with_paper_policy(JSONB,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_mock_exam_with_paper_policy(JSONB,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.fn_activate_web_explanation_version(TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_activate_web_explanation_version(TEXT,INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
