-- Manual M-B rollback: close importer and revert dependent Python before running.
-- Fail closed on changed bodies or restricted data. Columns (including the
-- appended catalog restricted column) are intentionally retained per SA ruling.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.listening_tests, public.listening_content, public.listening_test_attempts,
    public.dictation_sessions IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_admin_exam_content_page_ids(text,text,uuid,boolean,boolean,text,text,integer,integer)'::pg_catalog.regprocedure) IS DISTINCT FROM 'b070513c72437b6c7af3c831ac39dd683147b0dacba89d53d985aa39f4e1e1c4'
       OR (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_admin_exam_content_levels(text)'::pg_catalog.regprocedure) IS DISTINCT FROM '1ee77de939793459a841597d6f76f535881af47e9223764037b21f58278270f8'
       OR EXISTS (SELECT 1 FROM public.listening_tests WHERE restricted IS DISTINCT FROM false)
       OR EXISTS (SELECT 1 FROM public.listening_content WHERE restricted IS DISTINCT FROM false)
       OR EXISTS (SELECT 1 FROM public.listening_test_attempts WHERE restricted IS DISTINCT FROM false)
       OR EXISTS (SELECT 1 FROM public.dictation_sessions WHERE restricted IS DISTINCT FROM false)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid IN ('public.fn_admin_exam_content_page_ids(text,text,uuid,boolean,boolean,text,text,integer,integer)'::pg_catalog.regprocedure, 'public.fn_admin_exam_content_levels(text)'::pg_catalog.regprocedure)
          AND (NOT p.prosecdef OR p.provolatile <> 's' OR p.proowner <> 'postgres'::pg_catalog.regrole
               OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
               OR NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
        WHERE p.oid IN ('public.fn_admin_exam_content_page_ids(text,text,uuid,boolean,boolean,text,text,integer,integer)'::pg_catalog.regprocedure, 'public.fn_admin_exam_content_levels(text)'::pg_catalog.regprocedure)
          AND (acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole) OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable))
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c WHERE c.oid = 'public.listening_public_practice_catalog'::pg_catalog.regclass
                    AND c.relowner = 'postgres'::pg_catalog.regrole
                    AND c.reloptions @> ARRAY['security_barrier=true'] AND pg_catalog.has_table_privilege('service_role',c.oid,'SELECT'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) AS acl
        WHERE c.oid = 'public.listening_public_practice_catalog'::pg_catalog.regclass AND acl.grantee <> c.relowner
          AND (acl.grantee <> 'service_role'::pg_catalog.regrole OR acl.privilege_type <> 'SELECT' OR acl.is_grantable))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a
        JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
        CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS acl
        WHERE c.oid = 'public.listening_public_practice_catalog'::pg_catalog.regclass AND acl.grantee <> c.relowner
          AND (acl.grantee <> 'service_role'::pg_catalog.regrole OR acl.privilege_type <> 'SELECT' OR acl.is_grantable))
       OR pg_catalog.pg_get_viewdef('public.listening_public_practice_catalog'::pg_catalog.regclass) !~ 'NOT ([a-z_]+[.])?restricted' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '382 rollback unsafe: body drift or restricted data; roll forward';
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_mock_public_practice_allowed(text,uuid)'::pg_catalog.regprocedure
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '98bbc1f0a9c78f1ac967c38c3f91f1aa6cff9b2689896d87fdb3d7f4386cc31b'
        AND p.proowner = 'postgres'::pg_catalog.regrole AND p.prosecdef AND p.provolatile = 'v'
        AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
        WHERE p.oid = 'public.fn_mock_public_practice_allowed(text,uuid)'::pg_catalog.regprocedure
          AND (acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole)
               OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable)) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '382 practice helper body/config/ACL mismatch';
    END IF;
