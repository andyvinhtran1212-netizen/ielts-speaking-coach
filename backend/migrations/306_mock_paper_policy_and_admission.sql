-- MOCKREPAIR-0016: serialized paper policy and purpose-bound admission.
-- No historical backfill, regrade, source rewrite, or room-clock change.
BEGIN;

ALTER TABLE public.reading_tests
    ADD COLUMN IF NOT EXISTS policy_revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS mock_content_revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS approved_public_overlap JSONB;
ALTER TABLE public.listening_tests
    ADD COLUMN IF NOT EXISTS policy_revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS mock_content_revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS approved_public_overlap JSONB;
ALTER TABLE public.reading_test_attempts
    ADD COLUMN IF NOT EXISTS attempt_purpose TEXT,
    ADD COLUMN IF NOT EXISTS paper_revision BIGINT,
    ADD COLUMN IF NOT EXISTS policy_revision BIGINT;
ALTER TABLE public.listening_test_attempts
    ADD COLUMN IF NOT EXISTS attempt_purpose TEXT,
    ADD COLUMN IF NOT EXISTS paper_revision BIGINT,
    ADD COLUMN IF NOT EXISTS policy_revision BIGINT;

-- Owner RLS is a row boundary, not a seal: SELECT('*') would otherwise reveal
-- persisted expected answers after a sealed submission. All result/grade
-- writes and result reads use the existing authenticated backend endpoints.
REVOKE ALL ON public.reading_test_attempts,public.listening_test_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,test_id,user_id,status,answers,started_at,resume_expires_at,renderer_affinity,
    sitting_id,class_assignment_item_id,attempt_purpose,paper_revision,policy_revision)
    ON public.reading_test_attempts,public.listening_test_attempts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.reading_test_attempts,public.listening_test_attempts TO service_role;

-- The existing item-observation/capture tables describe answers AFTER work;
-- neither stores one immutable pre-submit paper context. Attempts have owner
-- SELECT policies, so keys must not be added to their client-readable JSON.
CREATE TABLE IF NOT EXISTS public.mock_paper_attempt_snapshots (
    skill TEXT NOT NULL CHECK (skill IN ('reading','listening')),
    attempt_id UUID NOT NULL,
    paper_id UUID NOT NULL,
    paper_revision BIGINT NOT NULL,
    policy_revision BIGINT NOT NULL,
    attempt_purpose TEXT NOT NULL,
    sitting_id UUID,
    paper_row JSONB NOT NULL,
    source_rows JSONB NOT NULL,
    marking_rows JSONB NOT NULL,
    passage_order_by_id JSONB NOT NULL DEFAULT '{}',
    scoring_override_rows JSONB NOT NULL DEFAULT '[]',
    captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (skill,attempt_id),
    CHECK (jsonb_typeof(source_rows)='array' AND jsonb_array_length(source_rows)<=100),
    CHECK (jsonb_typeof(marking_rows)='array' AND jsonb_array_length(marking_rows)<=1000)
);
ALTER TABLE public.mock_paper_attempt_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_client_mock_paper_snapshots ON public.mock_paper_attempt_snapshots;
CREATE POLICY deny_client_mock_paper_snapshots ON public.mock_paper_attempt_snapshots
    FOR ALL TO anon,authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.mock_paper_attempt_snapshots FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.mock_paper_attempt_snapshots TO service_role;

CREATE OR REPLACE FUNCTION public.fn_lock_mock_paper(p_skill TEXT,p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
    IF p_skill NOT IN ('reading','listening') OR p_id IS NULL THEN
        RAISE EXCEPTION 'invalid_mock_paper_lock';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('mock-paper:'||p_skill||':'||p_id::TEXT,0));
EXCEPTION WHEN deadlock_detected OR lock_not_available THEN
    PERFORM public.fn_mock_paper_error('transaction','verification_unavailable',p_skill,p_id,NULL);
END $$;

CREATE OR REPLACE FUNCTION public.fn_guard_mock_paper_reference()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_row JSONB:=CASE WHEN TG_OP='INSERT' THEN '{}'::JSONB ELSE to_jsonb(OLD) END;
        new_row JSONB:=CASE WHEN TG_OP='DELETE' THEN '{}'::JSONB ELSE to_jsonb(NEW) END;
        refs JSONB:='[]'; x RECORD; paper JSONB; parent JSONB; v_new BOOLEAN; v_protected BOOLEAN;
BEGIN
    IF TG_TABLE_NAME IN ('mock_exams','mock_exam_sittings','mock_exam_assignments') THEN
        IF TG_TABLE_NAME='mock_exams' THEN
            refs:=jsonb_build_array(jsonb_build_object('kind','reading','id',old_row->>'reading_test_id'),
                jsonb_build_object('kind','listening','id',old_row->>'listening_test_id'),
                jsonb_build_object('kind','reading','id',new_row->>'reading_test_id'),
                jsonb_build_object('kind','listening','id',new_row->>'listening_test_id'));
        ELSE
            FOR x IN SELECT to_jsonb(m) row FROM public.mock_exams m
                WHERE m.id IN (NULLIF(old_row->>CASE WHEN TG_TABLE_NAME='mock_exam_sittings' THEN 'mock_exam_id' ELSE 'exam_id' END,'')::UUID,
                               NULLIF(new_row->>CASE WHEN TG_TABLE_NAME='mock_exam_sittings' THEN 'mock_exam_id' ELSE 'exam_id' END,'')::UUID) LOOP
                refs:=refs||jsonb_build_array(jsonb_build_object('kind','reading','id',x.row->>'reading_test_id'),
                    jsonb_build_object('kind','listening','id',x.row->>'listening_test_id'));
            END LOOP;
        END IF;
    ELSIF TG_TABLE_NAME='class_assignments' THEN
        refs:=jsonb_build_array(jsonb_build_object('kind',old_row->>'skill','id',old_row->>'content_id'),
            jsonb_build_object('kind',new_row->>'skill','id',new_row->>'content_id'));
    END IF;
    FOR x IN SELECT DISTINCT item->>'kind' kind,item->>'id' id FROM jsonb_array_elements(refs) item
        WHERE item->>'kind' IN ('reading','listening') AND item->>'id' IS NOT NULL
        ORDER BY kind,id LOOP PERFORM public.fn_lock_mock_paper(x.kind,x.id::UUID); END LOOP;
    IF TG_TABLE_NAME='mock_exam_sittings' AND TG_OP='UPDATE' THEN
        IF (old_row->>'reading_attempt_id' IS NOT NULL AND new_row->>'reading_attempt_id' IS DISTINCT FROM old_row->>'reading_attempt_id')
           OR (old_row->>'listening_attempt_id' IS NOT NULL AND new_row->>'listening_attempt_id' IS DISTINCT FROM old_row->>'listening_attempt_id') THEN
            PERFORM public.fn_mock_paper_error('attach','immutable_admission','reading',NULLIF(new_row->>'reading_attempt_id','')::UUID,NULL);
        END IF;
    END IF;
    IF TG_OP='DELETE' THEN
        IF TG_TABLE_NAME='mock_exams' AND EXISTS(SELECT 1 FROM public.mock_exam_sittings WHERE mock_exam_id=OLD.id) THEN
            PERFORM public.fn_mock_paper_error('delete_mock','history_preservation','reading',OLD.reading_test_id,NULL);
        END IF;
        RETURN OLD;
    END IF;
    FOR x IN SELECT DISTINCT item->>'kind' kind,item->>'id' id FROM jsonb_array_elements(refs) item
        WHERE item->>'kind' IN ('reading','listening') AND item->>'id' IS NOT NULL ORDER BY kind,id LOOP
        paper:=public.fn_mock_paper_row(x.kind,x.id::UUID); v_new:=FALSE; v_protected:=FALSE;
        IF TG_TABLE_NAME='mock_exams' THEN
            v_new:=TG_OP='INSERT' OR new_row->>(x.kind||'_test_id') IS DISTINCT FROM old_row->>(x.kind||'_test_id')
                OR (new_row->>'status'='published' AND old_row->>'status' IS DISTINCT FROM 'published');
            v_protected:=new_row->>(x.kind||'_test_id')=x.id AND new_row->>'status' IN ('draft','published');
        ELSIF TG_TABLE_NAME='mock_exam_assignments' THEN
            SELECT to_jsonb(m) INTO parent FROM public.mock_exams m WHERE id=(new_row->>'exam_id')::UUID;
            v_new:=TG_OP='INSERT' OR new_row-ARRAY['updated_at','created_at'] IS DISTINCT FROM old_row-ARRAY['updated_at','created_at'];
            v_protected:=parent->>'status' IN ('draft','published') AND COALESCE(new_row->'skills' ? x.kind,FALSE)
                AND (new_row->>'open_until' IS NULL OR (new_row->>'open_until')::TIMESTAMPTZ>=clock_timestamp());
        ELSIF TG_TABLE_NAME='class_assignments' THEN
            v_new:=TG_OP='INSERT' OR new_row-ARRAY['updated_at','created_at'] IS DISTINCT FROM old_row-ARRAY['updated_at','created_at'];
            v_protected:=new_row->>'skill'=x.kind AND new_row->>'content_id'=x.id AND new_row->>'status'='published'
                AND (new_row->>'due_at' IS NULL OR (new_row->>'due_at')::TIMESTAMPTZ>=clock_timestamp());
        END IF;
        IF v_new AND v_protected THEN
            IF paper IS NULL OR paper->>'status'<>'published' THEN
                PERFORM public.fn_mock_paper_error('link','paper_not_ready',x.kind,x.id::UUID,(paper->>'policy_revision')::BIGINT);
            END IF;
            IF TG_TABLE_NAME='class_assignments' AND public.fn_mock_protected_references(public.fn_mock_paper_dependencies(x.kind,x.id::UUID))<>'[]'::JSONB
               AND NOT COALESCE(public.fn_mock_overlap_valid(paper,public.fn_mock_paper_dependencies(x.kind,x.id::UUID)),FALSE) THEN
                PERFORM public.fn_mock_paper_error('link','public_overlap_unapproved',x.kind,x.id::UUID,(paper->>'policy_revision')::BIGINT);
            END IF;
            -- A new confidential reference cannot inherit an old public flag or
            -- waiver. Create/link privately, then explicitly review all overlap.
            IF TG_TABLE_NAME<>'class_assignments' AND ((x.kind='reading' AND EXISTS(SELECT 1 FROM public.reading_test_attempts WHERE test_id=x.id::UUID AND sitting_id IS NULL AND status='in_progress' AND (resume_expires_at IS NULL OR resume_expires_at>clock_timestamp()))) OR (x.kind='listening' AND EXISTS(SELECT 1 FROM public.listening_test_attempts WHERE test_id=x.id::UUID AND sitting_id IS NULL AND status='in_progress' AND (resume_expires_at IS NULL OR resume_expires_at>clock_timestamp())))) THEN
                PERFORM public.fn_mock_paper_error('link','valid_resume',x.kind,x.id::UUID,(paper->>'policy_revision')::BIGINT);
            END IF;
            IF TG_TABLE_NAME<>'class_assignments' AND COALESCE((paper->>'is_public')::BOOLEAN,FALSE) THEN
                PERFORM public.fn_mock_paper_error('link','public_overlap_unapproved',x.kind,x.id::UUID,(paper->>'policy_revision')::BIGINT);
            END IF;
        END IF;
    END LOOP;
    RETURN NEW;
