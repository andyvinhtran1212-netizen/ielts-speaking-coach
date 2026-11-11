-- Manual only; no automatic apply. Evidence is retained.
BEGIN;
SET LOCAL lock_timeout='5s';
LOCK TABLE public.class_assignment_activities,public.exercise_book_attempt_links IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.listening_test_attempts IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.class_assignment_activities)
 OR EXISTS(SELECT 1 FROM public.exercise_book_attempt_links)
 OR EXISTS(SELECT 1 FROM public.listening_test_attempts a JOIN public.listening_tests t ON t.id=a.test_id
   JOIN public.exercise_book_registry r ON r.programme_id=t.programme_id WHERE a.attempt_purpose='assigned_practice') THEN
   RAISE EXCEPTION 'exercise_book_history_exists' USING ERRCODE='55000'; END IF;
END $$;
DROP TRIGGER trg_zz_exercise_book_attempt_immutable ON public.listening_test_attempts;
DROP TRIGGER trg_zzz_exercise_book_link ON public.listening_test_attempts;
DROP FUNCTION public.fn_eb_attempt_immutable();
DROP FUNCTION public.fn_eb_link_attempt();
DROP FUNCTION public.fn_submit_exercise_book_assigned_attempt(uuid,uuid,jsonb,jsonb,boolean);
DROP FUNCTION public.fn_save_exercise_book_answer(uuid,uuid,integer,text,bigint);
DROP FUNCTION public.fn_eb_answer_blank(jsonb,text);
DROP FUNCTION public.fn_eb_attempt_cell(uuid,uuid);
DROP FUNCTION public.fn_acquire_exercise_book_assigned_attempt(uuid,uuid,uuid,jsonb,text);
DROP FUNCTION public.fn_eb_owned_cell(uuid,uuid,uuid);
DROP FUNCTION public.fn_list_learner_exercise_book_assignments(uuid,integer,timestamptz,uuid);
DROP FUNCTION public.fn_read_exercise_book_progress(uuid,uuid,uuid);
DROP FUNCTION public.fn_eb_cells(uuid);
DROP FUNCTION public.fn_list_exercise_book_assignments(uuid,uuid,text,integer,timestamptz,uuid);
DROP FUNCTION public.fn_close_exercise_book_assignment(uuid,uuid,uuid,text);
DROP FUNCTION public.fn_create_exercise_book_assignment(uuid,uuid,uuid,text,jsonb,uuid[],timestamptz,text,text,text);
DROP FUNCTION public.fn_eb_receipt(uuid);
DROP FUNCTION public.fn_eb_paper(uuid,jsonb);
DROP FUNCTION public.fn_eb_roles(uuid,uuid,text,boolean);
DROP TABLE public.exercise_book_attempt_links;
DROP TABLE public.class_assignment_activities;
DROP FUNCTION public.fn_eb_activity_insert_guard();
DROP FUNCTION public.fn_eb_link_guard();
CREATE OR REPLACE FUNCTION public.fn_guard_blackeye_admission()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE paper JSONB; b JSONB; activity JSONB; n INTEGER; pkg JSONB; protected JSONB;
BEGIN
    PERFORM public.fn_lock_mock_paper('listening',NEW.test_id);
    paper:=public.fn_mock_paper_row('listening',NEW.test_id);
    IF paper->>'programme_id' IS DISTINCT FROM 'blackeye-v5-upper-listening'
       AND NOT COALESCE(paper->'metadata' ? 'blackeye',FALSE) THEN
        RETURN NEW;
    END IF;
    IF NOT public.fn_mock_admission_contract_active() OR NEW.paper_revision IS NULL THEN
        RAISE EXCEPTION 'blackeye_unavailable';
    END IF;
    IF NEW.class_assignment_item_id IS NOT NULL OR NEW.sitting_id IS NOT NULL
       OR NEW.attempt_purpose IS DISTINCT FROM 'practice' THEN
        RAISE EXCEPTION 'blackeye_invalid_context';
    END IF;
    SELECT to_jsonb(p) INTO pkg FROM public.listening_content_packages p
        WHERE p.id=(paper->>'content_package_id')::UUID;
    activity:=paper#>'{metadata,blackeye}'; b:=activity->'binding';
    IF paper->>'status' IS DISTINCT FROM 'published' OR paper->>'is_public' IS DISTINCT FROM 'true'
       OR pkg->>'status' IS DISTINCT FROM 'published'
       OR pkg->>'programme_id' IS DISTINCT FROM 'blackeye-v5-upper-listening' THEN
        RAISE EXCEPTION 'blackeye_forbidden';
    END IF;
    IF NEW.scoring_policy IS DISTINCT FROM 'report_only'
       OR paper->>'programme_id' IS DISTINCT FROM 'blackeye-v5-upper-listening'
       OR b->>'programme_id' IS DISTINCT FROM 'blackeye-v5-upper-listening'
       OR b->>'collection_id' IS DISTINCT FROM 'blackeye-v5-upper'
       OR b->>'source_contract' IS DISTINCT FROM 'blackeye_u1_v1'
       OR b->>'unit_id' IS DISTINCT FROM 'U1'
       OR COALESCE(b->>'activity_id','') !~ '^U1-A(0[1-9]|1[0-9]|20)$'
       OR b->>'activity_id' IN ('U1-A08','U1-A14','U1-A19')
       OR activity->>'readiness' IS DISTINCT FROM 'ready'
       OR activity->>'selectable' IS DISTINCT FROM 'true'
       OR COALESCE(b->>'content_revision','') IN ('','latest')
       OR COALESCE(b->>'policy_revision','') IN ('','latest')
       OR COALESCE(b->>'answer_set_revision','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RAISE EXCEPTION 'blackeye_invalid_binding';
    END IF;
    -- Server-authored revision/context mismatches are unavailable, not a
    -- learner binding error. Live installation is gated; CI may test disposable PostgreSQL only.
    IF paper#>'{metadata,blackeye_db_revisions}' IS DISTINCT FROM jsonb_build_object(
           'paper_revision',NEW.paper_revision,'policy_revision',NEW.policy_revision) THEN
        RAISE EXCEPTION 'blackeye_unavailable_revision';
    END IF;
    IF paper#>'{metadata,blackeye_context}' IS DISTINCT FROM jsonb_build_object(
           'kind','standalone','class_assignment_item_id',NULL,'assignment_id',NULL,'cohort_id',NULL) THEN
        RAISE EXCEPTION 'blackeye_unavailable_context';
    END IF;
    IF jsonb_typeof(activity->'items') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'blackeye_invalid_cells';
    END IF;
    n:=jsonb_array_length(activity->'items');
    IF n NOT BETWEEN 1 AND 48 OR (activity->>'response_cell_count')::INTEGER IS DISTINCT FROM n
       OR (b->>'activity_id'='U1-A13' AND n<>48)
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(activity->'items') WITH ORDINALITY c(item,pos)
           WHERE c.item->>'q_num' IS DISTINCT FROM c.pos::TEXT
              OR COALESCE(c.item->>'source_item_id','')=''
              OR COALESCE(c.item->>'interaction','') NOT IN ('text','keep_change')
              OR (b->>'activity_id' IN ('U1-A03','U1-A04') AND c.item->>'interaction' IS DISTINCT FROM 'keep_change'))
       OR (SELECT count(DISTINCT c->>'source_item_id') FROM jsonb_array_elements(activity->'items') c)<>n THEN
        RAISE EXCEPTION 'blackeye_invalid_cells';
    END IF;
    -- Capture306 stores every child. Require exactly one published review row,
    -- already bound to this full identity/cell map, before capture can occur.
    IF (SELECT count(*) FROM public.listening_exercises e JOIN public.listening_content c
        ON c.id=e.content_id WHERE c.test_id=NEW.test_id)<>1 THEN
        RAISE EXCEPTION 'blackeye_unavailable';
    END IF;
    SELECT e.payload->'blackeye_review' INTO protected
      FROM public.listening_exercises e JOIN public.listening_content c ON c.id=e.content_id
     WHERE c.test_id=NEW.test_id AND c.status='published' AND e.status='published';
    IF protected->'binding' IS DISTINCT FROM b
       OR jsonb_typeof(protected->'items') IS DISTINCT FROM 'array'
       OR jsonb_typeof(protected->'transcript') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'blackeye_unavailable';
    END IF;
    IF jsonb_array_length(protected->'items')<>n OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(activity->'items') WITH ORDINALITY c(item,pos)
        WHERE (protected->'items'->(c.pos::INTEGER-1)->>'q_num') IS DISTINCT FROM c.item->>'q_num'
           OR (protected->'items'->(c.pos::INTEGER-1)->>'source_item_id') IS DISTINCT FROM c.item->>'source_item_id'
           OR (protected->'items'->(c.pos::INTEGER-1)->>'scoring_mode') IS DISTINCT FROM 'SELF-CHECK') THEN
        RAISE EXCEPTION 'blackeye_invalid_cells';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_guard_blackeye_admission() FROM PUBLIC,anon,authenticated;