END;
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

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_mock_public_practice_allowed(text,uuid)'::pg_catalog.regprocedure
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = 'a700d803466cf23f2cd1a97f427098cd91c1248720ac597d51e70b45c91676b5'
        AND p.proowner = 'postgres'::pg_catalog.regrole AND p.prosecdef AND p.provolatile = 'v'
        AND p.proconfig = ARRAY['search_path=public, pg_temp']
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
        WHERE p.oid = 'public.fn_mock_public_practice_allowed(text,uuid)'::pg_catalog.regprocedure
          AND (acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole)
               OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable)) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '382 practice helper body/config/ACL mismatch';
    END IF;
END;
$$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_admit_mock_paper_attempt(text,uuid,uuid,uuid,text)'::pg_catalog.regprocedure
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '1e7e76b8cb8f97e8632035abc24c9b3af5b41e6b99bb108a21deb19507e670fb'
        AND p.proowner = 'postgres'::pg_catalog.regrole AND p.prosecdef AND p.provolatile = 'v'
        AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
        WHERE p.oid = 'public.fn_admit_mock_paper_attempt(text,uuid,uuid,uuid,text)'::pg_catalog.regprocedure
          AND (acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole)
               OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable)) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '382 fn_admit_mock_paper_attempt body/config/ACL mismatch';
    END IF;
END $$;
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
            INSERT INTO public.reading_test_attempts(id,test_id,user_id,sitting_id,started_at,renderer_affinity,resume_expires_at,attempt_purpose)
            VALUES(v_id,p_test_id,p_user_id,p_sitting_id,v_started,CASE WHEN p_renderer_affinity_protocol='claim-v1' THEN NULL ELSE 'legacy' END,
                v_started+INTERVAL '24 hours','mock_delivery') RETURNING to_jsonb(reading_test_attempts) INTO attempt;
        ELSE
            UPDATE public.mock_exam_sittings SET listening_attempt_id=v_id WHERE id=p_sitting_id;
            INSERT INTO public.listening_test_attempts(id,test_id,user_id,sitting_id,started_at,renderer_affinity,resume_expires_at,scoring_policy,attempt_purpose)
            VALUES(v_id,p_test_id,p_user_id,p_sitting_id,v_started,CASE WHEN p_renderer_affinity_protocol='claim-v1' THEN NULL ELSE 'legacy' END,
                v_started+INTERVAL '24 hours',COALESCE(paper->>'scoring_policy','diagnostic'),'mock_delivery')
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
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_admit_mock_paper_attempt(text,uuid,uuid,uuid,text)'::pg_catalog.regprocedure
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '829b76763e299ff145109cc29d18de47bc9e74c1fc699b87e7313e207c450420'
        AND p.proowner = 'postgres'::pg_catalog.regrole AND p.prosecdef AND p.provolatile = 'v'
        AND p.proconfig = ARRAY['search_path=public, pg_temp']
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
        WHERE p.oid = 'public.fn_admit_mock_paper_attempt(text,uuid,uuid,uuid,text)'::pg_catalog.regprocedure
          AND (acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole)
               OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable)) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '382 fn_admit_mock_paper_attempt body/config/ACL mismatch';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_guard_owned_mock_attempt(text,jsonb,text)'::pg_catalog.regprocedure
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '39558bf96d9b4884b8a2d6671cbde95c37327bfd21965ded30b0aaecec2609f2'
        AND p.proowner = 'postgres'::pg_catalog.regrole AND p.prosecdef AND p.provolatile = 'v'
        AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
        WHERE p.oid = 'public.fn_guard_owned_mock_attempt(text,jsonb,text)'::pg_catalog.regprocedure
          AND (acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole)
               OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable)) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '382 fn_guard_owned_mock_attempt body/config/ACL mismatch';
    END IF;