END $$;

DO $$ DECLARE name TEXT; BEGIN
    FOREACH name IN ARRAY ARRAY['mock_exams','mock_exam_sittings','mock_exam_assignments','class_assignments'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_mock_paper_reference ON public.%I',name);
        EXECUTE format('CREATE TRIGGER trg_mock_paper_reference BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_guard_mock_paper_reference()',name);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.fn_guard_mock_paper_attempt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE k TEXT:=CASE WHEN TG_TABLE_NAME='reading_test_attempts' THEN 'reading' ELSE 'listening' END;
        paper JSONB; sitting JSONB; exam JSONB; v_class BOOLEAN; decision JSONB;
BEGIN
    PERFORM public.fn_lock_mock_paper(k,NEW.test_id);
    IF TG_OP='UPDATE' THEN
        IF NEW.test_id IS DISTINCT FROM OLD.test_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
           OR NEW.sitting_id IS DISTINCT FROM OLD.sitting_id OR NEW.attempt_purpose IS DISTINCT FROM OLD.attempt_purpose
           OR NEW.paper_revision IS DISTINCT FROM OLD.paper_revision OR NEW.policy_revision IS DISTINCT FROM OLD.policy_revision THEN
            -- Existing N-1 bidirectional attach may finish only an already
            -- canonical pointer; it cannot guess/relink an orphan.
            IF OLD.sitting_id IS NULL AND NEW.sitting_id IS NOT NULL THEN
                SELECT to_jsonb(s) INTO sitting FROM public.mock_exam_sittings s WHERE id=NEW.sitting_id;
                IF sitting->>(k||'_attempt_id')=NEW.id::TEXT AND sitting->>'user_id'=NEW.user_id::TEXT
                   AND OLD.test_id=NEW.test_id AND OLD.user_id=NEW.user_id
                   AND OLD.paper_revision IS NOT DISTINCT FROM NEW.paper_revision
                   AND OLD.policy_revision IS NOT DISTINCT FROM NEW.policy_revision THEN RETURN NEW; END IF;
            END IF;
            PERFORM public.fn_mock_paper_error('attempt_update','immutable_admission',k,NEW.test_id,OLD.policy_revision);
        END IF;
        IF NEW.answers IS DISTINCT FROM OLD.answers AND OLD.status='in_progress' AND NEW.sitting_id IS NOT NULL THEN
            SELECT to_jsonb(s) INTO sitting FROM public.mock_exam_sittings s WHERE id=NEW.sitting_id;
            SELECT to_jsonb(m) INTO exam FROM public.mock_exams m WHERE id=(sitting->>'mock_exam_id')::UUID;
            IF sitting->>(k||'_attempt_id') IS DISTINCT FROM NEW.id::TEXT OR NOT public.fn_mock_section_valid(k,exam,sitting) THEN
                PERFORM public.fn_mock_paper_error('answer_write','invalid_resume',k,NEW.test_id,OLD.policy_revision);
            END IF;
        END IF;
        IF NEW.status='submitted' AND OLD.status='in_progress' THEN
            -- Service-role force collection first claims the sitting's submit
            -- stamp. Preserve that existing recovery contract; HTTP submit
            -- separately checks delivery purpose before reading private keys.
            IF NEW.sitting_id IS NOT NULL THEN
                SELECT to_jsonb(s) INTO sitting FROM public.mock_exam_sittings s WHERE id=NEW.sitting_id;
                SELECT to_jsonb(m) INTO exam FROM public.mock_exams m WHERE id=(sitting->>'mock_exam_id')::UUID;
                IF sitting IS NULL OR exam IS NULL OR sitting->>(k||'_attempt_id') IS DISTINCT FROM NEW.id::TEXT
                   OR sitting->>'user_id' IS DISTINCT FROM NEW.user_id::TEXT OR exam->>(k||'_test_id') IS DISTINCT FROM NEW.test_id::TEXT THEN
                    PERFORM public.fn_mock_paper_error('submit','ambiguous_orphan',k,NEW.test_id,OLD.policy_revision);
                END IF;
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    paper:=public.fn_mock_paper_row(k,NEW.test_id);
    IF paper IS NULL OR paper->>'status'<>'published' THEN
        PERFORM public.fn_mock_paper_error('admission','paper_not_ready',k,NEW.test_id,NULL);
    END IF;
    IF NEW.sitting_id IS NOT NULL THEN
        SELECT to_jsonb(s) INTO sitting FROM public.mock_exam_sittings s WHERE id=NEW.sitting_id;
        SELECT to_jsonb(m) INTO exam FROM public.mock_exams m WHERE id=(sitting->>'mock_exam_id')::UUID;
        IF sitting IS NULL OR sitting->>'user_id' IS DISTINCT FROM NEW.user_id::TEXT
           OR exam->>(k||'_test_id') IS DISTINCT FROM NEW.test_id::TEXT
           OR sitting->>(k||'_attempt_id') IS DISTINCT FROM NEW.id::TEXT
           OR NOT public.fn_mock_section_valid(k,exam,sitting) THEN
            PERFORM public.fn_mock_paper_error('admission','mock_binding_required',k,NEW.test_id,(paper->>'policy_revision')::BIGINT);
        END IF;
        NEW.attempt_purpose:='mock_delivery';
    ELSE
        decision:=public.fn_resolve_mock_paper_access(k,NEW.test_id,NEW.user_id,
            CASE WHEN NEW.class_assignment_item_id IS NOT NULL THEN 'assigned_practice' ELSE 'practice' END,
            NEW.class_assignment_item_id,NULL,FALSE);
        IF decision->>'allowed' IS DISTINCT FROM 'true' THEN
            PERFORM public.fn_mock_paper_error('admission','mock_binding_required',k,NEW.test_id,(paper->>'policy_revision')::BIGINT);
        END IF;
        NEW.attempt_purpose:=decision->>'attempt_purpose';
    END IF;
    NEW.paper_revision:=(paper->>'mock_content_revision')::BIGINT;
    NEW.policy_revision:=(paper->>'policy_revision')::BIGINT;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_mock_paper_attempt ON public.reading_test_attempts;
CREATE TRIGGER trg_mock_paper_attempt BEFORE INSERT OR UPDATE ON public.reading_test_attempts
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_mock_paper_attempt();
DROP TRIGGER IF EXISTS trg_mock_paper_attempt ON public.listening_test_attempts;
CREATE TRIGGER trg_mock_paper_attempt BEFORE INSERT OR UPDATE ON public.listening_test_attempts
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_mock_paper_attempt();

CREATE OR REPLACE FUNCTION public.fn_capture_mock_paper_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE k TEXT:=CASE WHEN TG_TABLE_NAME='reading_test_attempts' THEN 'reading' ELSE 'listening' END;
        paper JSONB; sources JSONB; marks JSONB; orders JSONB:='{}'; overrides JSONB;
BEGIN
    -- BEFORE admission holds the paper lock; source-child writers use it too.
    paper:=public.fn_mock_paper_row(k,NEW.test_id);
    IF k='reading' THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.passage_order),'[]'),
               COALESCE(jsonb_object_agg(p.id::TEXT,p.passage_order),'{}') INTO sources,orders
            FROM public.reading_passages p WHERE test_id=NEW.test_id AND library='l3_test';
        SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.q_num,q.id),'[]') INTO marks
            FROM public.reading_questions q JOIN public.reading_passages p ON p.id=q.passage_id
            WHERE p.test_id=NEW.test_id AND p.library='l3_test';
        SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.question_number),'[]') INTO overrides
            FROM public.web_explanation_objects o WHERE reading_test_id=NEW.test_id AND is_current;
    ELSE
        SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.section_num),'[]') INTO sources
            FROM public.listening_content s WHERE test_id=NEW.test_id;
        SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.order_num,e.id),'[]') INTO marks
            FROM public.listening_exercises e JOIN public.listening_content s ON s.id=e.content_id WHERE s.test_id=NEW.test_id;
        SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.question_number),'[]') INTO overrides
            FROM public.web_explanation_objects o WHERE listening_test_id=NEW.test_id AND is_current;
    END IF;
    INSERT INTO public.mock_paper_attempt_snapshots(skill,attempt_id,paper_id,paper_revision,policy_revision,
        attempt_purpose,sitting_id,paper_row,source_rows,marking_rows,passage_order_by_id,scoring_override_rows)
    VALUES(k,NEW.id,NEW.test_id,NEW.paper_revision,NEW.policy_revision,NEW.attempt_purpose,NEW.sitting_id,
        paper,sources,marks,orders,overrides);
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_capture_mock_paper_snapshot ON public.reading_test_attempts;
CREATE TRIGGER trg_capture_mock_paper_snapshot AFTER INSERT ON public.reading_test_attempts
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_mock_paper_snapshot();
DROP TRIGGER IF EXISTS trg_capture_mock_paper_snapshot ON public.listening_test_attempts;
CREATE TRIGGER trg_capture_mock_paper_snapshot AFTER INSERT ON public.listening_test_attempts
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_mock_paper_snapshot();