-- Replace atomically without requiring CREATE OR REPLACE TRIGGER (PG14+).
DROP TRIGGER IF EXISTS trg_zz_blackeye_admission ON public.listening_test_attempts;
CREATE TRIGGER trg_zz_blackeye_admission BEFORE INSERT ON public.listening_test_attempts
 FOR EACH ROW EXECUTE FUNCTION public.fn_guard_blackeye_admission();

-- Service-only equality precondition and resolve/freeze occur under the SAME
-- paper + learner locks used by the existing acquisition/capture machinery.
-- No client answer-set selector. No overwrite/backfill/merge of old attempts.
CREATE OR REPLACE FUNCTION public.fn_acquire_blackeye_attempt(
    p_test_id UUID,p_user_id UUID,p_binding JSONB,p_renderer_affinity_protocol TEXT DEFAULT 'legacy')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE paper JSONB; full_binding JSONB; visible JSONB; attempt JSONB; snapshot JSONB; acquired RECORD;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' OR p_test_id IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION 'blackeye_forbidden';
    END IF;
    IF p_renderer_affinity_protocol NOT IN ('legacy','claim-v1') OR p_renderer_affinity_protocol IS NULL THEN
        RAISE EXCEPTION 'blackeye_invalid_renderer';
    END IF;
    IF jsonb_typeof(p_binding) IS DISTINCT FROM 'object'
       OR p_binding ? 'answer_set_revision'
       OR (SELECT count(*) FROM jsonb_object_keys(p_binding))<>7 THEN
        RAISE EXCEPTION 'blackeye_invalid_binding';
    END IF;
    PERFORM public.fn_lock_mock_paper('listening',p_test_id);
    PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT||':'||p_test_id::TEXT,0));
    paper:=public.fn_mock_paper_row('listening',p_test_id);
    IF paper->>'programme_id' IS DISTINCT FROM 'blackeye-v5-upper-listening' THEN
        RAISE EXCEPTION 'blackeye_invalid_binding';
    END IF;
    IF NOT public.fn_mock_admission_contract_active() THEN RAISE EXCEPTION 'blackeye_unavailable'; END IF;
    IF paper->>'status' IS DISTINCT FROM 'published' OR paper->>'is_public' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'blackeye_forbidden';
    END IF;
    full_binding:=paper#>'{metadata,blackeye,binding}';
    visible:=full_binding-'answer_set_revision';
    IF (p_binding-ARRAY['content_revision','policy_revision']) IS DISTINCT FROM
       (visible-ARRAY['content_revision','policy_revision']) THEN
        RAISE EXCEPTION 'blackeye_invalid_binding';
    END IF;
    IF p_binding IS DISTINCT FROM visible THEN RAISE EXCEPTION 'blackeye_stale'; END IF;
    -- Never let 295's duplicate repair/abandon path modify Black Eye history.
    IF (SELECT count(*) FROM public.listening_test_attempts a WHERE a.test_id=p_test_id
        AND a.user_id=p_user_id AND a.class_assignment_item_id IS NULL AND a.sitting_id IS NULL)>1 THEN
        RAISE EXCEPTION 'blackeye_unavailable';
    END IF;
    SELECT to_jsonb(a) INTO attempt FROM public.listening_test_attempts a WHERE a.test_id=p_test_id
        AND a.user_id=p_user_id AND a.class_assignment_item_id IS NULL AND a.sitting_id IS NULL FOR UPDATE;
    IF attempt IS NULL THEN
        SELECT * INTO acquired FROM public.fn_acquire_listening_programme_attempt_v2(
            p_test_id,p_user_id,p_renderer_affinity_protocol);
        SELECT to_jsonb(a) INTO attempt FROM public.listening_test_attempts a WHERE a.id=acquired.attempt_id;
    ELSIF attempt->>'status' NOT IN ('in_progress','submitted') OR
          (attempt->>'status'='in_progress' AND (attempt->>'resume_expires_at')::TIMESTAMPTZ<=clock_timestamp()) THEN
        RAISE EXCEPTION 'blackeye_invalid_inactive';
    END IF;
    SELECT to_jsonb(s) INTO snapshot FROM public.mock_paper_attempt_snapshots s
        WHERE s.skill='listening' AND s.attempt_id=(attempt->>'id')::UUID
        AND s.paper_id=p_test_id AND s.paper_revision=(attempt->>'paper_revision')::BIGINT
        AND s.policy_revision=(attempt->>'policy_revision')::BIGINT;
    IF snapshot IS NULL OR snapshot#>'{paper_row,metadata,blackeye,binding}' IS NULL THEN
        RAISE EXCEPTION 'blackeye_unavailable';
    END IF;
    -- Existing attempts retain their original answer set even after a key-only
    -- publication. Public equality does not compare/echo the hidden identity.
    IF (snapshot#>'{paper_row,metadata,blackeye,binding}'-'answer_set_revision') IS DISTINCT FROM p_binding THEN
        RAISE EXCEPTION 'blackeye_stale';
    END IF;
    RETURN attempt;
EXCEPTION WHEN deadlock_detected OR lock_not_available THEN
    RAISE EXCEPTION 'blackeye_unavailable';
END $$;
REVOKE ALL ON FUNCTION public.fn_acquire_blackeye_attempt(UUID,UUID,JSONB,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_acquire_blackeye_attempt(UUID,UUID,JSONB,TEXT) TO service_role;
-- A service-only submit boundary; expected answers travel in the POST body,
-- never in the request URL. The row lock serializes saves and submissions.
CREATE OR REPLACE FUNCTION public.fn_submit_blackeye_attempt(
    p_attempt_id UUID,p_user_id UUID,p_expected_answers JSONB,p_result_summary JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE attempt public.listening_test_attempts%ROWTYPE; snapshot JSONB;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' OR p_user_id IS NULL THEN
        RAISE EXCEPTION 'blackeye_forbidden';
    END IF;
    SELECT a.* INTO attempt FROM public.listening_test_attempts a
        WHERE a.id=p_attempt_id AND a.user_id=p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'blackeye_forbidden'; END IF;
    SELECT s.paper_row INTO snapshot FROM public.mock_paper_attempt_snapshots s
        WHERE s.skill='listening' AND s.attempt_id=attempt.id AND s.paper_id=attempt.test_id
          AND s.paper_revision=attempt.paper_revision AND s.policy_revision=attempt.policy_revision;
    IF snapshot->>'programme_id' IS DISTINCT FROM 'blackeye-v5-upper-listening'
       OR attempt.scoring_policy IS DISTINCT FROM 'report_only'
       OR attempt.class_assignment_item_id IS NOT NULL OR attempt.sitting_id IS NOT NULL
       OR attempt.attempt_purpose IS DISTINCT FROM 'practice' THEN
        RAISE EXCEPTION 'blackeye_unavailable';
    END IF;
    IF attempt.status='submitted' THEN RETURN to_jsonb(attempt); END IF;
    IF attempt.status IS DISTINCT FROM 'in_progress' OR attempt.resume_expires_at IS NULL
       OR attempt.resume_expires_at<=clock_timestamp()
       OR attempt.answers IS DISTINCT FROM p_expected_answers THEN
        RAISE EXCEPTION 'blackeye_changed';
    END IF;
    -- Backend derives the report from these exact frozen cells/answers. A save
    -- that wins the row lock invalidates this precondition and cannot leave an
    -- obsolete blank_count. A submit that wins closes subsequent save RPCs.
    UPDATE public.listening_test_attempts SET status='submitted',submitted_at=clock_timestamp(),
        result_summary=p_result_summary,score=NULL,band_estimate=NULL,
        grading_details='[]'::jsonb,trap_analytics='{}'::jsonb
        WHERE id=attempt.id RETURNING * INTO attempt;
    RETURN to_jsonb(attempt);
END $$;
REVOKE ALL ON FUNCTION public.fn_submit_blackeye_attempt(UUID,UUID,JSONB,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_submit_blackeye_attempt(UUID,UUID,JSONB,JSONB) TO service_role;

-- Re-application must leave the enabled guard and all three definers intact.
DO $$
DECLARE signature TEXT; function_oid OID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid='public.listening_test_attempts'::pg_catalog.regclass
          AND t.tgname='trg_zz_blackeye_admission' AND t.tgenabled='O'
          AND NOT t.tgisinternal
          AND t.tgfoid=pg_catalog.to_regprocedure('public.fn_guard_blackeye_admission()')) THEN
        RAISE EXCEPTION 'blackeye_admission_trigger_postcondition_failed' USING ERRCODE='55000';
    END IF;
    FOREACH signature IN ARRAY ARRAY[
        'public.fn_guard_blackeye_admission()',
        'public.fn_acquire_blackeye_attempt(uuid,uuid,jsonb,text)',
        'public.fn_submit_blackeye_attempt(uuid,uuid,jsonb,jsonb)']
    LOOP
        function_oid:=pg_catalog.to_regprocedure(signature);
        IF function_oid IS NULL OR NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=function_oid AND p.prosecdef
              AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
           OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
               LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
               WHERE p.oid=function_oid AND a.grantee=0 AND a.privilege_type='EXECUTE')
           OR pg_catalog.has_function_privilege('anon',function_oid,'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated',function_oid,'EXECUTE') THEN
            RAISE EXCEPTION 'blackeye_admission_function_postcondition_failed: %', signature USING ERRCODE='55000';
        END IF;
    END LOOP;
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

REVOKE ALL ON FUNCTION public.fn_resolve_mock_paper_access(text,uuid,uuid,text,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_mock_paper_access(text,uuid,uuid,text,uuid,uuid,boolean) TO service_role;
DO $$ BEGIN
 IF to_regclass('public.class_assignment_activities') IS NOT NULL OR to_regclass('public.exercise_book_attempt_links') IS NOT NULL THEN
   RAISE EXCEPTION 'exercise_book_rollback_postcondition'; END IF;
END $$;
COMMIT;
