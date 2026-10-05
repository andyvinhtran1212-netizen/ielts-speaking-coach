-- Spec: MOCKREPAIR-0016 FR-004
-- Restore the valid submitted finalization path without widening answer writes.
-- Submitted finalization persists saved answers with the grade after the section
-- clock or collector stamp closes autosave. Only the submitted transition is
-- exempt; all other answer edits retain autosave checks, including NULL status.
-- Preserve the existing immutable admission and submitted identity checks.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_guard_mock_paper_attempt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE k TEXT:=CASE WHEN TG_TABLE_NAME='reading_test_attempts' THEN 'reading' ELSE 'listening' END;
        paper JSONB; sitting JSONB; exam JSONB; v_class BOOLEAN; decision JSONB;
BEGIN
    PERFORM public.fn_lock_mock_paper(k,NEW.test_id);
    IF TG_OP='INSERT' AND NEW.attempt_purpose IS NULL
       AND current_setting('mock_paper.programme_admission',TRUE)='practice' THEN
        NEW.attempt_purpose:='practice';
    END IF;
    IF NOT public.fn_mock_admission_contract_active() THEN
        IF TG_OP='UPDATE' AND OLD.paper_revision IS NULL THEN RETURN NEW; END IF;
        IF TG_OP='INSERT' THEN
            NEW.paper_revision:=NULL; NEW.policy_revision:=NULL;
            IF NEW.attempt_purpose IS NULL THEN RETURN NEW; END IF;
        END IF;
    ELSIF TG_OP='INSERT' AND NEW.attempt_purpose IS NULL THEN
        PERFORM public.fn_mock_paper_error('admission','typed_admission_required',k,NEW.test_id,NULL);
    END IF;
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
        IF NEW.answers IS DISTINCT FROM OLD.answers AND OLD.status='in_progress'
           AND NEW.status IS DISTINCT FROM 'submitted' AND NEW.sitting_id IS NOT NULL THEN
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
    IF NEW.attempt_purpose NOT IN ('practice','assigned_practice','mock_delivery') THEN
        PERFORM public.fn_mock_paper_error('admission','unsupported_purpose',k,NEW.test_id,NULL);
    END IF;
    IF NEW.sitting_id IS NOT NULL THEN
        IF NEW.attempt_purpose<>'mock_delivery' THEN
            PERFORM public.fn_mock_paper_error('admission','mock_binding_required',k,NEW.test_id,NULL);
        END IF;
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
        IF NEW.attempt_purpose IS DISTINCT FROM decision->>'attempt_purpose' THEN
            PERFORM public.fn_mock_paper_error('admission','mock_binding_required',k,NEW.test_id,(paper->>'policy_revision')::BIGINT);
        END IF;
    END IF;
    IF public.fn_mock_admission_contract_active() THEN
        NEW.paper_revision:=(paper->>'mock_content_revision')::BIGINT;
        NEW.policy_revision:=(paper->>'policy_revision')::BIGINT;
    ELSE
        NEW.paper_revision:=NULL; NEW.policy_revision:=NULL;
    END IF;
    RETURN NEW;
END $$;

COMMIT;
