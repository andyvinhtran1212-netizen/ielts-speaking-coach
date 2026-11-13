"""Exercise internal writers without certifying their still-OPEN RPC callers."""
from namespace_pg17 import MA, MB, bootstrap, local_pg17, migration

ACTIVE = """
CREATE OR REPLACE FUNCTION public.fn_mock_admission_contract_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS 'SELECT true';
"""


def test_practice_predicate_rejects_restricted_missing_and_null_without_breaking_reading():
    with local_pg17("legacy-practice-predicate") as pg:
        pg.psql(bootstrap() + """
INSERT INTO public.listening_tests(id,test_id,is_public,metadata) VALUES
 ('00000000-0000-0000-0000-000000000001','hidden-practice',true,'{"blackeye":{}}'),
 ('00000000-0000-0000-0000-000000000002','ordinary-practice',true,'{}');
INSERT INTO public.reading_tests(id,test_id,is_public) VALUES
 ('00000000-0000-0000-0000-000000000003','ordinary-reading',true);
DO $$ BEGIN
    PERFORM pg_temp.assert_true(public.fn_mock_public_practice_allowed('listening','00000000-0000-0000-0000-000000000001'), 'old eligibility hole reproduced');
END $$;
""" + migration(MA) + migration(MB) + """
DO $$ BEGIN
    PERFORM pg_temp.assert_true(NOT public.fn_mock_public_practice_allowed('listening','00000000-0000-0000-0000-000000000001'), 'restricted eligibility false');
    PERFORM pg_temp.assert_true(NOT public.fn_mock_public_practice_allowed('listening',gen_random_uuid()), 'missing eligibility false');
    PERFORM pg_temp.assert_true(NOT public.fn_mock_public_practice_allowed('listening',NULL), 'null eligibility false');
    PERFORM pg_temp.assert_true(public.fn_mock_public_practice_allowed('listening','00000000-0000-0000-0000-000000000002'), 'ordinary eligibility preserved');
    PERFORM pg_temp.assert_true(public.fn_mock_public_practice_allowed('reading','00000000-0000-0000-0000-000000000003'), 'reading eligibility preserved');
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.reading_public_practice_catalog), 'shared Reading view preserved');
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.listening_public_practice_catalog), 'Listening view excludes restricted');
END $$;
SET ROLE service_role;
DO $$ BEGIN
    PERFORM pg_temp.assert_true(NOT public.fn_mock_public_practice_allowed('listening','00000000-0000-0000-0000-000000000001'), 'service RPC cannot admit generic restricted practice');
END $$;
RESET ROLE;
""")


def test_capture_and_attempt_guard_keep_restricted_snapshots_private():
    with local_pg17("legacy-capture-attempt") as pg:
        pg.psql(bootstrap() + migration("311_mock_submitted_parent_lifecycle.sql") + migration(MA) + migration(MB) + ACTIVE + """
INSERT INTO public.listening_tests(id,test_id,is_public,metadata) VALUES
 ('00000000-0000-0000-0000-000000000001','private-snapshot',true,'{"blackeye":{}}'),
 ('00000000-0000-0000-0000-000000000002','ordinary-snapshot',true,'{}');
INSERT INTO public.listening_content(test_id,section_num,transcript) VALUES
 ('00000000-0000-0000-0000-000000000001',1,'private transcript');
INSERT INTO public.listening_test_attempts(id,test_id,user_id,attempt_purpose) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',gen_random_uuid(),'practice'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002',gen_random_uuid(),'practice');
DO $$ DECLARE f regprocedure; BEGIN
    PERFORM pg_temp.assert_true((SELECT count(*)=2 FROM public.mock_paper_attempt_snapshots), '306 capture executed for both identities');
    PERFORM pg_temp.assert_true((SELECT source_rows->0->>'transcript'='private transcript' FROM public.mock_paper_attempt_snapshots
        WHERE attempt_id='10000000-0000-0000-0000-000000000001'), 'private source capture preserved');
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.v_listening_attempts_public), 'restricted capture excluded from generic activity');
    PERFORM pg_temp.assert_true((SELECT paper_revision=1 AND policy_revision=0 AND restricted FROM public.listening_test_attempts
        WHERE id='10000000-0000-0000-0000-000000000001'), 'revisions and namespace stamped');
    PERFORM pg_temp.expect_state('UPDATE public.listening_test_attempts SET user_id=gen_random_uuid()', 'P0001');
    FOREACH f IN ARRAY ARRAY['public.fn_capture_mock_paper_snapshot()'::regprocedure,
                             'public.fn_guard_mock_paper_attempt()'::regprocedure] LOOP
        PERFORM pg_temp.assert_true((SELECT prorettype='trigger'::regtype FROM pg_proc WHERE oid=f), 'trigger result only');
        PERFORM pg_temp.assert_true(NOT has_function_privilege('anon',f,'EXECUTE')
            AND NOT has_function_privilege('authenticated',f,'EXECUTE'), 'trigger client ACL');
        PERFORM pg_temp.expect_state('SELECT '||f::text, '0A000');
    END LOOP;
    PERFORM pg_temp.assert_true(NOT has_table_privilege('anon','public.mock_paper_attempt_snapshots','SELECT')
        AND NOT has_table_privilege('authenticated','public.mock_paper_attempt_snapshots','SELECT'), 'snapshot client ACL');
END $$;
""")