CREATE OR REPLACE FUNCTION public.fn_admit_mock_paper_attempt(
    p_skill TEXT,p_test_id UUID,p_user_id UUID,p_sitting_id UUID,p_renderer_affinity_protocol TEXT DEFAULT 'legacy')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE paper JSONB; sitting JSONB; exam JSONB; attempt JSONB; v_id UUID; existing UUID; v_started TIMESTAMPTZ;
BEGIN
    PERFORM public.fn_lock_mock_paper(p_skill,p_test_id);
    paper:=public.fn_mock_paper_row(p_skill,p_test_id);
    SELECT to_jsonb(s) INTO sitting FROM public.mock_exam_sittings s WHERE id=p_sitting_id AND user_id=p_user_id FOR UPDATE NOWAIT;
    SELECT to_jsonb(m) INTO exam FROM public.mock_exams m WHERE id=(sitting->>'mock_exam_id')::UUID FOR UPDATE NOWAIT;
    IF paper IS NULL OR sitting IS NULL OR exam->>(p_skill||'_test_id') IS DISTINCT FROM p_test_id::TEXT
       OR NOT public.fn_mock_section_valid(p_skill,exam,sitting) THEN
        PERFORM public.fn_mock_paper_error('admission','invalid_admission',p_skill,p_test_id,(paper->>'policy_revision')::BIGINT);
    END IF;
    existing:=NULLIF(sitting->>(p_skill||'_attempt_id'),'')::UUID;
    IF existing IS NOT NULL THEN
        IF p_skill='reading' THEN SELECT to_jsonb(a) INTO attempt FROM public.reading_test_attempts a WHERE id=existing FOR UPDATE NOWAIT;
        ELSE SELECT to_jsonb(a) INTO attempt FROM public.listening_test_attempts a WHERE id=existing FOR UPDATE NOWAIT; END IF;
        IF attempt IS NULL OR attempt->>'user_id' IS DISTINCT FROM p_user_id::TEXT
           OR attempt->>'test_id' IS DISTINCT FROM p_test_id::TEXT OR attempt->>'sitting_id' IS DISTINCT FROM p_sitting_id::TEXT
           OR attempt->>'status'<>'in_progress' THEN
            PERFORM public.fn_mock_paper_error('admission','ambiguous_orphan',p_skill,p_test_id,(paper->>'policy_revision')::BIGINT);
        END IF;
    ELSE
        IF (p_skill='reading' AND EXISTS(SELECT 1 FROM public.reading_test_attempts WHERE user_id=p_user_id AND test_id=p_test_id AND status='in_progress'))
           OR (p_skill='listening' AND EXISTS(SELECT 1 FROM public.listening_test_attempts WHERE user_id=p_user_id AND test_id=p_test_id AND status='in_progress')) THEN
            PERFORM public.fn_mock_paper_error('admission','ambiguous_orphan',p_skill,p_test_id,(paper->>'policy_revision')::BIGINT);
        END IF;
        v_id:=gen_random_uuid(); v_started:=clock_timestamp();
        IF p_skill='reading' THEN
            UPDATE public.mock_exam_sittings SET reading_attempt_id=v_id WHERE id=p_sitting_id;
            INSERT INTO public.reading_test_attempts(id,test_id,user_id,sitting_id,started_at,renderer_affinity,resume_expires_at)
            VALUES(v_id,p_test_id,p_user_id,p_sitting_id,v_started,CASE WHEN p_renderer_affinity_protocol='claim-v1' THEN NULL ELSE 'legacy' END,
                v_started+INTERVAL '24 hours') RETURNING to_jsonb(reading_test_attempts) INTO attempt;
        ELSE
            UPDATE public.mock_exam_sittings SET listening_attempt_id=v_id WHERE id=p_sitting_id;
            INSERT INTO public.listening_test_attempts(id,test_id,user_id,sitting_id,started_at,renderer_affinity,resume_expires_at,scoring_policy)
            VALUES(v_id,p_test_id,p_user_id,p_sitting_id,v_started,CASE WHEN p_renderer_affinity_protocol='claim-v1' THEN NULL ELSE 'legacy' END,
                v_started+INTERVAL '24 hours',COALESCE(paper->>'scoring_policy','diagnostic'))
                RETURNING to_jsonb(listening_test_attempts) INTO attempt;
        END IF;
    END IF;
    RETURN jsonb_build_object('attempt_id',attempt->>'id','status',attempt->>'status',
        'started_at',attempt->>'started_at','resume_expires_at',attempt->>'resume_expires_at',
        'renderer_affinity',attempt->'renderer_affinity','attempt_purpose','mock_delivery',
        'mock_sitting_id',p_sitting_id,'paper_revision',attempt->'paper_revision','policy_revision',attempt->'policy_revision',
        'time_limit_minutes',paper->'time_limit_minutes','playback_started_at',attempt->'playback_started_at',
        'acquired_existing',existing IS NOT NULL);
EXCEPTION WHEN deadlock_detected OR lock_not_available THEN
    PERFORM public.fn_mock_paper_error('admission','verification_unavailable',p_skill,p_test_id,NULL);
END $$;

CREATE OR REPLACE FUNCTION public.fn_mock_paper_error(
    p_operation TEXT,p_reason TEXT,p_skill TEXT,p_id UUID,p_revision BIGINT,
    p_dependencies JSONB DEFAULT '[]') RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'mock_paper_policy:%',jsonb_build_object(
        'operation',p_operation,'reason',p_reason,'kind',p_skill,'content_id',p_id,
        'current_revision',p_revision,'dependencies',p_dependencies,
        'next_actions',CASE WHEN p_reason='verification_unavailable' THEN jsonb_build_array('retry')
                           WHEN p_reason='stale_revision' THEN jsonb_build_array('reload')
                           ELSE jsonb_build_array('inspect_dependencies') END)
        USING ERRCODE='P0001';
END $$;