END $$;
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
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_guard_owned_mock_attempt(text,jsonb,text)'::pg_catalog.regprocedure
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '4c00034c15f569630ac6c2bec994f4be921f912f29d898a08c140a38f88ac575'
        AND p.proowner = 'postgres'::pg_catalog.regrole AND p.prosecdef AND p.provolatile = 'v'
        AND p.proconfig = ARRAY['search_path=public, pg_temp']
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
        WHERE p.oid = 'public.fn_guard_owned_mock_attempt(text,jsonb,text)'::pg_catalog.regprocedure
          AND (acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole)
               OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable)) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '382 fn_guard_owned_mock_attempt body/config/ACL mismatch';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_inspect_mock_paper_policy(text,uuid)'::pg_catalog.regprocedure
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '76259f20732efed24c10514a4dfa96dcb55b3fb08a276878dd99031f6a4cc3c5'
        AND p.proowner = 'postgres'::pg_catalog.regrole AND p.prosecdef AND p.provolatile = 'v'
        AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
        WHERE p.oid = 'public.fn_inspect_mock_paper_policy(text,uuid)'::pg_catalog.regprocedure
          AND (acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole)
               OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable)) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '382 fn_inspect_mock_paper_policy body/config/ACL mismatch';
    END IF;
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
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_inspect_mock_paper_policy(text,uuid)'::pg_catalog.regprocedure
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = 'ed01434817c919aeda042388ad2e5f585af10ab8b2ecf434a7e29888e37c460c'
        AND p.proowner = 'postgres'::pg_catalog.regrole AND p.prosecdef AND p.provolatile = 'v'
        AND p.proconfig = ARRAY['search_path=public, pg_temp']
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
        WHERE p.oid = 'public.fn_inspect_mock_paper_policy(text,uuid)'::pg_catalog.regprocedure
          AND (acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole)
               OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable)) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '382 fn_inspect_mock_paper_policy body/config/ACL mismatch';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_guard_mock_paper_reference()'::pg_catalog.regprocedure
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = 'c6562fdbd02536c045bd1baa85bfb39cee129e31be166f79e0b0261a82e89d77'
        AND p.proowner = 'postgres'::pg_catalog.regrole AND p.prosecdef AND p.provolatile = 'v'
        AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
        WHERE p.oid = 'public.fn_guard_mock_paper_reference()'::pg_catalog.regprocedure
          AND (acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole)
               OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable)) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '382 fn_guard_mock_paper_reference body/config/ACL mismatch';
    END IF;
END $$;
CREATE OR REPLACE FUNCTION public.fn_guard_mock_paper_reference()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_row JSONB:=CASE WHEN TG_OP='INSERT' THEN '{}'::JSONB ELSE to_jsonb(OLD) END;
        new_row JSONB:=CASE WHEN TG_OP='DELETE' THEN '{}'::JSONB ELSE to_jsonb(NEW) END;
        refs JSONB:='[]'; x RECORD; paper JSONB; parent JSONB; v_new BOOLEAN; v_protected BOOLEAN;
