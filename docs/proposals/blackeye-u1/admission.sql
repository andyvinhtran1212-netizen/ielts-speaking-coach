-- PROPOSAL MIRROR OF PENDING_FEATURE 376; LOCAL DISPOSABLE TESTS ONLY. No history DML, new table or flag change.
-- Placement: numbered 376 pending_feature; install only after SA review + anh Vinh approves execution.
-- Authority: c7740960 (admission), b71cfd5c (exactly three CHECK replacements),
-- d461e884 (assignment seam closed; mapping/catalog/create/receipt in PR2).
-- Reuses 306's immutable service-only snapshot and 311's guard unchanged.
-- RLS/grants on attempts/snapshots remain those of 306; no client key access.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.listening_content_packages DROP CONSTRAINT listening_content_packages_programme_id_check;
ALTER TABLE public.listening_content_packages ADD CONSTRAINT listening_content_packages_programme_id_check
 CHECK (programme_id IN ('general-listening-practice','ielts-listening-practice','ielts-80-days-listening','blackeye-v5-upper-listening'));
ALTER TABLE public.listening_lessons DROP CONSTRAINT listening_lessons_programme_id_check;
ALTER TABLE public.listening_lessons ADD CONSTRAINT listening_lessons_programme_id_check
 CHECK (programme_id IN ('general-listening-practice','ielts-listening-practice','ielts-80-days-listening','blackeye-v5-upper-listening'));
ALTER TABLE public.listening_tests DROP CONSTRAINT listening_tests_programme_id_check;
ALTER TABLE public.listening_tests ADD CONSTRAINT listening_tests_programme_id_check
 CHECK (programme_id IN ('ielts','general-listening-practice','ielts-listening-practice','ielts-80-days-listening','blackeye-v5-upper-listening'));

-- Narrow backstop on all INSERT routes, including older service RPCs. It runs
-- after trg_mock_paper_attempt (alphabetical trigger order). No activation flag
-- is changed: inactive existing snapshot machinery means a closed admission.
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
COMMIT;