def test_generic_admission_owned_review_inspection_and_new_links_fail_closed():
    with local_pg17("legacy-boundaries") as pg:
        pg.psql(bootstrap() + """
INSERT INTO public.listening_tests(id,test_id,is_public,metadata) VALUES
 ('00000000-0000-0000-0000-000000000001','hidden-boundary',true,'{"blackeye":{}}'),
 ('00000000-0000-0000-0000-000000000002','ordinary-boundary',false,'{}');
INSERT INTO public.listening_test_attempts(id,test_id,user_id,status) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',gen_random_uuid(),'submitted'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002',gen_random_uuid(),'submitted');
-- Preserve a historical binding to prove new sitting/assignment links are denied.
INSERT INTO public.mock_exams(id,code,listening_test_id) VALUES
 ('20000000-0000-0000-0000-000000000001','historical-hidden','00000000-0000-0000-0000-000000000001');
""" + migration(MA) + migration(MB) + """
DO $$ DECLARE id uuid; row jsonb; kind text; statement text; BEGIN
    FOREACH id IN ARRAY ARRAY['00000000-0000-0000-0000-000000000001'::uuid,gen_random_uuid(),NULL::uuid] LOOP
        PERFORM pg_temp.expect_state(format('SELECT public.fn_admit_mock_paper_attempt(''listening'',%L,NULL,NULL)',id), 'P0001');
        PERFORM pg_temp.expect_state(format('SELECT public.fn_inspect_mock_paper_policy(''listening'',%L)',id), 'P0001');
    END LOOP;
    PERFORM pg_temp.assert_true(public.fn_inspect_mock_paper_policy('listening','00000000-0000-0000-0000-000000000002')->>'content_id'
        ='00000000-0000-0000-0000-000000000002', 'ordinary policy inspection preserved');
    SELECT to_jsonb(a) INTO row FROM public.listening_test_attempts a WHERE a.id='10000000-0000-0000-0000-000000000001';
    PERFORM pg_temp.expect_state(format('SELECT public.fn_guard_owned_mock_attempt(''listening'',%L,''review'')',row), 'P0001');
    PERFORM pg_temp.expect_state('SELECT public.fn_guard_owned_mock_attempt(''listening'',''{}'',''review'')', 'P0001');
    SELECT to_jsonb(a) INTO row FROM public.listening_test_attempts a WHERE a.id='10000000-0000-0000-0000-000000000002';
    PERFORM pg_temp.assert_true(public.fn_guard_owned_mock_attempt('listening',row,'review')->>'allowed'='true', 'ordinary submitted review preserved');
    -- This guard must work BEFORE 308 activation as well as after it.
    FOR statement IN SELECT unnest(ARRAY[
        $s$INSERT INTO public.mock_exams(code,listening_test_id) VALUES('blocked','00000000-0000-0000-0000-000000000001')$s$,
        $s$INSERT INTO public.mock_exam_sittings(mock_exam_id,user_id) VALUES('20000000-0000-0000-0000-000000000001',gen_random_uuid())$s$,
        $s$INSERT INTO public.mock_exam_assignments(exam_id,skills) VALUES('20000000-0000-0000-0000-000000000001',ARRAY['listening'])$s$,
        $s$INSERT INTO public.class_assignments(skill,content_id) VALUES('listening','00000000-0000-0000-0000-000000000001')$s$
    ]) LOOP
        PERFORM pg_temp.expect_state(statement, 'P0001');
    END LOOP;
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.mock_exams), 'failed links left no writes');
END $$;
INSERT INTO public.mock_exams(code,listening_test_id) VALUES('ordinary-link','00000000-0000-0000-0000-000000000002');
UPDATE public.mock_exams SET listening_test_id=NULL WHERE code='historical-hidden';
DO $$ BEGIN
    PERFORM pg_temp.assert_true((SELECT listening_test_id IS NULL FROM public.mock_exams WHERE code='historical-hidden'), 'historical unlink preserved');
END $$;
CREATE OR REPLACE FUNCTION public.fn_mock_admission_contract_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS 'SELECT true';
DO $$ BEGIN
    PERFORM pg_temp.expect_state($s$INSERT INTO public.mock_exams(code,listening_test_id)
        VALUES('blocked-active','00000000-0000-0000-0000-000000000001')$s$, 'P0001');
END $$;
INSERT INTO public.mock_exams(id,code,listening_test_id,status,active_section,listening_started_at) VALUES
 ('20000000-0000-0000-0000-000000000002','ordinary-live','00000000-0000-0000-0000-000000000002','published','listening',now());
INSERT INTO public.mock_exam_sittings(id,mock_exam_id,user_id) VALUES
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000002');
DO $$ DECLARE receipt jsonb; BEGIN
    receipt := public.fn_admit_mock_paper_attempt('listening','00000000-0000-0000-0000-000000000002',
        '90000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002');
    PERFORM pg_temp.assert_true(receipt->>'mock_sitting_id'='30000000-0000-0000-0000-000000000002'
        AND receipt->>'attempt_purpose'='mock_delivery' AND receipt->>'attempt_id' IS NOT NULL, 'ordinary mock admission preserved');
END $$;
""")


