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