BEGIN
    IF NOT public.fn_mock_admission_contract_active() THEN
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
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
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_guard_mock_paper_reference()'::pg_catalog.regprocedure
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '98645fa1203ff29e6119ae1de3ff94979158948c3beece095b1c32c372dbf977'
        AND p.proowner = 'postgres'::pg_catalog.regrole AND p.prosecdef AND p.provolatile = 'v'
        AND p.proconfig = ARRAY['search_path=public, pg_temp']
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
        WHERE p.oid = 'public.fn_guard_mock_paper_reference()'::pg_catalog.regprocedure
          AND (acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole)
               OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable)) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '382 fn_guard_mock_paper_reference body/config/ACL mismatch';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_admin_exam_content_page_ids(
    p_kind text,
    p_course_level text DEFAULT NULL,
    p_cohort_id uuid DEFAULT NULL,
    p_exam_only boolean DEFAULT NULL,
    p_is_public boolean DEFAULT NULL,
    p_query text DEFAULT NULL,
    p_attention text DEFAULT 'all',
    p_limit integer DEFAULT 25,
    p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_result jsonb;
    v_query text := NULLIF(pg_catalog.btrim(COALESCE(p_query, '')), '');
BEGIN
    IF p_kind IS NULL OR p_kind NOT IN ('reading', 'listening', 'writing')
       OR p_attention IS NULL OR p_attention NOT IN ('all', 'action', 'unassigned', 'no-level', 'draft')
       OR p_limit IS NULL OR p_limit < 0 OR p_limit > 100
       OR p_offset IS NULL OR p_offset < 0
       OR pg_catalog.length(COALESCE(v_query, '')) > 100 THEN
        RAISE EXCEPTION 'invalid_admin_exam_content_page_query' USING ERRCODE = '22023';
    END IF;

    WITH source AS (
        SELECT 'reading'::text AS kind, paper.id, paper.test_id AS code,
               paper.title, paper.course_level, paper.status,
               paper.exam_only, paper.is_public,
               paper.public_practice_enabled, paper.web_explanation_mode::text,
               paper.test_type::text, paper.passage_count, paper.total_questions,
               NULL::text AS audio_assembly_mode,
               NULL::text AS full_audio_storage_path,
               NULL::text AS assembled_audio_storage_path,
               CASE WHEN paper.test_type = 'mini'
                    THEN paper.passage_count = 1 AND paper.total_questions >= 1
                    ELSE paper.passage_count = 3 AND paper.total_questions = 40
               END AS publish_ready
          FROM public.reading_tests AS paper
         WHERE p_kind = 'reading'
        UNION ALL
        SELECT 'listening'::text, paper.id, paper.test_id,
               paper.title, paper.course_level, paper.status,
               paper.exam_only, paper.is_public,
               paper.public_practice_enabled, paper.web_explanation_mode::text,
               paper.test_type::text, NULL::integer, NULL::integer,
               paper.audio_assembly_mode::text,
               paper.full_audio_storage_path, paper.assembled_audio_storage_path,
               ((paper.audio_assembly_mode = 'full_premixed'
                   AND COALESCE(paper.full_audio_storage_path, '') <> '')
                OR (paper.audio_assembly_mode = 'parts_auto_assembled'
                   AND COALESCE(paper.assembled_audio_storage_path, '') <> ''))
          FROM public.listening_tests AS paper
         WHERE p_kind = 'listening'
        UNION ALL
        SELECT 'writing'::text, prompt.id, NULL::text,
               prompt.title, prompt.course_level,
               CASE WHEN prompt.is_active THEN 'published' ELSE 'archived' END,
               prompt.exam_only, NULL::boolean,
               NULL::boolean, NULL::text, NULL::text,
               NULL::integer, NULL::integer,
               NULL::text, NULL::text, NULL::text, false
          FROM public.writing_prompts AS prompt
         WHERE p_kind = 'writing'
    ), scoped AS (
        SELECT source.*,
               EXISTS (
                   SELECT 1 FROM public.exam_content_cohorts AS link
                    WHERE link.content_kind = source.kind
                      AND link.content_id = source.id
               ) AS has_cohort,
               EXISTS (
                   SELECT 1 FROM public.exam_content_cohorts AS link
                    WHERE link.content_kind = source.kind
                      AND link.content_id = source.id
                      AND link.cohort_id = p_cohort_id
               ) AS in_cohort,
               EXISTS (
                   SELECT 1 FROM public.mock_exams AS exam
                    WHERE (source.kind = 'reading' AND exam.reading_test_id = source.id)
                       OR (source.kind = 'listening' AND exam.listening_test_id = source.id)
                       OR (source.kind = 'writing' AND (
                           exam.writing_task1_prompt_id = source.id
                           OR exam.writing_task2_prompt_id = source.id))
               ) AS in_mock
          FROM source
    ), filtered AS MATERIALIZED (
        SELECT scoped.*
          FROM scoped
         WHERE (p_course_level IS NULL
                OR COALESCE(scoped.course_level, '') = p_course_level)
           AND (p_cohort_id IS NULL OR scoped.in_cohort)
           AND (p_exam_only IS NULL OR COALESCE(scoped.exam_only, false) = p_exam_only)
           AND (p_is_public IS NULL OR (scoped.kind <> 'writing'
                AND COALESCE(scoped.is_public, false) = p_is_public))
           AND (v_query IS NULL OR
                pg_catalog.strpos(pg_catalog.lower(scoped.id::text), pg_catalog.lower(v_query)) > 0 OR
                pg_catalog.strpos(pg_catalog.lower(COALESCE(scoped.code, '')), pg_catalog.lower(v_query)) > 0 OR
                pg_catalog.strpos(pg_catalog.lower(COALESCE(scoped.title, '')), pg_catalog.lower(v_query)) > 0 OR
                pg_catalog.strpos(pg_catalog.lower(COALESCE(scoped.course_level, '')), pg_catalog.lower(v_query)) > 0)
           AND CASE p_attention
               WHEN 'no-level' THEN COALESCE(scoped.course_level, '') = ''
               WHEN 'draft' THEN scoped.status = 'draft'
               WHEN 'unassigned' THEN NOT scoped.in_mock
               WHEN 'action' THEN scoped.status <> 'archived' AND (
                   (scoped.kind <> 'writing' AND
                    (scoped.status <> 'published' OR NOT COALESCE(scoped.publish_ready, false)))
                   OR COALESCE(scoped.course_level, '') = ''
                   OR NOT scoped.has_cohort)
               ELSE true
           END
    ), page AS (
        SELECT filtered.*
          FROM filtered
         ORDER BY pg_catalog.lower(COALESCE(filtered.code, filtered.title, '')),
                  filtered.id
         LIMIT p_limit OFFSET p_offset
    ), page_rows AS (
        SELECT page.*,
               COALESCE((
                   SELECT pg_catalog.jsonb_agg(link.cohort_id ORDER BY link.cohort_id)
                     FROM public.exam_content_cohorts AS link
                    WHERE link.content_kind = page.kind
                      AND link.content_id = page.id
               ), '[]'::jsonb) AS cohort_ids,
               COALESCE((
                   SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'id', exam.id, 'code', exam.code,
                       'title', exam.title, 'status', exam.status
                   ) ORDER BY exam.created_at DESC, exam.id DESC)
                     FROM public.mock_exams AS exam
                    WHERE (page.kind = 'reading' AND exam.reading_test_id = page.id)
                       OR (page.kind = 'listening' AND exam.listening_test_id = page.id)
                       OR (page.kind = 'writing' AND (
                           exam.writing_task1_prompt_id = page.id
                           OR exam.writing_task2_prompt_id = page.id))
               ), '[]'::jsonb) AS mock_exams
          FROM page
    )
    SELECT pg_catalog.jsonb_build_object(
        'ids', COALESCE((SELECT pg_catalog.jsonb_agg(page.id ORDER BY
            pg_catalog.lower(COALESCE(page.code, page.title, '')), page.id)
            FROM page), '[]'::jsonb),
        'rows', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page_rows) ORDER BY
            pg_catalog.lower(COALESCE(page_rows.code, page_rows.title, '')), page_rows.id)
            FROM page_rows), '[]'::jsonb),
        'total', (SELECT pg_catalog.count(*) FROM filtered)
    ) INTO v_result;
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_exam_content_page_ids(
    text, text, uuid, boolean, boolean, text, text, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_exam_content_page_ids(
    text, text, uuid, boolean, boolean, text, text, integer, integer
) TO service_role;

COMMENT ON FUNCTION public.fn_admin_exam_content_page_ids(
    text, text, uuid, boolean, boolean, text, text, integer, integer
) IS 'Backend-only bounded admin catalog. Filtered count, page rows, cohorts and mock references share one statement snapshot.';

CREATE OR REPLACE FUNCTION public.fn_admin_exam_content_levels(p_kind text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_result jsonb;
BEGIN
    IF p_kind IS NULL OR p_kind NOT IN ('reading', 'listening', 'writing') THEN
        RAISE EXCEPTION 'invalid_admin_exam_content_level_kind' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(pg_catalog.jsonb_agg(level ORDER BY level), '[]'::jsonb)
      INTO v_result
      FROM (
          SELECT DISTINCT pg_catalog.btrim(course_level) AS level
            FROM public.reading_tests WHERE p_kind = 'reading'
          UNION
          SELECT DISTINCT pg_catalog.btrim(course_level)
            FROM public.listening_tests WHERE p_kind = 'listening'
          UNION
          SELECT DISTINCT pg_catalog.btrim(course_level)
            FROM public.writing_prompts WHERE p_kind = 'writing'
      ) AS levels
     WHERE level IS NOT NULL AND level <> '';
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_exam_content_levels(text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_exam_content_levels(text)
    TO service_role;

CREATE OR REPLACE VIEW public.listening_public_practice_catalog WITH (security_barrier=true) AS
    SELECT t.* FROM public.listening_tests t WHERE public.fn_mock_public_practice_allowed('listening',t.id);
REVOKE ALL ON public.listening_public_practice_catalog FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.listening_public_practice_catalog TO service_role;

DO $$
BEGIN
    IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_admin_exam_content_page_ids(text,text,uuid,boolean,boolean,text,text,integer,integer)'::pg_catalog.regprocedure) IS DISTINCT FROM '2e9d91fb7d1a8c7e5f173ad3747c72e839e99a23dd4b337d19137903a6b438e7'
       OR (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.fn_admin_exam_content_levels(text)'::pg_catalog.regprocedure) IS DISTINCT FROM 'f1cd4fe03508d72548f5f34c2c3ecb52260d2a9db6d2e31f7338c6796414050c'
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid IN ('public.fn_admin_exam_content_page_ids(text,text,uuid,boolean,boolean,text,text,integer,integer)'::pg_catalog.regprocedure, 'public.fn_admin_exam_content_levels(text)'::pg_catalog.regprocedure)
          AND (NOT p.prosecdef OR p.provolatile <> 's' OR p.proowner <> 'postgres'::pg_catalog.regrole
               OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
               OR NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
        WHERE p.oid IN ('public.fn_admin_exam_content_page_ids(text,text,uuid,boolean,boolean,text,text,integer,integer)'::pg_catalog.regprocedure, 'public.fn_admin_exam_content_levels(text)'::pg_catalog.regprocedure)
          AND (acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole) OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable))
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c WHERE c.oid = 'public.listening_public_practice_catalog'::pg_catalog.regclass
                    AND c.relowner = 'postgres'::pg_catalog.regrole
                    AND c.reloptions @> ARRAY['security_barrier=true'] AND pg_catalog.has_table_privilege('service_role',c.oid,'SELECT'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class AS c
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) AS acl
        WHERE c.oid = 'public.listening_public_practice_catalog'::pg_catalog.regclass AND acl.grantee <> c.relowner
          AND (acl.grantee <> 'service_role'::pg_catalog.regrole OR acl.privilege_type <> 'SELECT' OR acl.is_grantable))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a
        JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
        CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS acl
        WHERE c.oid = 'public.listening_public_practice_catalog'::pg_catalog.regclass AND acl.grantee <> c.relowner
          AND (acl.grantee <> 'service_role'::pg_catalog.regrole OR acl.privilege_type <> 'SELECT' OR acl.is_grantable))
       OR pg_catalog.pg_get_viewdef('public.listening_public_practice_catalog'::pg_catalog.regclass) ~ 'NOT ([a-z_]+[.])?restricted' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '382 rollback postcondition failed';
    END IF;
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