def test_policy_source_and_reading_answer_guards_are_internal_writers():
    with local_pg17("legacy-write-guards") as pg:
        pg.psql(bootstrap() + migration(MA) + migration(MB) + ACTIVE + """
INSERT INTO public.listening_tests(id,test_id,is_public,metadata) VALUES
 ('00000000-0000-0000-0000-000000000001','restricted-writer',true,'{"blackeye":{}}');
UPDATE public.listening_tests SET is_public=false WHERE test_id='restricted-writer';
INSERT INTO public.listening_content(test_id,section_num,transcript) VALUES
 ('00000000-0000-0000-0000-000000000001',1,'internal source');
INSERT INTO public.reading_tests(id,test_id,is_public) VALUES
 ('00000000-0000-0000-0000-000000000002','reading-writer',true);
INSERT INTO public.reading_test_attempts(id,test_id,user_id,attempt_purpose) VALUES
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002',gen_random_uuid(),'practice');
INSERT INTO public.reading_attempt_answers(attempt_id,q_num,user_answer) VALUES
 ('10000000-0000-0000-0000-000000000002',1,'ordinary answer');
DO $$ DECLARE f regprocedure; BEGIN
    PERFORM pg_temp.assert_true((SELECT policy_revision=1 AND mock_content_revision=1 AND restricted
        FROM public.listening_tests WHERE test_id='restricted-writer'), 'policy and source writers preserve namespace');
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.mock_correction_release_events
        WHERE action='mock_paper_policy_updated'), 'policy receipt persisted internally');
    PERFORM pg_temp.assert_true((SELECT bool_and(restricted) FROM public.listening_content), 'source write remains excluded');
    PERFORM pg_temp.assert_true((SELECT user_answer='ordinary answer' FROM public.reading_attempt_answers), 'reading answer writer preserved');
    FOREACH f IN ARRAY ARRAY['public.fn_guard_mock_paper_policy()'::regprocedure,
        'public.fn_guard_mock_paper_source()'::regprocedure,'public.fn_guard_mock_reading_answer()'::regprocedure] LOOP
        PERFORM pg_temp.assert_true((SELECT prorettype='trigger'::regtype FROM pg_proc WHERE oid=f), 'writer result only');
        PERFORM pg_temp.assert_true(NOT has_function_privilege('anon',f,'EXECUTE')
            AND NOT has_function_privilege('authenticated',f,'EXECUTE'), 'writer client ACL');
        PERFORM pg_temp.expect_state('SELECT '||f::text, '0A000');
    END LOOP;
END $$;
""")


