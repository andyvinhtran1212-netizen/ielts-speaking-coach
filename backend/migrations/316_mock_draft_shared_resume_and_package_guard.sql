-- Additive follow-up to applied migration 315: preserve owned frozen resumes
-- when hiding shared sources and reject immutable Listening programme forms.
-- Existing papers, attempts, snapshots and exam rows are not rewritten.
BEGIN;

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
    -- Programme forms are immutable package children, not standalone exam papers.
    -- Reject before hiding or inserting; the picker excludes the same source set.
    IF p_skill='listening' AND NULLIF(v_source->>'content_package_id','') IS NOT NULL THEN
        RAISE EXCEPTION 'mock_copy_source_package_unsupported:listening' USING ERRCODE='22023';
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

CREATE OR REPLACE FUNCTION public.fn_resolve_mock_paper_access(
    p_skill TEXT,p_test_id UUID,p_user_id UUID,p_purpose TEXT DEFAULT 'delivery',
    p_class_item_id UUID DEFAULT NULL,p_sitting_id UUID DEFAULT NULL,p_allow_admission BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v JSONB; d JSONB; s RECORD; v_candidate JSONB; v_count INTEGER:=0;
        v_bound UUID; v_attempt JSONB; v_class BOOLEAN:=FALSE; v_public BOOLEAN;
BEGIN
    PERFORM public.fn_lock_mock_paper(p_skill,p_test_id);
    v:=public.fn_mock_paper_row(p_skill,p_test_id);
    IF v IS NULL OR v->>'status'<>'published' THEN RETURN jsonb_build_object('allowed',FALSE,'reason','unavailable'); END IF;
    d:=public.fn_mock_paper_dependencies(p_skill,p_test_id);
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(d) x WHERE x->>'reason'='verification_unavailable') THEN
        PERFORM public.fn_mock_paper_error(p_purpose,'verification_unavailable',p_skill,p_test_id,(v->>'policy_revision')::BIGINT);
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(d) x WHERE x->>'reason'='ambiguous_orphan') THEN
        IF p_user_id IS NOT NULL AND ((p_skill='reading' AND EXISTS(SELECT 1 FROM public.reading_test_attempts WHERE test_id=p_test_id AND user_id=p_user_id AND status='in_progress'))
            OR (p_skill='listening' AND EXISTS(SELECT 1 FROM public.listening_test_attempts WHERE test_id=p_test_id AND user_id=p_user_id AND status='in_progress'))) THEN
            RETURN jsonb_build_object('allowed',FALSE,'reason','ambiguous_orphan');
        END IF;
        RETURN jsonb_build_object('allowed',FALSE,'reason','unavailable');
    END IF;
    v_public:=COALESCE((v->>'is_public')::BOOLEAN,FALSE) AND
        (public.fn_mock_protected_references(d)='[]'::JSONB OR COALESCE(public.fn_mock_overlap_valid(v,d),FALSE));
    IF p_purpose NOT IN ('delivery','practice','assigned_practice','mock_delivery','dictation') THEN
        RETURN jsonb_build_object('allowed',FALSE,'reason','unsupported_purpose');
    END IF;
    IF p_user_id IS NOT NULL AND p_purpose IN ('delivery','mock_delivery') THEN
        FOR s IN SELECT to_jsonb(ms) sitting,to_jsonb(m) exam FROM public.mock_exam_sittings ms
            JOIN public.mock_exams m ON m.id=ms.mock_exam_id WHERE ms.user_id=p_user_id
              AND (p_sitting_id IS NULL OR ms.id=p_sitting_id) AND ms.status<>'void'
              AND CASE WHEN p_skill='reading' THEN m.reading_test_id ELSE m.listening_test_id END=p_test_id LOOP
            IF public.fn_mock_section_valid(p_skill,s.exam,s.sitting) THEN
                v_count:=v_count+1; v_candidate:=s.sitting;
            END IF;
        END LOOP;
    END IF;
    IF v_count>1 THEN RETURN jsonb_build_object('allowed',FALSE,'reason','ambiguous_entitlement'); END IF;
    IF v_count=1 THEN
        v_bound:=NULLIF(v_candidate->>(p_skill||'_attempt_id'),'')::UUID;
        IF v_bound IS NOT NULL THEN
            IF p_skill='reading' THEN SELECT to_jsonb(a) INTO v_attempt FROM public.reading_test_attempts a WHERE id=v_bound;
            ELSE SELECT to_jsonb(a) INTO v_attempt FROM public.listening_test_attempts a WHERE id=v_bound; END IF;
            IF v_attempt IS NULL OR v_attempt->>'user_id'<>p_user_id::TEXT
               OR v_attempt->>'test_id'<>p_test_id::TEXT
               OR v_attempt->>'sitting_id'<>v_candidate->>'id'
               OR v_attempt->>'status'<>'in_progress' THEN
                RETURN jsonb_build_object('allowed',FALSE,'reason','ambiguous_orphan');
            END IF;
        ELSIF NOT p_allow_admission THEN
            RETURN jsonb_build_object('allowed',FALSE,'reason','admission_required');
        END IF;
        RETURN jsonb_build_object('allowed',TRUE,'attempt_purpose','mock_delivery',
            'mock_sitting_id',v_candidate->>'id','attempt_id',v_bound,
            'paper_revision',v->'mock_content_revision','policy_revision',v->'policy_revision');
    END IF;
    IF p_purpose='mock_delivery' OR p_sitting_id IS NOT NULL THEN
        RETURN jsonb_build_object('allowed',FALSE,'reason','unavailable');
    END IF;
    -- A policy Hide stops new admission, while the authenticated owner can
    -- continue one existing standalone attempt through canonical delivery.
    -- A pre-existing owned attempt is an independent frozen entitlement. Other
    -- exam references still block fresh admission, but cannot revoke this resume.
    IF p_user_id IS NOT NULL AND p_purpose='delivery' AND NOT p_allow_admission THEN
        IF p_skill='reading' THEN
            SELECT count(*),jsonb_agg(to_jsonb(a))->0 INTO v_count,v_attempt FROM public.reading_test_attempts a
             WHERE user_id=p_user_id AND test_id=p_test_id AND sitting_id IS NULL AND status='in_progress'
               AND resume_expires_at>clock_timestamp() AND (p_class_item_id IS NULL OR class_assignment_item_id=p_class_item_id);
        ELSE
            SELECT count(*),jsonb_agg(to_jsonb(a))->0 INTO v_count,v_attempt FROM public.listening_test_attempts a
             WHERE user_id=p_user_id AND test_id=p_test_id AND sitting_id IS NULL AND status='in_progress'
               AND resume_expires_at>clock_timestamp() AND (p_class_item_id IS NULL OR class_assignment_item_id=p_class_item_id);
        END IF;
        IF v_count>1 THEN RETURN jsonb_build_object('allowed',FALSE,'reason','ambiguous_orphan'); END IF;
        IF v_count=1 THEN RETURN jsonb_build_object('allowed',TRUE,'attempt_purpose',COALESCE(v_attempt->>'attempt_purpose','practice'),
            'attempt_id',v_attempt->>'id','paper_revision',v_attempt->'paper_revision','policy_revision',v_attempt->'policy_revision'); END IF;
    END IF;
    IF p_class_item_id IS NOT NULL AND p_user_id IS NOT NULL
       AND (public.fn_mock_protected_references(d)='[]'::JSONB OR COALESCE(public.fn_mock_overlap_valid(v,d),FALSE)) THEN
        SELECT EXISTS(SELECT 1 FROM public.class_assignment_items i
            JOIN public.students st ON st.id=i.student_id JOIN public.class_assignments a ON a.id=i.assignment_id
            WHERE i.id=p_class_item_id AND st.user_id=p_user_id AND a.skill=p_skill AND a.content_id=p_test_id
              AND a.status='published' AND (a.publish_at IS NULL OR a.publish_at<=clock_timestamp())
              AND (a.due_at IS NULL OR a.due_at>=clock_timestamp())
              AND a.content_config->>'delivery_mode'='assigned_practice') INTO v_class;
    END IF;
    IF v_class THEN RETURN jsonb_build_object('allowed',TRUE,'attempt_purpose','assigned_practice',
        'paper_revision',v->'mock_content_revision','policy_revision',v->'policy_revision'); END IF;
    IF v_public AND p_purpose<>'assigned_practice' THEN RETURN jsonb_build_object('allowed',TRUE,'attempt_purpose','practice',
        'paper_revision',v->'mock_content_revision','policy_revision',v->'policy_revision'); END IF;
    RETURN jsonb_build_object('allowed',FALSE,'reason','unavailable');
END $$;

REVOKE ALL ON FUNCTION public.fn_copy_mock_draft_paper(TEXT,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_copy_mock_draft_paper(TEXT,UUID,UUID,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.fn_resolve_mock_paper_access(TEXT,UUID,UUID,TEXT,UUID,UUID,BOOLEAN) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_mock_paper_access(TEXT,UUID,UUID,TEXT,UUID,UUID,BOOLEAN) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
