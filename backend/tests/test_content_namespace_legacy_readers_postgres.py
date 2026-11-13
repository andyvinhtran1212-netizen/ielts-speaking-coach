"""Exercise internal writers without certifying their still-OPEN RPC callers."""
from namespace_pg17 import MA, MB, bootstrap, local_pg17, migration

ACTIVE = """
CREATE OR REPLACE FUNCTION public.fn_mock_admission_contract_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS 'SELECT true';
"""


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