def test_additional_reader_rollback_refuses_config_and_acl_drift_atomically():
    down = migration("rollback/" + MB).replace("BEGIN;", "", 1).rsplit("COMMIT;", 1)[0]
    with local_pg17("legacy-rollback-drift") as pg:
        pg.psql(bootstrap() + migration(MA) + migration(MB) + """
DO $probe$ DECLARE routine regprocedure; BEGIN
    FOREACH routine IN ARRAY ARRAY[
        'public.fn_mock_public_practice_allowed(text,uuid)'::regprocedure,
        'public.fn_admit_mock_paper_attempt(text,uuid,uuid,uuid,text)'::regprocedure,
        'public.fn_guard_owned_mock_attempt(text,jsonb,text)'::regprocedure,
        'public.fn_inspect_mock_paper_policy(text,uuid)'::regprocedure,
        'public.fn_guard_mock_paper_reference()'::regprocedure] LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path=public,pg_temp',routine);
        PERFORM pg_temp.expect_state($down$""" + down + """$down$, '55000');
        EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,pg_temp',routine);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',routine);
        PERFORM pg_temp.expect_state($down$""" + down + """$down$, '55000');
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated',routine);
        PERFORM pg_temp.assert_true(public.fn_content_namespace_ready(), 'failed rollback kept namespace catalog intact');
        PERFORM pg_temp.assert_true((SELECT proconfig=ARRAY['search_path=pg_catalog, pg_temp'] FROM pg_proc
            WHERE oid='public.fn_admin_exam_content_levels(text)'::regprocedure), 'failed rollback kept other functions installed');
    END LOOP;
END $probe$;
""")


def test_reader_namespace_checks_hold_the_canonical_paper_lock():
    # A runtime spy fails if classification occurs before the same advisory
    # lock that serializes paper changes. Each probe is its own transaction.
    with local_pg17("legacy-reader-locks") as pg:
        pg.psql(bootstrap() + migration(MA) + migration(MB) + """
INSERT INTO public.listening_tests(id,test_id,metadata) VALUES
 ('00000000-0000-0000-0000-000000000001','locked-hidden','{"blackeye":{}}');
INSERT INTO public.listening_test_attempts(id,test_id,status) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','submitted');
CREATE OR REPLACE FUNCTION public.fn_content_is_restricted(p_kind text,p_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
DECLARE paper_id uuid; flag boolean; lock_key bigint;
BEGIN
    IF p_kind='attempt' THEN
        SELECT a.test_id,a.restricted INTO paper_id,flag FROM public.listening_test_attempts a WHERE a.id=p_id;
    ELSE
        SELECT t.id,t.restricted INTO paper_id,flag FROM public.listening_tests t WHERE t.id=p_id;
    END IF;
    lock_key := pg_catalog.hashtextextended('mock-paper:listening:'||paper_id::text,0);
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE pid=pg_catalog.pg_backend_pid() AND locktype='advisory'
        AND classid::bigint=((lock_key >> 32) & 4294967295) AND objid::bigint=(lock_key & 4294967295)
        AND objsubid=1 AND granted AND mode='ExclusiveLock') THEN
        RAISE EXCEPTION 'namespace guard checked without the canonical paper lock' USING ERRCODE='55000';
    END IF;
    RETURN COALESCE(flag,true);
END $$;
DO $$ BEGIN
    PERFORM pg_temp.assert_true(NOT public.fn_mock_public_practice_allowed('listening','00000000-0000-0000-0000-000000000001'), 'practice flag checked under lock');
END $$;
DO $$ BEGIN
    PERFORM pg_temp.expect_state($s$SELECT public.fn_admit_mock_paper_attempt('listening','00000000-0000-0000-0000-000000000001',NULL,NULL)$s$, 'P0001');
END $$;
DO $$ BEGIN
    PERFORM pg_temp.expect_state($s$SELECT public.fn_inspect_mock_paper_policy('listening','00000000-0000-0000-0000-000000000001')$s$, 'P0001');
END $$;
DO $$ DECLARE attempt jsonb; BEGIN
    SELECT to_jsonb(a) INTO attempt FROM public.listening_test_attempts a WHERE id='10000000-0000-0000-0000-000000000001';
    PERFORM pg_temp.expect_state(format('SELECT public.fn_guard_owned_mock_attempt(''listening'',%L,''review'')',attempt), 'P0001');
END $$;
DO $$ BEGIN
    PERFORM pg_temp.expect_state($s$INSERT INTO public.mock_exams(code,listening_test_id) VALUES('blocked-lock','00000000-0000-0000-0000-000000000001')$s$, 'P0001');
END $$;
""")