CREATE OR REPLACE FUNCTION public.fn_mock_paper_row(p_skill TEXT,p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v JSONB;
BEGIN
    IF p_skill='reading' THEN SELECT to_jsonb(t) INTO v FROM public.reading_tests t WHERE id=p_id;
    ELSIF p_skill='listening' THEN SELECT to_jsonb(t) INTO v FROM public.listening_tests t WHERE id=p_id;
    ELSE RAISE EXCEPTION 'unsupported_mock_paper_skill'; END IF;
    RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.fn_mock_section_valid(p_skill TEXT,p_exam JSONB,p_sitting JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_started TIMESTAMPTZ; v_duration NUMERIC; v_test JSONB;
BEGIN
    IF p_sitting->>'status'='void' OR p_sitting->>(p_skill||'_submitted_at') IS NOT NULL
       OR p_exam->>'status'<>'published' THEN RETURN FALSE; END IF;
    IF p_exam->>'exam_mode'='retake' THEN
        IF NOT COALESCE((p_sitting->'assigned_skills') ? p_skill,FALSE) THEN RETURN FALSE; END IF;
        v_started:=NULLIF(p_sitting->>(p_skill||'_started_at'),'')::TIMESTAMPTZ;
    ELSE
        IF p_exam->>'active_section'<>p_skill OR p_exam->>'collected_section'=p_skill THEN RETURN FALSE; END IF;
        v_started:=NULLIF(p_exam->>(p_skill||'_started_at'),'')::TIMESTAMPTZ;
    END IF;
    IF v_started IS NULL OR v_started>clock_timestamp() THEN RETURN FALSE; END IF;
    IF p_skill='reading' THEN v_duration:=COALESCE((p_exam->>'reading_minutes')::NUMERIC,60)*60;
    ELSE
        v_test:=public.fn_mock_paper_row('listening',(p_exam->>'listening_test_id')::UUID);
        v_duration:=COALESCE(NULLIF(v_test->>'full_audio_duration_seconds','')::NUMERIC,1800)+120;
    END IF;
    RETURN v_duration>0 AND clock_timestamp() <= v_started+make_interval(secs=>v_duration::DOUBLE PRECISION);
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    RETURN FALSE;
END $$;

CREATE OR REPLACE FUNCTION public.fn_mock_paper_dependencies(p_skill TEXT,p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_out JSONB:='[]'; e RECORD; s RECORD; a RECORD; v_reason TEXT; v_paper JSONB; v_dependency_revision TEXT;
        v_sitting JSONB; v_exam JSONB;
BEGIN
    v_paper:=public.fn_mock_paper_row(p_skill,p_id);
    IF v_paper IS NULL THEN RETURN v_out; END IF;
    FOR e IN SELECT to_jsonb(m) row FROM public.mock_exams m
        WHERE CASE WHEN p_skill='reading' THEN m.reading_test_id ELSE m.listening_test_id END=p_id
        ORDER BY m.id LOOP
        SELECT md5((e.row-ARRAY['updated_at','is_open','active_section','collected_section','reading_started_at','listening_started_at','writing_started_at'])::TEXT || COALESCE(jsonb_agg(to_jsonb(x)-ARRAY['created_at','updated_at'] ORDER BY x.id)::TEXT,'[]')) INTO v_dependency_revision FROM public.mock_exam_assignments x WHERE x.exam_id=(e.row->>'id')::UUID;
        v_reason:=NULL;
        IF e.row->>'status'='draft' THEN v_reason:='planned_reservation';
        ELSIF e.row->>'status'='published' THEN
            IF e.row->>'exam_mode'='retake' THEN
                IF EXISTS(SELECT 1 FROM public.mock_exam_assignments x
                    WHERE x.exam_id=(e.row->>'id')::UUID AND p_skill=ANY(x.skills)
                      AND (x.open_until IS NULL OR x.open_until>=clock_timestamp()))
                THEN v_reason:='future_admission'; END IF;
            ELSIF e.row->>'active_section' IS NULL OR (e.row->>'active_section' IN ('reading','listening') AND e.row->>(e.row->>'active_section'||'_started_at') IS NULL) THEN v_reason:='verification_unavailable';
            ELSIF e.row->>'active_section'<>'done' THEN v_reason:='future_admission'; END IF;
        ELSIF e.row->>'status' IS NULL THEN v_reason:='verification_unavailable'; END IF;
        IF v_reason IS NOT NULL THEN v_out:=v_out||jsonb_build_array(jsonb_build_object(
            'type','mock_exam','id',e.row->>'id','code',e.row->>'code','reason',v_reason,
            'paper_revision',v_paper->'mock_content_revision','dependency_revision',v_dependency_revision)); END IF;
        FOR s IN SELECT to_jsonb(ms) row FROM public.mock_exam_sittings ms
            WHERE mock_exam_id=(e.row->>'id')::UUID AND status<>'void' LOOP
            IF public.fn_mock_section_valid(p_skill,e.row,s.row) THEN
                v_out:=v_out||jsonb_build_array(jsonb_build_object('type','mock_sitting',
                    'id',s.row->>'id','mock_exam_id',e.row->>'id','reason','valid_resume',
                    'paper_revision',v_paper->'mock_content_revision','dependency_revision',v_dependency_revision));
            END IF;
        END LOOP;
    END LOOP;
    FOR a IN SELECT id,title FROM public.class_assignments
        WHERE skill=p_skill AND content_id=p_id AND status='published'
          AND (due_at IS NULL OR due_at>=clock_timestamp()) ORDER BY id LOOP
        v_out:=v_out||jsonb_build_array(jsonb_build_object('type','class_assignment',
            'id',a.id,'title',a.title,'reason','future_admission'));
    END LOOP;
    FOR a IN
        SELECT id,user_id,sitting_id,resume_expires_at FROM public.reading_test_attempts
            WHERE p_skill='reading' AND test_id=p_id AND status='in_progress'
              AND (resume_expires_at IS NULL OR resume_expires_at>clock_timestamp())
        UNION ALL SELECT id,user_id,sitting_id,resume_expires_at FROM public.listening_test_attempts
            WHERE p_skill='listening' AND test_id=p_id AND status='in_progress'
              AND (resume_expires_at IS NULL OR resume_expires_at>clock_timestamp()) ORDER BY id LOOP
        v_reason:=CASE WHEN a.resume_expires_at IS NULL THEN 'verification_unavailable' ELSE 'valid_resume' END;
        v_sitting:=NULL; v_exam:=NULL; v_dependency_revision:=NULL;
        IF a.sitting_id IS NOT NULL THEN
            SELECT to_jsonb(ms) INTO v_sitting FROM public.mock_exam_sittings ms WHERE id=a.sitting_id;
            SELECT to_jsonb(m) INTO v_exam FROM public.mock_exams m WHERE id=(v_sitting->>'mock_exam_id')::UUID;
            IF v_sitting IS NULL OR v_exam IS NULL THEN v_reason:='verification_unavailable';
            ELSIF v_sitting->>'user_id' IS DISTINCT FROM a.user_id::TEXT
               OR v_sitting->>(p_skill||'_attempt_id') IS DISTINCT FROM a.id::TEXT
               OR v_exam->>(p_skill||'_test_id') IS DISTINCT FROM p_id::TEXT
               OR NOT public.fn_mock_section_valid(p_skill,v_exam,v_sitting) THEN v_reason:='ambiguous_orphan'; END IF;
            SELECT md5((v_exam-ARRAY['updated_at','is_open','active_section','collected_section','reading_started_at','listening_started_at','writing_started_at'])::TEXT || COALESCE(jsonb_agg(to_jsonb(x)-ARRAY['created_at','updated_at'] ORDER BY x.id)::TEXT,'[]')) INTO v_dependency_revision FROM public.mock_exam_assignments x WHERE x.exam_id=(v_exam->>'id')::UUID;
        END IF;
        v_out:=v_out||jsonb_build_array(jsonb_build_object('type','attempt','id',a.id,'reason',v_reason,
            'mock_exam_id',v_exam->>'id','paper_revision',v_paper->'mock_content_revision','dependency_revision',v_dependency_revision));
    END LOOP;
    RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.fn_mock_protected_references(p_dependencies JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('mock_exam_id',id,'paper_revision',revision,'dependency_revision',dependency_revision) ORDER BY id),'[]')
    FROM (SELECT DISTINCT COALESCE(d->>'mock_exam_id',d->>'id') id,d->'paper_revision' revision,d->>'dependency_revision' dependency_revision
          FROM jsonb_array_elements(p_dependencies) d WHERE d->>'type' IN ('mock_exam','mock_sitting') OR d->>'mock_exam_id' IS NOT NULL) x;
$$;

CREATE OR REPLACE FUNCTION public.fn_mock_overlap_valid(p_paper JSONB,p_dependencies JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
    SELECT jsonb_typeof(p_paper->'approved_public_overlap')='object'
       AND COALESCE(length(p_paper->'approved_public_overlap'->>'reason'),0)>0
       AND p_paper->'approved_public_overlap'->>'actor_id' IS NOT NULL
       AND p_paper->'approved_public_overlap'->'references'=public.fn_mock_protected_references(p_dependencies)
       AND p_paper->'approved_public_overlap'->'paper_revision'=p_paper->'mock_content_revision';
$$;

CREATE OR REPLACE FUNCTION public.fn_mock_public_practice_allowed(p_skill TEXT,p_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v JSONB; d JSONB;
BEGIN
    PERFORM public.fn_lock_mock_paper(p_skill,p_id);
    v:=public.fn_mock_paper_row(p_skill,p_id);
    IF v IS NULL OR v->>'status'<>'published' OR NOT COALESCE((v->>'is_public')::BOOLEAN,FALSE) THEN RETURN FALSE; END IF;
    d:=public.fn_mock_paper_dependencies(p_skill,p_id);
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(d) x WHERE x->>'reason' IN ('verification_unavailable','ambiguous_orphan')) THEN RETURN FALSE; END IF;
    RETURN public.fn_mock_protected_references(d)='[]'::JSONB OR COALESCE(public.fn_mock_overlap_valid(v,d),FALSE);
END $$;

CREATE OR REPLACE VIEW public.reading_public_practice_catalog WITH (security_barrier=true) AS
    SELECT t.* FROM public.reading_tests t WHERE public.fn_mock_public_practice_allowed('reading',t.id);
CREATE OR REPLACE VIEW public.listening_public_practice_catalog WITH (security_barrier=true) AS
    SELECT t.* FROM public.listening_tests t WHERE public.fn_mock_public_practice_allowed('listening',t.id);
REVOKE ALL ON public.reading_public_practice_catalog,public.listening_public_practice_catalog FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.reading_public_practice_catalog,public.listening_public_practice_catalog TO service_role;

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
    IF p_user_id IS NOT NULL AND p_purpose='delivery' AND NOT p_allow_admission
       AND public.fn_mock_protected_references(d)='[]'::JSONB THEN
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

CREATE OR REPLACE FUNCTION public.fn_mock_policy_snapshot(p_row JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
    SELECT jsonb_build_object('snapshot_contract','mock-paper-policy/1',
        'status',p_row->'status','is_public',p_row->'is_public','exam_only',p_row->'exam_only',
        'public_practice_enabled',p_row->'public_practice_enabled',
        'web_explanation_mode',p_row->'web_explanation_mode',
        'web_explanation_content_version',p_row->'web_explanation_content_version',
        'web_explanations_released_at',p_row->'web_explanations_released_at',
        'web_explanations_released_by',p_row->'web_explanations_released_by',
        'approved_public_overlap',p_row->'approved_public_overlap','policy_revision',p_row->'policy_revision');
$$;

CREATE OR REPLACE FUNCTION public.fn_guard_mock_paper_policy()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE k TEXT:=CASE WHEN TG_TABLE_NAME='reading_tests' THEN 'reading' ELSE 'listening' END;
        b JSONB:=to_jsonb(OLD); n JSONB; d JSONB; r BIGINT; v_changed BOOLEAN;
BEGIN
    PERFORM public.fn_lock_mock_paper(k,OLD.id);
    d:=public.fn_mock_paper_dependencies(k,OLD.id); r:=OLD.policy_revision;
    IF TG_OP='DELETE' THEN
        IF jsonb_array_length(d)>0 THEN PERFORM public.fn_mock_paper_error('delete','protected_dependency',k,OLD.id,r,d); END IF;
        IF (k='reading' AND EXISTS(SELECT 1 FROM public.reading_test_attempts WHERE test_id=OLD.id))
           OR (k='listening' AND EXISTS(SELECT 1 FROM public.listening_test_attempts WHERE test_id=OLD.id)) THEN
            PERFORM public.fn_mock_paper_error('delete','history_preservation',k,OLD.id,r);
        END IF;
        RETURN OLD;
    END IF;
    n:=to_jsonb(NEW);
    -- Source-field changes invalidate overlap grants without changing their
    -- old approval record or any historical attempt.
    IF (n-ARRAY['policy_revision','mock_content_revision','approved_public_overlap','updated_at',
               'status','is_public','exam_only','public_practice_enabled','web_explanation_mode',
               'web_explanation_content_version','web_explanations_released_at','web_explanations_released_by'])
       IS DISTINCT FROM
       (b-ARRAY['policy_revision','mock_content_revision','approved_public_overlap','updated_at',
               'status','is_public','exam_only','public_practice_enabled','web_explanation_mode',
               'web_explanation_content_version','web_explanations_released_at','web_explanations_released_by']) THEN
        NEW.mock_content_revision:=OLD.mock_content_revision+1; n:=to_jsonb(NEW);
    END IF;
    v_changed:=public.fn_mock_policy_snapshot(b) IS DISTINCT FROM public.fn_mock_policy_snapshot(n);
    IF NEW.status<>'published' AND OLD.status='published' AND jsonb_array_length(d)>0 THEN
        PERFORM public.fn_mock_paper_error('status',CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(d) x
            WHERE x->>'reason'='verification_unavailable') THEN 'verification_unavailable' ELSE 'protected_dependency' END,k,OLD.id,r,d);
    END IF;
    IF (NEW.is_public IS TRUE AND OLD.is_public IS DISTINCT FROM TRUE)
       OR (NEW.public_practice_enabled IS TRUE AND OLD.public_practice_enabled IS DISTINCT FROM TRUE)
       OR NEW.approved_public_overlap IS DISTINCT FROM OLD.approved_public_overlap THEN
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(d) x WHERE x->>'reason' IN ('verification_unavailable','ambiguous_orphan')) THEN
            PERFORM public.fn_mock_paper_error('visibility',CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(d) x WHERE x->>'reason'='verification_unavailable') THEN 'verification_unavailable' ELSE 'ambiguous_orphan' END,k,OLD.id,r,d);
        END IF;
        IF public.fn_mock_protected_references(d)<>'[]'::JSONB AND NOT COALESCE(public.fn_mock_overlap_valid(n,d),FALSE) THEN
            PERFORM public.fn_mock_paper_error('visibility','public_overlap_unapproved',k,OLD.id,r,d);
        END IF;
    END IF;
    IF NEW.approved_public_overlap IS DISTINCT FROM OLD.approved_public_overlap AND NEW.approved_public_overlap IS NOT NULL AND current_setting('mock_paper.overlap',TRUE) IS DISTINCT FROM 'approved' THEN
        PERFORM public.fn_mock_paper_error('approve_overlap','explicit_decision_required',k,OLD.id,r,d);
    END IF;
    IF v_changed THEN
        NEW.policy_revision:=OLD.policy_revision+1;
        INSERT INTO public.mock_correction_release_events(scope_type,scope_id,action,previous_state,new_state,actor_id,reason)
        VALUES(k||'_test',OLD.id::TEXT,'mock_paper_policy_updated',public.fn_mock_policy_snapshot(b),
            public.fn_mock_policy_snapshot(to_jsonb(NEW)),
            NULLIF(current_setting('mock_paper.actor',TRUE),'')::UUID,
            COALESCE(NULLIF(current_setting('mock_paper.operation',TRUE),''),'legacy_writer'));
    ELSE NEW.policy_revision:=OLD.policy_revision; END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_mock_paper_policy ON public.reading_tests;
CREATE TRIGGER trg_mock_paper_policy BEFORE UPDATE OR DELETE ON public.reading_tests
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_mock_paper_policy();
DROP TRIGGER IF EXISTS trg_mock_paper_policy ON public.listening_tests;
CREATE TRIGGER trg_mock_paper_policy BEFORE UPDATE OR DELETE ON public.listening_tests
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_mock_paper_policy();

CREATE OR REPLACE FUNCTION public.fn_mutate_mock_paper_policy(
    p_skill TEXT,p_test_id UUID,p_patch JSONB,p_actor_id UUID,
    p_expected_revision BIGINT DEFAULT NULL,p_overlap JSONB DEFAULT NULL,p_snapshot_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v JSONB; patch JSONB:=COALESCE(p_patch,'{}'); d JSONB; restored JSONB; v_result JSONB; approval JSONB;
        v_fields TEXT[]:=ARRAY['status','is_public','exam_only','public_practice_enabled','web_explanation_mode',
            'web_explanation_content_version','web_explanations_released_at','web_explanations_released_by','approved_public_overlap'];
BEGIN
    PERFORM public.fn_lock_mock_paper(p_skill,p_test_id);
    v:=public.fn_mock_paper_row(p_skill,p_test_id);
    IF v IS NULL THEN RAISE EXCEPTION 'public_test_not_found'; END IF;
    IF p_expected_revision IS NOT NULL AND p_expected_revision<>(v->>'policy_revision')::BIGINT THEN
        PERFORM public.fn_mock_paper_error('policy_update','stale_revision',p_skill,p_test_id,(v->>'policy_revision')::BIGINT);
    END IF;
    IF p_snapshot_id IS NOT NULL THEN
        IF p_expected_revision IS NULL THEN
            PERFORM public.fn_mock_paper_error('restore','expected_revision_required',p_skill,p_test_id,(v->>'policy_revision')::BIGINT);
        END IF;
        SELECT previous_state INTO restored FROM public.mock_correction_release_events
            WHERE id=p_snapshot_id AND scope_type=p_skill||'_test' AND scope_id=p_test_id::TEXT
              AND action='mock_paper_policy_updated' AND previous_state->>'snapshot_contract'='mock-paper-policy/1';
        IF restored IS NULL OR NOT restored ?& v_fields THEN
            PERFORM public.fn_mock_paper_error('restore','unknown_baseline',p_skill,p_test_id,(v->>'policy_revision')::BIGINT);
        END IF;
        patch:=restored-'policy_revision'-'snapshot_contract';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(patch) key WHERE NOT key=ANY(v_fields)) THEN
        RAISE EXCEPTION 'invalid_mock_paper_policy_field';
    END IF;
    d:=public.fn_mock_paper_dependencies(p_skill,p_test_id);
    IF p_overlap IS NOT NULL THEN
        IF p_expected_revision IS NULL OR p_actor_id IS NULL
           OR COALESCE(length(p_overlap->>'reason'),0)=0
           OR p_overlap->'references' IS DISTINCT FROM public.fn_mock_protected_references(d)
           OR p_overlap->'paper_revision' IS DISTINCT FROM v->'mock_content_revision' THEN
            PERFORM public.fn_mock_paper_error('approve_overlap','stale_revision',p_skill,p_test_id,(v->>'policy_revision')::BIGINT,d);
        END IF;
        patch:=patch||jsonb_build_object('approved_public_overlap',p_overlap||jsonb_build_object('actor_id',p_actor_id,
            'approved_at',clock_timestamp(),'expected_policy_revision',p_expected_revision));
    END IF;
    PERFORM set_config('mock_paper.overlap',CASE WHEN p_overlap IS NOT NULL OR p_snapshot_id IS NOT NULL THEN 'approved' ELSE '' END,TRUE);
    PERFORM set_config('mock_paper.actor',COALESCE(p_actor_id::TEXT,''),TRUE);
    PERFORM set_config('mock_paper.operation',CASE WHEN p_snapshot_id IS NOT NULL THEN 'restore' ELSE 'policy_update' END,TRUE);
    IF (patch?'web_explanation_mode' OR patch?'web_explanation_content_version' OR patch?'web_explanations_released_at')
       AND COALESCE(patch->>'web_explanation_mode',v->>'web_explanation_mode','disabled')<>'disabled' THEN
        approval:=public.fn_approve_web_explanation_paper(p_skill,p_test_id,p_actor_id,
            COALESCE(patch->>'web_explanation_content_version',v->>'web_explanation_content_version'),'restored_or_updated_paper_policy');
        patch:=patch||jsonb_build_object('web_explanation_content_version',approval->>'content_version');
    END IF;
    IF p_skill='reading' THEN
        UPDATE public.reading_tests t SET
            status=CASE WHEN patch?'status' THEN patch->>'status' ELSE t.status END,
            is_public=CASE WHEN patch?'is_public' THEN (patch->>'is_public')::BOOLEAN ELSE t.is_public END,
            exam_only=CASE WHEN patch?'exam_only' THEN (patch->>'exam_only')::BOOLEAN ELSE t.exam_only END,
            public_practice_enabled=CASE WHEN patch?'public_practice_enabled' THEN (patch->>'public_practice_enabled')::BOOLEAN ELSE t.public_practice_enabled END,
            web_explanation_mode=CASE WHEN patch?'web_explanation_mode' THEN patch->>'web_explanation_mode' ELSE t.web_explanation_mode END,
            web_explanation_content_version=CASE WHEN patch?'web_explanation_content_version' THEN patch->>'web_explanation_content_version' ELSE t.web_explanation_content_version END,
            web_explanations_released_at=CASE WHEN patch?'web_explanations_released_at' THEN (patch->>'web_explanations_released_at')::TIMESTAMPTZ ELSE t.web_explanations_released_at END,
            web_explanations_released_by=CASE WHEN patch?'web_explanations_released_by' THEN (patch->>'web_explanations_released_by')::UUID ELSE t.web_explanations_released_by END,
            approved_public_overlap=CASE WHEN patch?'approved_public_overlap' THEN NULLIF(patch->'approved_public_overlap','null'::JSONB) ELSE t.approved_public_overlap END
        WHERE id=p_test_id RETURNING to_jsonb(t) INTO v_result;
    ELSE
        UPDATE public.listening_tests t SET
            status=CASE WHEN patch?'status' THEN patch->>'status' ELSE t.status END,
            is_public=CASE WHEN patch?'is_public' THEN (patch->>'is_public')::BOOLEAN ELSE t.is_public END,
            exam_only=CASE WHEN patch?'exam_only' THEN (patch->>'exam_only')::BOOLEAN ELSE t.exam_only END,
            public_practice_enabled=CASE WHEN patch?'public_practice_enabled' THEN (patch->>'public_practice_enabled')::BOOLEAN ELSE t.public_practice_enabled END,
            web_explanation_mode=CASE WHEN patch?'web_explanation_mode' THEN patch->>'web_explanation_mode' ELSE t.web_explanation_mode END,
            web_explanation_content_version=CASE WHEN patch?'web_explanation_content_version' THEN patch->>'web_explanation_content_version' ELSE t.web_explanation_content_version END,
            web_explanations_released_at=CASE WHEN patch?'web_explanations_released_at' THEN (patch->>'web_explanations_released_at')::TIMESTAMPTZ ELSE t.web_explanations_released_at END,
            web_explanations_released_by=CASE WHEN patch?'web_explanations_released_by' THEN (patch->>'web_explanations_released_by')::UUID ELSE t.web_explanations_released_by END,
            approved_public_overlap=CASE WHEN patch?'approved_public_overlap' THEN NULLIF(patch->'approved_public_overlap','null'::JSONB) ELSE t.approved_public_overlap END
        WHERE id=p_test_id RETURNING to_jsonb(t) INTO v_result;
    END IF;
    RETURN v_result;
EXCEPTION WHEN deadlock_detected OR lock_not_available THEN
    PERFORM public.fn_mock_paper_error('policy_update','verification_unavailable',p_skill,p_test_id,NULL);
END $$;

-- Forward replacement retains the approved atomic explanation contract.
CREATE OR REPLACE FUNCTION public.fn_update_public_test_explanation_policy(
    p_skill TEXT,
    p_test_id UUID,
    p_patch JSONB,
    p_actor_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_patch JSONB := COALESCE(p_patch, '{}'::JSONB);
    v_before JSONB;
    v_result JSONB;
    v_mode TEXT;
    v_version TEXT;
    v_released_at TIMESTAMPTZ;
    v_released_by UUID;
    v_approval JSONB;
    v_enabling BOOLEAN;
BEGIN
    PERFORM public.fn_lock_mock_paper(p_skill,p_test_id);
    PERFORM set_config('mock_paper.actor',COALESCE(p_actor_id::TEXT,''),TRUE);
    PERFORM set_config('mock_paper.operation','explanation_policy_update',TRUE);
    IF p_skill NOT IN ('reading', 'listening') THEN
        RAISE EXCEPTION 'unsupported_public_explanation_skill';
    END IF;

    IF p_skill = 'reading' THEN
        SELECT TO_JSONB(t.*)
          INTO v_before
          FROM public.reading_tests AS t
         WHERE t.id = p_test_id
         FOR UPDATE;
    ELSE
        SELECT TO_JSONB(t.*)
          INTO v_before
          FROM public.listening_tests AS t
         WHERE t.id = p_test_id
         FOR UPDATE;
    END IF;

    IF v_before IS NULL THEN
        RAISE EXCEPTION 'public_test_not_found';
    END IF;
    IF v_patch ? 'expected_revision' AND (v_patch->>'expected_revision')::BIGINT <> (v_before->>'policy_revision')::BIGINT THEN
        PERFORM public.fn_mock_paper_error('explanation_policy_update','stale_revision',p_skill,p_test_id,(v_before->>'policy_revision')::BIGINT);
    END IF;

    v_mode := CASE
        WHEN v_patch ? 'web_explanation_mode'
            THEN v_patch ->> 'web_explanation_mode'
        ELSE COALESCE(v_before ->> 'web_explanation_mode', 'disabled')
    END;
    IF v_mode NOT IN ('disabled', 'immediate_after_capture', 'admin_release') THEN
        RAISE EXCEPTION 'invalid_public_explanation_mode';
    END IF;

    v_version := COALESCE(
        NULLIF(v_patch ->> 'web_explanation_content_version', ''),
        NULLIF(v_before ->> 'web_explanation_content_version', '')
    );
    v_enabling := v_mode <> 'disabled' AND (
           v_patch ? 'web_explanation_mode'
        OR COALESCE((v_patch ->> 'public_practice_enabled')::BOOLEAN, FALSE)
        OR COALESCE((v_patch ->> 'release_now')::BOOLEAN, FALSE)
    );

    IF v_enabling THEN
        v_approval := public.fn_approve_web_explanation_paper(
            p_skill,
            p_test_id,
            p_actor_id,
            v_version,
            'enabled_for_public_practice'
        );
        v_version := v_approval ->> 'content_version';
    END IF;

    v_released_at := NULLIF(v_before ->> 'web_explanations_released_at', '')::TIMESTAMPTZ;
    v_released_by := NULLIF(v_before ->> 'web_explanations_released_by', '')::UUID;
    IF COALESCE((v_patch ->> 'release_now')::BOOLEAN, FALSE) THEN
        v_released_at := NOW();
        v_released_by := p_actor_id;
    ELSIF v_mode = 'admin_release' AND (
           COALESCE(v_before ->> 'web_explanation_mode', 'disabled') <> 'admin_release'
        OR v_version IS DISTINCT FROM NULLIF(
            v_before ->> 'web_explanation_content_version', ''
        )
    ) THEN
        v_released_at := NULL;
        v_released_by := NULL;
    END IF;

    IF p_skill = 'reading' THEN
        UPDATE public.reading_tests AS t
           SET is_public = CASE
                   WHEN v_patch ? 'is_public'
                       THEN (v_patch ->> 'is_public')::BOOLEAN
                   ELSE t.is_public
               END,
               exam_only = CASE
                   WHEN v_patch ? 'exam_only' THEN (v_patch ->> 'exam_only')::BOOLEAN
                   ELSE t.exam_only
               END,
               public_practice_enabled = CASE
                   WHEN v_patch ? 'public_practice_enabled'
                       THEN (v_patch ->> 'public_practice_enabled')::BOOLEAN
                   ELSE t.public_practice_enabled
               END,
               web_explanation_mode = v_mode,
               web_explanation_content_version = v_version,
               web_explanations_released_at = v_released_at,
               web_explanations_released_by = v_released_by
         WHERE t.id = p_test_id
         RETURNING TO_JSONB(t.*) INTO v_result;
    ELSE
        UPDATE public.listening_tests AS t
           SET is_public = CASE
                   WHEN v_patch ? 'is_public'
                       THEN (v_patch ->> 'is_public')::BOOLEAN
                   ELSE t.is_public
               END,
               exam_only = CASE
                   WHEN v_patch ? 'exam_only' THEN (v_patch ->> 'exam_only')::BOOLEAN
                   ELSE t.exam_only
               END,
               public_practice_enabled = CASE
                   WHEN v_patch ? 'public_practice_enabled'
                       THEN (v_patch ->> 'public_practice_enabled')::BOOLEAN
                   ELSE t.public_practice_enabled
               END,
               web_explanation_mode = v_mode,
               web_explanation_content_version = v_version,
               web_explanations_released_at = v_released_at,
               web_explanations_released_by = v_released_by
         WHERE t.id = p_test_id
         RETURNING TO_JSONB(t.*) INTO v_result;
    END IF;

    INSERT INTO public.mock_correction_release_events (
        scope_type, scope_id, action, previous_state, new_state, actor_id
    ) VALUES (
        p_skill || '_test',
        p_test_id::TEXT,
        'public_policy_updated',
        JSONB_BUILD_OBJECT(
            'is_public', v_before -> 'is_public',
            'public_practice_enabled', v_before -> 'public_practice_enabled',
            'web_explanation_mode', v_before -> 'web_explanation_mode',
            'web_explanations_released_at',
                v_before -> 'web_explanations_released_at',
            'web_explanation_content_version',
                v_before -> 'web_explanation_content_version'
        ),
        JSONB_BUILD_OBJECT(
            'is_public', v_result -> 'is_public',
            'public_practice_enabled', v_result -> 'public_practice_enabled',
            'web_explanation_mode', v_result -> 'web_explanation_mode',
            'web_explanations_released_at',
                v_result -> 'web_explanations_released_at',
            'web_explanation_content_version',
                v_result -> 'web_explanation_content_version'
        ),
        p_actor_id
    );

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_update_public_test_explanation_policy(
    TEXT, UUID, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_public_test_explanation_policy(
    TEXT, UUID, JSONB, UUID
) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_update_mock_exam_with_explanation_approval(
    p_exam_id UUID,
    p_patch JSONB,
    p_actor_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_exam public.mock_exams%ROWTYPE;
    v_mode TEXT;
    v_reading_id UUID;
    v_listening_id UUID;
    v_version TEXT;
    v_approval JSONB;
    v_result JSONB;
    v_updated INTEGER;
    v_previous_policy JSONB;
    v_next_released_at TIMESTAMPTZ;
    v_next_released_by UUID;
    v_before JSONB;
    v_lock RECORD;
BEGIN
    SELECT to_jsonb(m) INTO v_before FROM public.mock_exams m WHERE id=p_exam_id;
    FOR v_lock IN SELECT DISTINCT ref->>'skill' skill,ref->>'id' id FROM jsonb_array_elements(jsonb_build_array(
        jsonb_build_object('skill','reading','id',v_before->>'reading_test_id'),
        jsonb_build_object('skill','listening','id',v_before->>'listening_test_id'),
        jsonb_build_object('skill','reading','id',p_patch->>'reading_test_id'),
        jsonb_build_object('skill','listening','id',p_patch->>'listening_test_id'))) ref
        WHERE NULLIF(ref->>'id','') IS NOT NULL ORDER BY skill,id LOOP
        PERFORM public.fn_lock_mock_paper(v_lock.skill,v_lock.id::UUID);
    END LOOP;
    PERFORM set_config('mock_paper.actor',COALESCE(p_actor_id::TEXT,''),TRUE);
    PERFORM set_config('mock_paper.operation','mock_policy_update',TRUE);
    SELECT * INTO v_exam
      FROM public.mock_exams
     WHERE id = p_exam_id
     FOR UPDATE NOWAIT;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'mock_exam_not_found';
    END IF;
    IF v_before->>'reading_test_id' IS DISTINCT FROM v_exam.reading_test_id::TEXT
       OR v_before->>'listening_test_id' IS DISTINCT FROM v_exam.listening_test_id::TEXT THEN
        PERFORM public.fn_mock_paper_error('mock_policy_update','verification_unavailable','reading',v_exam.reading_test_id,NULL);
    END IF;

    v_mode := CASE WHEN p_patch ? 'web_explanation_mode'
        THEN p_patch ->> 'web_explanation_mode'
        ELSE v_exam.web_explanation_mode END;
    v_reading_id := CASE WHEN p_patch ? 'reading_test_id'
        THEN NULLIF(p_patch ->> 'reading_test_id', '')::UUID
        ELSE v_exam.reading_test_id END;
    v_listening_id := CASE WHEN p_patch ? 'listening_test_id'
        THEN NULLIF(p_patch ->> 'listening_test_id', '')::UUID
        ELSE v_exam.listening_test_id END;
    v_version := CASE WHEN p_patch ? 'web_explanation_content_version'
        THEN NULLIF(p_patch ->> 'web_explanation_content_version', '')
        ELSE v_exam.web_explanation_content_version END;

    IF v_mode NOT IN ('disabled', 'with_result', 'admin_release') THEN
        RAISE EXCEPTION 'invalid_mock_explanation_mode';
    END IF;

    v_previous_policy := JSONB_BUILD_OBJECT(
        'web_explanation_mode', v_exam.web_explanation_mode,
        'web_explanations_released_at', v_exam.web_explanations_released_at,
        'web_explanation_content_version', v_exam.web_explanation_content_version,
        'post_test_capture_required', v_exam.post_test_capture_required
    );
    v_next_released_at := v_exam.web_explanations_released_at;
    v_next_released_by := v_exam.web_explanations_released_by;

    IF v_mode <> 'disabled' THEN
        IF v_listening_id IS NOT NULL THEN
            v_approval := public.fn_approve_web_explanation_paper(
                'listening', v_listening_id, p_actor_id, v_version,
                'enabled_for_mock_exam:' || p_exam_id::TEXT
            );
            v_version := v_approval ->> 'content_version';
        END IF;
        IF v_reading_id IS NOT NULL THEN
            v_approval := public.fn_approve_web_explanation_paper(
                'reading', v_reading_id, p_actor_id, v_version,
                'enabled_for_mock_exam:' || p_exam_id::TEXT
            );
            v_version := v_approval ->> 'content_version';
        END IF;
    END IF;

    IF p_patch ? 'reading_is_public' AND v_reading_id IS NOT NULL THEN
        UPDATE public.reading_tests
           SET is_public = (p_patch ->> 'reading_is_public')::BOOLEAN,
               exam_only = exam_only
         WHERE id = v_reading_id;
        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated <> 1 THEN
            RAISE EXCEPTION 'mock_reading_visibility_update_failed';
        END IF;
    END IF;
    IF p_patch ? 'listening_is_public' AND v_listening_id IS NOT NULL THEN
        UPDATE public.listening_tests
           SET is_public = (p_patch ->> 'listening_is_public')::BOOLEAN,
               exam_only = exam_only
         WHERE id = v_listening_id;
        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated <> 1 THEN
            RAISE EXCEPTION 'mock_listening_visibility_update_failed';
        END IF;
    END IF;

    IF COALESCE((p_patch ->> 'release_now')::BOOLEAN, FALSE) THEN
        IF v_mode <> 'admin_release' THEN
            RAISE EXCEPTION 'mock_release_requires_admin_release_mode';
        END IF;
        v_next_released_at := NOW();
        v_next_released_by := p_actor_id;
    ELSIF v_mode = 'admin_release' AND (
        v_exam.web_explanation_mode IS DISTINCT FROM 'admin_release'
        OR v_exam.web_explanation_content_version IS DISTINCT FROM v_version
    ) THEN
        v_next_released_at := NULL;
        v_next_released_by := NULL;
    END IF;

    UPDATE public.mock_exams AS m
       SET code = CASE WHEN p_patch ? 'code' THEN p_patch ->> 'code' ELSE m.code END,
           title = CASE WHEN p_patch ? 'title' THEN p_patch ->> 'title' ELSE m.title END,
           listening_test_id = v_listening_id,
           reading_test_id = v_reading_id,
           writing_task1_prompt_id = CASE WHEN p_patch ? 'writing_task1_prompt_id' THEN NULLIF(p_patch ->> 'writing_task1_prompt_id', '')::UUID ELSE m.writing_task1_prompt_id END,
           writing_task2_prompt_id = CASE WHEN p_patch ? 'writing_task2_prompt_id' THEN NULLIF(p_patch ->> 'writing_task2_prompt_id', '')::UUID ELSE m.writing_task2_prompt_id END,
           speaking_topic_set = CASE WHEN p_patch ? 'speaking_topic_set' THEN p_patch -> 'speaking_topic_set' ELSE m.speaking_topic_set END,
           total_minutes = CASE WHEN p_patch ? 'total_minutes' THEN (p_patch ->> 'total_minutes')::INTEGER ELSE m.total_minutes END,
           reading_minutes = CASE WHEN p_patch ? 'reading_minutes' THEN (p_patch ->> 'reading_minutes')::INTEGER ELSE m.reading_minutes END,
           writing_minutes = CASE WHEN p_patch ? 'writing_minutes' THEN (p_patch ->> 'writing_minutes')::INTEGER ELSE m.writing_minutes END,
           open_from = CASE WHEN p_patch ? 'open_from' THEN NULLIF(p_patch ->> 'open_from', '')::TIMESTAMPTZ ELSE m.open_from END,
           open_until = CASE WHEN p_patch ? 'open_until' THEN NULLIF(p_patch ->> 'open_until', '')::TIMESTAMPTZ ELSE m.open_until END,
           cohort_id = CASE WHEN p_patch ? 'cohort_id' THEN NULLIF(p_patch ->> 'cohort_id', '')::UUID ELSE m.cohort_id END,
           review_sla_days = CASE WHEN p_patch ? 'review_sla_days' THEN (p_patch ->> 'review_sla_days')::INTEGER ELSE m.review_sla_days END,
           status = CASE WHEN p_patch ? 'status' THEN p_patch ->> 'status' ELSE m.status END,
           web_explanation_mode = v_mode,
           web_explanation_content_version = v_version,
           web_explanations_released_at = v_next_released_at,
           web_explanations_released_by = v_next_released_by,
           post_test_capture_required = CASE WHEN p_patch ? 'post_test_capture_required' THEN (p_patch ->> 'post_test_capture_required')::BOOLEAN ELSE m.post_test_capture_required END
     WHERE m.id = p_exam_id
     RETURNING TO_JSONB(m.*) INTO v_result;

    INSERT INTO public.mock_correction_release_events (
        scope_type, scope_id, action, previous_state, new_state, actor_id
    ) VALUES (
        'mock_exam', p_exam_id::TEXT, 'policy_updated', v_previous_policy,
        JSONB_BUILD_OBJECT(
            'web_explanation_mode', v_mode,
            'web_explanations_released_at', v_next_released_at,
            'web_explanation_content_version', v_version,
            'post_test_capture_required',
                COALESCE((v_result ->> 'post_test_capture_required')::BOOLEAN, TRUE)
        ),
        p_actor_id
    );

    RETURN v_result;
EXCEPTION WHEN deadlock_detected OR lock_not_available THEN
    PERFORM public.fn_mock_paper_error('mock_policy_update','verification_unavailable','reading',v_exam.reading_test_id,NULL);
END;
$$;

-- Explicit visibility commands, the draft link and explanation approval are
-- one transaction. A failed approval cannot leave a hidden or orphaned paper.
CREATE OR REPLACE FUNCTION public.fn_create_mock_exam_with_paper_policy(p_payload JSONB,p_actor_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row JSONB; v_patch JSONB; v_columns TEXT; v_select TEXT; v_exam JSONB; v_lock RECORD;
BEGIN
    v_row:=p_payload-ARRAY['reading_is_public','listening_is_public','web_explanation_content_version'];
    v_row:=v_row||jsonb_build_object('created_by',p_actor_id,'web_explanation_mode','disabled');
    FOR v_lock IN SELECT ref->>'skill' skill,ref->>'id' id FROM jsonb_array_elements(jsonb_build_array(
        jsonb_build_object('skill','reading','id',p_payload->>'reading_test_id'),
        jsonb_build_object('skill','listening','id',p_payload->>'listening_test_id'))) ref
        WHERE NULLIF(ref->>'id','') IS NOT NULL ORDER BY skill,id LOOP
        PERFORM public.fn_lock_mock_paper(v_lock.skill,v_lock.id::UUID);
        IF p_payload ? (v_lock.skill||'_is_public') AND p_payload->>(v_lock.skill||'_is_public')='false' THEN
            PERFORM public.fn_mutate_mock_paper_policy(v_lock.skill,v_lock.id::UUID,'{"is_public":false}',p_actor_id,NULL,NULL,NULL);
        END IF;
    END LOOP;
    SELECT string_agg(format('%I',key),',' ORDER BY key),string_agg(format('r.%I',key),',' ORDER BY key)
      INTO v_columns,v_select FROM jsonb_object_keys(v_row) key
      WHERE key=ANY(ARRAY['code','title','reading_test_id','listening_test_id','writing_task1_prompt_id','writing_task2_prompt_id',
          'speaking_topic_set','total_minutes','reading_minutes','writing_minutes','open_from','open_until','cohort_id',
          'review_sla_days','status','web_explanation_mode','post_test_capture_required','created_by','exam_mode']);
    EXECUTE format('INSERT INTO public.mock_exams(%s) SELECT %s FROM jsonb_populate_record(NULL::public.mock_exams,$1) r RETURNING to_jsonb(mock_exams)',v_columns,v_select)
        INTO v_exam USING v_row;
    v_patch:=jsonb_build_object('web_explanation_mode',COALESCE(p_payload->>'web_explanation_mode','with_result'),
        'web_explanation_content_version',p_payload->'web_explanation_content_version');
    IF p_payload?'reading_is_public' THEN v_patch:=v_patch||jsonb_build_object('reading_is_public',p_payload->'reading_is_public'); END IF;
    IF p_payload?'listening_is_public' THEN v_patch:=v_patch||jsonb_build_object('listening_is_public',p_payload->'listening_is_public'); END IF;
    RETURN public.fn_update_mock_exam_with_explanation_approval((v_exam->>'id')::UUID,v_patch,p_actor_id);
EXCEPTION WHEN deadlock_detected OR lock_not_available THEN
    PERFORM public.fn_mock_paper_error('mock_create','verification_unavailable','reading',NULLIF(p_payload->>'reading_test_id','')::UUID,NULL);
END $$;

REVOKE ALL ON FUNCTION public.fn_update_mock_exam_with_explanation_approval(
    UUID, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_mock_exam_with_explanation_approval(
    UUID, JSONB, UUID
) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_guard_mock_paper_source()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b JSONB:=CASE WHEN TG_OP='INSERT' THEN '{}'::JSONB ELSE to_jsonb(OLD) END;
        n JSONB:=CASE WHEN TG_OP='DELETE' THEN '{}'::JSONB ELSE to_jsonb(NEW) END;
        refs JSONB:='[]'; x RECORD;
BEGIN
    IF TG_TABLE_NAME='reading_passages' THEN
        refs:=jsonb_build_array(jsonb_build_object('kind','reading','id',b->>'test_id'),jsonb_build_object('kind','reading','id',n->>'test_id'));
    ELSIF TG_TABLE_NAME='reading_questions' THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('kind','reading','id',p.test_id)),'[]') INTO refs
            FROM public.reading_passages p WHERE id IN (NULLIF(b->>'passage_id','')::UUID,NULLIF(n->>'passage_id','')::UUID);
    ELSIF TG_TABLE_NAME='listening_content' THEN
        refs:=jsonb_build_array(jsonb_build_object('kind','listening','id',b->>'test_id'),jsonb_build_object('kind','listening','id',n->>'test_id'));
    ELSIF TG_TABLE_NAME='listening_exercises' THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('kind','listening','id',s.test_id)),'[]') INTO refs
            FROM public.listening_content s WHERE id IN (NULLIF(b->>'content_id','')::UUID,NULLIF(n->>'content_id','')::UUID);
    ELSE
        refs:=jsonb_build_array(jsonb_build_object('kind','reading','id',b->>'reading_test_id'),
            jsonb_build_object('kind','reading','id',n->>'reading_test_id'),
            jsonb_build_object('kind','listening','id',b->>'listening_test_id'),
            jsonb_build_object('kind','listening','id',n->>'listening_test_id'));
    END IF;
    FOR x IN SELECT DISTINCT item->>'kind' kind,item->>'id' id FROM jsonb_array_elements(refs) item
        WHERE item->>'id' IS NOT NULL ORDER BY kind,id LOOP
        PERFORM public.fn_lock_mock_paper(x.kind,x.id::UUID);
        IF n-ARRAY['updated_at'] IS DISTINCT FROM b-ARRAY['updated_at'] THEN
            IF x.kind='reading' THEN UPDATE public.reading_tests SET mock_content_revision=mock_content_revision+1 WHERE id=x.id::UUID;
            ELSE UPDATE public.listening_tests SET mock_content_revision=mock_content_revision+1 WHERE id=x.id::UUID; END IF;
        END IF;
    END LOOP;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
DO $$ DECLARE name TEXT; BEGIN
    FOREACH name IN ARRAY ARRAY['reading_passages','reading_questions','listening_content','listening_exercises','web_explanation_objects'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_mock_paper_source ON public.%I',name);
        EXECUTE format('CREATE TRIGGER trg_mock_paper_source BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_guard_mock_paper_source()',name);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.fn_immutable_mock_paper_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'immutable_mock_paper_snapshot'; END $$;
DROP TRIGGER IF EXISTS trg_immutable_mock_paper_snapshot ON public.mock_paper_attempt_snapshots;
CREATE TRIGGER trg_immutable_mock_paper_snapshot BEFORE UPDATE OR DELETE ON public.mock_paper_attempt_snapshots
    FOR EACH ROW EXECUTE FUNCTION public.fn_immutable_mock_paper_snapshot();

-- Direct Reading answer rows participate in the same boundary as Listening's
-- parent answers JSON; a retained N-1 route cannot bypass purpose checks.
CREATE OR REPLACE FUNCTION public.fn_guard_mock_reading_answer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.reading_test_attempts%ROWTYPE; sitting JSONB; exam JSONB;
BEGIN
    SELECT * INTO a FROM public.reading_test_attempts WHERE id=NEW.attempt_id;
    IF a.sitting_id IS NOT NULL THEN
        PERFORM public.fn_lock_mock_paper('reading',a.test_id);
        SELECT to_jsonb(s) INTO sitting FROM public.mock_exam_sittings s WHERE id=a.sitting_id;
        SELECT to_jsonb(m) INTO exam FROM public.mock_exams m WHERE id=(sitting->>'mock_exam_id')::UUID;
        IF sitting->>'reading_attempt_id' IS DISTINCT FROM a.id::TEXT
           OR NOT public.fn_mock_section_valid('reading',exam,sitting) THEN
            PERFORM public.fn_mock_paper_error('answer_write','invalid_resume','reading',a.test_id,a.policy_revision);
        END IF;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_mock_reading_answer ON public.reading_attempt_answers;
CREATE TRIGGER trg_mock_reading_answer BEFORE INSERT OR UPDATE ON public.reading_attempt_answers
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_mock_reading_answer();

CREATE OR REPLACE FUNCTION public.fn_guard_owned_mock_attempt(p_skill TEXT,p_attempt JSONB,p_purpose TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v JSONB; d JSONB; decision JSONB; sitting JSONB; exam JSONB; pinned JSONB; live_refs JSONB; pinned_refs JSONB;
BEGIN
    PERFORM public.fn_lock_mock_paper(p_skill,(p_attempt->>'test_id')::UUID);
    IF p_attempt->>'status'='submitted' AND p_purpose IN ('flags_read','review') THEN
        RETURN jsonb_build_object('allowed',TRUE);
    END IF;
    IF p_attempt->>'status'<>'in_progress'
       OR p_attempt->>'resume_expires_at' IS NULL
       OR (p_attempt->>'resume_expires_at')::TIMESTAMPTZ<=clock_timestamp() THEN
        PERFORM public.fn_mock_paper_error(p_purpose,'invalid_resume',p_skill,(p_attempt->>'test_id')::UUID,
            NULLIF(p_attempt->>'policy_revision','')::BIGINT);
    END IF;
    IF p_attempt->>'sitting_id' IS NOT NULL THEN
        IF p_purpose='submit' THEN
            SELECT to_jsonb(s) INTO sitting FROM public.mock_exam_sittings s WHERE id=(p_attempt->>'sitting_id')::UUID;
            SELECT to_jsonb(m) INTO exam FROM public.mock_exams m WHERE id=(sitting->>'mock_exam_id')::UUID;
            IF sitting->>'user_id'=p_attempt->>'user_id' AND sitting->>(p_skill||'_attempt_id')=p_attempt->>'id'
               AND exam->>(p_skill||'_test_id')=p_attempt->>'test_id' AND exam->>'status'='published'
               AND sitting->>'status'<>'void' AND sitting->>(p_skill||'_submitted_at') IS NULL
               AND ((exam->>'exam_mode'='retake' AND COALESCE(sitting->'assigned_skills' ? p_skill,FALSE) AND sitting->>(p_skill||'_started_at') IS NOT NULL)
                    OR (exam->>'exam_mode'='sequential' AND exam->>'active_section'=p_skill AND exam->>'collected_section' IS DISTINCT FROM p_skill)) THEN
                RETURN jsonb_build_object('allowed',TRUE);
            END IF;
        ELSE
        decision:=public.fn_resolve_mock_paper_access(p_skill,(p_attempt->>'test_id')::UUID,
            (p_attempt->>'user_id')::UUID,'mock_delivery',NULL,(p_attempt->>'sitting_id')::UUID,FALSE);
        IF decision->>'allowed'='true' AND decision->>'attempt_id'=p_attempt->>'id' THEN
            RETURN jsonb_build_object('allowed',TRUE);
        END IF;
        END IF;
    ELSE
        d:=public.fn_mock_paper_dependencies(p_skill,(p_attempt->>'test_id')::UUID);
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(d) x WHERE x->>'reason'='verification_unavailable') THEN
            PERFORM public.fn_mock_paper_error(p_purpose,'verification_unavailable',p_skill,(p_attempt->>'test_id')::UUID,NULL);
        END IF;
        v:=public.fn_mock_paper_row(p_skill,(p_attempt->>'test_id')::UUID);
        -- Hiding a paper does not cancel already owned, valid practice work.
        -- New mock references are barred while such work remains active.
        IF p_attempt->>'attempt_purpose' IS DISTINCT FROM 'mock_delivery'
           AND (public.fn_mock_protected_references(d)='[]'::JSONB OR COALESCE(public.fn_mock_overlap_valid(v,d),FALSE)) THEN
            RETURN jsonb_build_object('allowed',TRUE);
        END IF;
        -- A source edit cannot revoke the practice overlap under which this
        -- already owned attempt was admitted. New references/grants still
        -- require a new decision and are barred by the reverse writer guard.
        SELECT paper_row->'approved_public_overlap' INTO pinned FROM public.mock_paper_attempt_snapshots
         WHERE skill=p_skill AND attempt_id=(p_attempt->>'id')::UUID;
        SELECT jsonb_agg(x-'paper_revision' ORDER BY x->>'mock_exam_id') INTO live_refs FROM jsonb_array_elements(public.fn_mock_protected_references(d)) x;
        SELECT jsonb_agg(x-'paper_revision' ORDER BY x->>'mock_exam_id') INTO pinned_refs FROM jsonb_array_elements(COALESCE(pinned->'references','[]')) x;
        IF p_attempt->>'attempt_purpose' IN ('practice','assigned_practice') AND pinned->>'actor_id' IS NOT NULL
           AND live_refs IS NOT NULL AND live_refs=pinned_refs THEN RETURN jsonb_build_object('allowed',TRUE); END IF;
    END IF;
    PERFORM public.fn_mock_paper_error(p_purpose,'ambiguous_orphan',p_skill,(p_attempt->>'test_id')::UUID,
        NULLIF(p_attempt->>'policy_revision','')::BIGINT);
END $$;

CREATE OR REPLACE FUNCTION public.fn_inspect_mock_paper_policy(p_skill TEXT,p_test_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v JSONB; d JSONB; snapshots JSONB;
BEGIN
    PERFORM public.fn_lock_mock_paper(p_skill,p_test_id);
    v:=public.fn_mock_paper_row(p_skill,p_test_id);
    IF v IS NULL THEN RAISE EXCEPTION 'public_test_not_found'; END IF;
    d:=public.fn_mock_paper_dependencies(p_skill,p_test_id);
    SELECT COALESCE(jsonb_agg(jsonb_build_object('snapshot_id',id,'created_at',created_at,'actor_id',actor_id) ORDER BY created_at DESC),'[]') INTO snapshots
        FROM (SELECT id,created_at,actor_id FROM public.mock_correction_release_events
            WHERE scope_type=p_skill||'_test' AND scope_id=p_test_id::TEXT AND action='mock_paper_policy_updated'
            AND previous_state->>'snapshot_contract'='mock-paper-policy/1' ORDER BY created_at DESC LIMIT 20) x;
    RETURN jsonb_build_object('kind',p_skill,'content_id',p_test_id,'policy_revision',v->'policy_revision',
        'paper_revision',v->'mock_content_revision','policy',public.fn_mock_policy_snapshot(v),
        'dependencies',d,'protected_references',public.fn_mock_protected_references(d),'restore_snapshots',snapshots);
END $$;

-- All new helpers, including row/snapshot readers, are service-role only.
DO $$ DECLARE f RECORD; BEGIN
    FOR f IN SELECT p.proname,pg_get_function_identity_arguments(p.oid) args
        FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public'
        AND p.proname=ANY(ARRAY['fn_lock_mock_paper','fn_mock_paper_error','fn_mock_paper_row',
            'fn_mock_section_valid','fn_mock_paper_dependencies','fn_mock_protected_references',
            'fn_mock_overlap_valid','fn_mock_public_practice_allowed','fn_resolve_mock_paper_access',
            'fn_mock_policy_snapshot','fn_guard_mock_paper_policy','fn_mutate_mock_paper_policy',
            'fn_guard_mock_paper_reference','fn_guard_mock_paper_attempt','fn_capture_mock_paper_snapshot',
            'fn_admit_mock_paper_attempt','fn_guard_mock_paper_source','fn_immutable_mock_paper_snapshot',
            'fn_guard_mock_reading_answer','fn_guard_owned_mock_attempt','fn_inspect_mock_paper_policy',
            'fn_create_mock_exam_with_paper_policy']) LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon,authenticated',f.proname,f.args);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',f.proname,f.args);
    END LOOP;
END $$;
COMMIT;
