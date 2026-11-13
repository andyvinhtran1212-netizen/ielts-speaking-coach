"""Execute 381/382 and rollbacks on LOCAL scram PostgreSQL 17 only.

381_restricted_content_namespace.sql and 382_restricted_content_sql_readers.sql.
The focused baseline executes real 299/301/306; full historical migration
catalog closure is deliberately not claimed by this fixture. No TEST_PG_URL
or hosted database is used. Each SQL group has one durable request/result.
"""
from __future__ import annotations

import hashlib
import re

from namespace_pg17 import MA, MB, bootstrap, local_pg17, migration


def body(sql):
    return re.search(r"AS \$\$(.*?)\$\$", sql, re.S).group(1)


def test_382_is_exact_301_body_plus_one_source_predicate():
    old = migration("301_admin_exam_content_page_snapshot.sql")
    new = migration(MB).split("CREATE OR REPLACE FUNCTION public.fn_admin_exam_content_page_ids", 1)[1]
    assert body(new) == body(old).replace("WHERE p_kind = 'listening'",
                                          "WHERE p_kind = 'listening' AND NOT paper.restricted")
    assert hashlib.sha256(body(old).encode()).hexdigest() == "2e9d91fb7d1a8c7e5f173ad3747c72e839e99a23dd4b337d19137903a6b438e7"
    down = migration("rollback/" + MB).split("CREATE OR REPLACE FUNCTION public.fn_admin_exam_content_page_ids", 1)[1]
    assert body(down) == body(old)
    old_levels = migration("299_admin_exam_content_page.sql").split("CREATE OR REPLACE FUNCTION public.fn_admin_exam_content_levels", 1)[1]
    down_levels = migration("rollback/" + MB).split("CREATE OR REPLACE FUNCTION public.fn_admin_exam_content_levels", 1)[1]
    assert body(down_levels) == body(old_levels)
    assert migration("rollback/" + MB).count("SET search_path = pg_catalog, public\nAS $$") == 2


def test_namespace_catalog_acl_search_path_and_readiness_fail_closed():
    with local_pg17("catalog") as pg:
        pg.psql(bootstrap() + migration(MA) + migration(MB) + """
DO $$ BEGIN
    PERFORM pg_temp.assert_true(public.fn_content_namespace_ready(), 'ready after M-A and M-B');
    PERFORM pg_temp.assert_true(public.fn_content_is_restricted('listening',gen_random_uuid()), 'missing test');
    PERFORM pg_temp.assert_true(public.fn_content_is_restricted('unknown',NULL), 'unknown kind');
    PERFORM pg_temp.assert_true(public.fn_content_is_restricted('content',NULL), 'NULL identity');
    PERFORM pg_temp.assert_true(public.fn_content_is_restricted('attempt',gen_random_uuid()), 'missing attempt');
    PERFORM pg_temp.assert_true(public.fn_content_is_restricted('dictation',gen_random_uuid()), 'missing dictation');
    PERFORM pg_temp.assert_true(NOT has_table_privilege('anon','public.v_listening_tests_public','SELECT'), 'anon view denied');
    PERFORM pg_temp.assert_true(NOT has_table_privilege('authenticated','public.content_access_namespaces','SELECT'), 'registry client denied');
    PERFORM pg_temp.assert_true(NOT has_table_privilege('service_role','public.listening_public_practice_catalog','UPDATE'), 'catalog select only');
    PERFORM pg_temp.assert_true(NOT has_function_privilege('anon','public.fn_content_namespace_ready()','EXECUTE'), 'ready client denied');
    PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated','public.fn_content_is_restricted(text,uuid)','EXECUTE'), 'flag client denied');
    PERFORM pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid='public.content_access_namespaces'::regclass), 'registry RLS');
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.content_access_namespaces'::regclass), 'registry no policies');
END $$;
SET ROLE service_role;
DO $$ BEGIN
    IF public.fn_content_namespace_ready() IS DISTINCT FROM true THEN RAISE EXCEPTION 'service readiness'; END IF;
END $$;
RESET ROLE;
ALTER TABLE public.listening_content DISABLE TRIGGER trg_zz_content_namespace_stamp;
DO $$ BEGIN PERFORM pg_temp.assert_true(NOT public.fn_content_namespace_ready(), 'disabled trigger fails readiness'); END $$;
ALTER TABLE public.listening_content ENABLE TRIGGER trg_zz_content_namespace_stamp;
GRANT UPDATE ON public.v_listening_content_public TO service_role;
DO $$ BEGIN PERFORM pg_temp.assert_true(NOT public.fn_content_namespace_ready(), 'write-through view fails readiness'); END $$;
REVOKE UPDATE ON public.v_listening_content_public FROM service_role;
CREATE POLICY unexpected_client_policy ON public.content_access_namespaces FOR SELECT TO authenticated USING(true);
DO $$ BEGIN PERFORM pg_temp.assert_true(NOT public.fn_content_namespace_ready(), 'policy fails readiness'); END $$;
DROP POLICY unexpected_client_policy ON public.content_access_namespaces;
GRANT SELECT(programme_id) ON public.content_access_namespaces TO anon;
DO $$ BEGIN PERFORM pg_temp.assert_true(NOT public.fn_content_namespace_ready(), 'column ACL fails readiness'); END $$;
REVOKE SELECT(programme_id) ON public.content_access_namespaces FROM anon;
CREATE PUBLICATION namespace_negative_publication FOR TABLE public.content_access_namespaces;
DO $$ BEGIN PERFORM pg_temp.assert_true(NOT public.fn_content_namespace_ready(), 'publication fails readiness'); END $$;
DROP PUBLICATION namespace_negative_publication;
CREATE FUNCTION public.fn_content_is_restricted(text,text) RETURNS boolean LANGUAGE sql AS 'SELECT false';
DO $$ BEGIN PERFORM pg_temp.assert_true(NOT public.fn_content_namespace_ready(), 'overload fails readiness'); END $$;
DROP FUNCTION public.fn_content_is_restricted(text,text);
REVOKE EXECUTE ON FUNCTION public.fn_content_is_restricted(text,uuid) FROM service_role;
DO $$ BEGIN PERFORM pg_temp.assert_true(NOT public.fn_content_namespace_ready(), 'missing helper grant fails readiness'); END $$;
GRANT EXECUTE ON FUNCTION public.fn_content_is_restricted(text,uuid) TO service_role;
INSERT INTO public.listening_tests(test_id) VALUES ('null-flag');
ALTER TABLE public.listening_tests DISABLE TRIGGER trg_zz_content_namespace_stamp;
ALTER TABLE public.listening_tests ALTER COLUMN restricted DROP NOT NULL;
UPDATE public.listening_tests SET restricted=NULL WHERE test_id='null-flag';
DO $$ BEGIN
    PERFORM pg_temp.assert_true(public.fn_content_is_restricted('listening',(SELECT id FROM public.listening_tests WHERE test_id='null-flag')), 'NULL stamp fails closed');
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.v_listening_tests_public WHERE test_id='null-flag'), 'NULL stamp absent from view');
    PERFORM pg_temp.assert_true(NOT public.fn_content_namespace_ready(), 'nullable column fails readiness');
END $$;
UPDATE public.listening_tests SET restricted=false WHERE test_id='null-flag';
ALTER TABLE public.listening_tests ALTER COLUMN restricted SET NOT NULL;
ALTER TABLE public.listening_tests ENABLE TRIGGER trg_zz_content_namespace_stamp;
DO $$ BEGIN PERFORM pg_temp.assert_true(public.fn_content_namespace_ready(), 'readiness restored'); END $$;
""")


def test_namespace_backfill_provenance_cycles_and_metadata_shapes():
    seed = """
INSERT INTO public.listening_tests(id,test_id,programme_id,metadata) VALUES
 ('00000000-0000-0000-0000-000000000001','ordinary','ielts','{}'),
 ('00000000-0000-0000-0000-000000000002','programme','blackeye-v5-upper-listening','{}'),
 ('00000000-0000-0000-0000-000000000003','marker','ielts','{"blackeye":null}'),
 ('00000000-0000-0000-0000-000000000004','array','ielts','[]'),
 ('00000000-0000-0000-0000-000000000005','string','ielts','""'),
 ('00000000-0000-0000-0000-000000000006','sql-null','ielts',NULL),
 ('00000000-0000-0000-0000-000000000007','json-null','ielts','null'),
 ('00000000-0000-0000-0000-000000000008','number','ielts','12'),
 ('00000000-0000-0000-0000-000000000009','boolean','ielts','false'),
 ('00000000-0000-0000-0000-000000000010','duplicate','ielts','{}'),
 ('00000000-0000-0000-0000-000000000011','duplicate','ielts','{}');
INSERT INTO public.listening_content(id,metadata,source_test_id,parent_content_id) VALUES
 ('10000000-0000-0000-0000-000000000001','{"blackeye":{}}',NULL,NULL),
 ('10000000-0000-0000-0000-000000000002','{}','00000000-0000-0000-0000-000000000002',NULL),
 ('10000000-0000-0000-0000-000000000003','{}',NULL,'10000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000004','{}',NULL,'10000000-0000-0000-0000-000000000003'),
 ('10000000-0000-0000-0000-000000000005','{}',NULL,'10000000-0000-0000-0000-000000000006'),
 ('10000000-0000-0000-0000-000000000006','{}',NULL,'10000000-0000-0000-0000-000000000005'),
 ('10000000-0000-0000-0000-000000000007','{}',NULL,NULL);
INSERT INTO public.dictation_sessions(test_id_external) VALUES('ordinary'),('programme'),('duplicate'),('missing'),(NULL);
INSERT INTO public.listening_test_attempts(id,test_id) VALUES
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
INSERT INTO public.mock_paper_attempt_snapshots(skill,attempt_id,paper_id,paper_revision,policy_revision,attempt_purpose,paper_row,source_rows,marking_rows)
VALUES ('listening','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',1,1,'practice',
 '{"programme_id":"blackeye-v5-upper-listening"}','[]','[]');
"""
    with local_pg17("backfill") as pg:
        output = pg.psql(bootstrap() + seed + migration(MA) + migration(MB) + """
DO $$ DECLARE t record; BEGIN
    FOR t IN SELECT * FROM public.listening_tests LOOP
        PERFORM pg_temp.assert_true(t.restricted = (t.test_id IN ('programme','marker','array','string','number','boolean')), 'test metadata '||t.test_id);
    END LOOP;
    PERFORM pg_temp.assert_true((SELECT count(*)=6 FROM public.listening_content WHERE restricted), 'provenance chain and cycles');
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.v_listening_content_public), 'only native standalone content public');
    PERFORM pg_temp.assert_true(public.fn_namespace_content_restricted(gen_random_uuid(),NULL,NULL,gen_random_uuid(),'{}'), 'unresolved ancestor');
    PERFORM pg_temp.assert_true(public.fn_namespace_content_restricted(gen_random_uuid(),NULL,gen_random_uuid(),NULL,'{}'), 'unresolved source');
    PERFORM pg_temp.assert_true((SELECT count(*)=4 FROM public.dictation_sessions WHERE restricted), 'old unresolved hidden and duplicate dictation restricted');
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.v_dictation_sessions_public), 'only ordinary resolved dictation public');
    PERFORM pg_temp.assert_true((SELECT restricted FROM public.listening_test_attempts LIMIT 1), 'frozen snapshot backfill');
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.v_listening_attempts_public), 'snapshot attempt absent from public view');
    PERFORM pg_temp.assert_true((SELECT count(*)=5 FROM public.v_listening_tests_public), 'public test shape cases');
END $$;
-- SQL is intentionally stricter than legacy Python `or {}` for [] and "".
INSERT INTO public.dictation_sessions(test_id_external) VALUES('unresolved-new');
INSERT INTO public.listening_content(metadata) VALUES('[]'),('""'),('null'),(NULL);
DO $$ BEGIN
    PERFORM pg_temp.assert_true((SELECT restricted FROM public.dictation_sessions WHERE test_id_external='unresolved-new'), 'new unresolved dictation');
    PERFORM pg_temp.assert_true((SELECT count(*)=3 FROM public.v_listening_content_public), 'SQL and json null public; malformed metadata hidden');
END $$;
""")
        assert "381 dictation backfill: 3 unresolved/ambiguous rows; 4 total restricted rows" in output


def test_namespace_stickiness_cascades_nonowner_guc_and_snapshot():
    with local_pg17("sticky") as pg:
        pg.psql(bootstrap() + migration(MA) + migration(MB) + """
INSERT INTO public.listening_tests(id,test_id) VALUES('00000000-0000-0000-0000-000000000001','later-hidden');
INSERT INTO public.listening_content(id,test_id,source_test_id,parent_content_id) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',NULL,NULL),
 ('10000000-0000-0000-0000-000000000002',NULL,'00000000-0000-0000-0000-000000000001',NULL),
 ('10000000-0000-0000-0000-000000000003',NULL,NULL,'10000000-0000-0000-0000-000000000002');
INSERT INTO public.listening_test_attempts(id,test_id) VALUES('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
INSERT INTO public.dictation_sessions(test_id_external) VALUES('later-hidden');
-- This UPDATE does not name restricted: AFTER cascade must still run.
UPDATE public.listening_tests SET metadata='{"blackeye":{}}' WHERE test_id='later-hidden';
DO $$ BEGIN
    PERFORM pg_temp.assert_true((SELECT bool_and(restricted) FROM public.listening_content), 'test to source to ancestor cascade');
    PERFORM pg_temp.assert_true((SELECT bool_and(restricted) FROM public.listening_test_attempts), 'test to attempt cascade');
    PERFORM pg_temp.assert_true((SELECT bool_and(restricted) FROM public.dictation_sessions), 'external dictation cascade');
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.v_listening_attempts_public), 'cascaded attempts excluded');
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.v_dictation_sessions_public), 'cascaded reports excluded');
END $$;
SET ROLE service_role;
BEGIN;
SET LOCAL aver.allow_unrestrict = 'on';
DO $$ DECLARE t text; refused boolean; BEGIN
    FOREACH t IN ARRAY ARRAY['listening_tests','listening_content','listening_test_attempts','dictation_sessions'] LOOP
        refused := false;
        BEGIN EXECUTE format('UPDATE public.%I SET restricted=false WHERE restricted', t);
        EXCEPTION WHEN check_violation THEN refused := true;
        END;
        IF NOT refused THEN RAISE EXCEPTION 'nonowner GUC lowered restriction: %',t; END IF;
    END LOOP;
END $$;
COMMIT;
RESET ROLE;
UPDATE public.listening_tests SET metadata='{}' WHERE test_id='later-hidden';
DELETE FROM public.listening_tests WHERE test_id='later-hidden';
DO $$ BEGIN
    PERFORM pg_temp.assert_true((SELECT bool_and(restricted) FROM public.listening_content), 'ON DELETE SET NULL retains stamp');
    PERFORM pg_temp.assert_true((SELECT bool_and(restricted) FROM public.dictation_sessions), 'orphan dictation stamp');
    PERFORM pg_temp.assert_true((SELECT bool_and(restricted) FROM public.listening_test_attempts), 'catalog removal cannot lower synthetic orphan attempt');
END $$;
INSERT INTO public.listening_tests(id,test_id) VALUES('00000000-0000-0000-0000-000000000002','snapshot-current-ordinary');
INSERT INTO public.listening_test_attempts(id,test_id) VALUES('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
INSERT INTO public.mock_paper_attempt_snapshots(skill,attempt_id,paper_id,paper_revision,policy_revision,attempt_purpose,paper_row,source_rows,marking_rows)
VALUES ('listening','20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002',1,1,'practice',
 '{"metadata":{"blackeye":{}}}','[]','[]');
DELETE FROM public.listening_tests WHERE test_id='snapshot-current-ordinary';
DO $$ BEGIN
    PERFORM pg_temp.assert_true((SELECT restricted FROM public.listening_test_attempts WHERE id='20000000-0000-0000-0000-000000000002'), 'late snapshot and catalog removal');
END $$;
-- A content-only marker also propagates, with no restricted column in SET.
INSERT INTO public.listening_content(id) VALUES('10000000-0000-0000-0000-000000000004');
INSERT INTO public.listening_content(id,parent_content_id) VALUES('10000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000004');
UPDATE public.listening_content SET metadata='{"blackeye":null}' WHERE id='10000000-0000-0000-0000-000000000004';
DO $$ BEGIN PERFORM pg_temp.assert_true((SELECT restricted FROM public.listening_content WHERE id='10000000-0000-0000-0000-000000000005'), 'content metadata cascade'); END $$;
INSERT INTO public.listening_content(id) VALUES('10000000-0000-0000-0000-000000000006');
INSERT INTO public.listening_content(id,parent_content_id) VALUES('10000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000006');
UPDATE public.listening_content SET parent_content_id='10000000-0000-0000-0000-000000000007' WHERE id='10000000-0000-0000-0000-000000000006';
DO $$ BEGIN PERFORM pg_temp.assert_true((SELECT bool_and(restricted) FROM public.listening_content WHERE id IN (
 '10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000007')), 'new provenance cycle'); END $$;
""")


def test_namespace_backfill_crosses_keyset_batch_boundaries_on_all_four_tables():
    with local_pg17("batch-backfill") as pg:
        pg.psql(bootstrap() + """
INSERT INTO public.listening_tests(id,test_id,metadata)
SELECT ('00000000-0000-0000-0001-'||lpad(n::text,12,'0'))::uuid,'batch-'||n,
       CASE WHEN n IN (1000,1001,2001) THEN '{"blackeye":{}}'::jsonb ELSE '{}'::jsonb END
FROM generate_series(1,2001) n;
INSERT INTO public.listening_content(id,test_id) SELECT id,id FROM public.listening_tests;
INSERT INTO public.listening_test_attempts(id,test_id) SELECT id,id FROM public.listening_tests;
INSERT INTO public.dictation_sessions(id,test_id_external) SELECT id,test_id FROM public.listening_tests;
""" + migration(MA) + migration(MB) + """
DO $$ DECLARE t text; total bigint; hidden bigint; BEGIN
    FOREACH t IN ARRAY ARRAY['listening_tests','listening_content','listening_test_attempts','dictation_sessions'] LOOP
        EXECUTE format('SELECT count(*),count(*) FILTER (WHERE restricted) FROM public.%I',t) INTO total,hidden;
        PERFORM pg_temp.assert_true(total=2001 AND hidden=3, 'keyset backfill at 1000/1001/2001: '||t);
    END LOOP;
    PERFORM pg_temp.assert_true((public.fn_admin_exam_content_page_ids('listening')->>'total')::bigint=1998, 'count excludes every restricted batch boundary');
END $$;
""")


def test_namespace_pages_counts_attention_cohort_levels_and_catalog_parity():
    seed = """
INSERT INTO public.listening_tests(test_id,title,course_level,is_public,exam_only,status)
SELECT 'paper-'||lpad(n::text,2,'0'), 'Ordinary '||n, CASE WHEN n%3=0 THEN NULL ELSE 'B1' END,
       true,false,CASE WHEN n%4=0 THEN 'draft' ELSE 'published' END FROM generate_series(1,12) n;
INSERT INTO public.reading_tests(test_id,title,course_level,is_public,exam_only) VALUES('reading','Reading','R1',true,false);
INSERT INTO public.writing_prompts(title,course_level) VALUES('Writing','W1');
INSERT INTO public.exam_content_cohorts SELECT 'listening',id,'30000000-0000-0000-0000-000000000001'::uuid
    FROM public.listening_tests WHERE test_id IN ('paper-01','paper-03','paper-05');
INSERT INTO public.mock_exams(code,title,listening_test_id) SELECT 'mock','Mock',id FROM public.listening_tests WHERE test_id='paper-01';
CREATE TEMP TABLE expected(kind text, attention text, cohort uuid, off int, result jsonb);
DO $$ DECLARE k text; a text; c uuid; off int; BEGIN
    FOREACH k IN ARRAY ARRAY['reading','listening','writing'] LOOP
        FOREACH a IN ARRAY ARRAY['all','action','unassigned','no-level','draft'] LOOP
            FOREACH c IN ARRAY ARRAY[NULL::uuid,'30000000-0000-0000-0000-000000000001'::uuid] LOOP
                FOREACH off IN ARRAY ARRAY[0,5,10,15] LOOP
                    INSERT INTO expected VALUES(k,a,c,off,public.fn_admin_exam_content_page_ids(k,NULL,c,NULL,NULL,NULL,a,5,off));
                END LOOP;
            END LOOP;
        END LOOP;
    END LOOP;
END $$;
CREATE TEMP TABLE expected_catalog AS SELECT id FROM public.listening_public_practice_catalog;
CREATE TEMP TABLE expected_levels AS SELECT k,public.fn_admin_exam_content_levels(k) levels FROM unnest(ARRAY['reading','listening','writing']) k;
"""
    check = """
INSERT INTO public.listening_tests(test_id,title,course_level,is_public,exam_only,metadata)
SELECT 'paper-'||lpad(n::text,2,'0')||'-hidden','Hidden '||n,'SECRET-ONLY',true,false,'{"blackeye":{}}' FROM generate_series(1,12) n;
DO $$ DECLARE e record; actual jsonb; BEGIN
    FOR e IN SELECT * FROM expected LOOP
        actual := public.fn_admin_exam_content_page_ids(e.kind,NULL,e.cohort,NULL,NULL,NULL,e.attention,5,e.off);
        PERFORM pg_temp.assert_true(actual=e.result, '301 full result parity '||e.kind||'/'||e.attention||'/'||e.off);
        PERFORM pg_temp.assert_true(jsonb_array_length(actual->'ids')=jsonb_array_length(actual->'rows'), 'page hydration parity');
    END LOOP;
    PERFORM pg_temp.assert_true(NOT EXISTS((SELECT id FROM expected_catalog EXCEPT SELECT id FROM public.listening_public_practice_catalog)
        UNION ALL (SELECT id FROM public.listening_public_practice_catalog EXCEPT SELECT id FROM expected_catalog)), '306 catalog parity');
    FOR e IN SELECT * FROM expected_levels LOOP
        PERFORM pg_temp.assert_true(public.fn_admin_exam_content_levels(e.k)=e.levels, '299 levels parity '||e.k);
    END LOOP;
    PERFORM pg_temp.assert_true(public.fn_admin_exam_content_levels('listening')='["B1"]'::jsonb, 'hidden-only level absent');
END $$;
"""
    page = body(migration("301_admin_exam_content_page_snapshot.sql"))
    query = page[page.index("    WITH source AS ("):page.index(" INTO v_result;")].strip() + ";"
    query = query.replace("WHERE p_kind = 'listening'", "WHERE p_kind = 'listening' AND NOT paper.restricted")
    values = {"p_kind": "'listening'::text", "p_course_level": "NULL::text", "p_cohort_id": "NULL::uuid",
              "p_exam_only": "NULL::boolean", "p_is_public": "NULL::boolean", "p_attention": "'all'::text",
              "p_limit": "5", "p_offset": "0", "v_query": "NULL::text"}
    query = re.sub(r"\b(" + "|".join(values) + r")\b", lambda m: values[m.group()], query)
    with local_pg17("pages") as pg:
        # EXPLAIN is recorded in the group result, without a plan-shape gate.
        pg.psql(bootstrap() + seed + migration(MA) + migration(MB) + check
                + "\nEXPLAIN (ANALYZE, COSTS OFF, BUFFERS) " + query)


def test_namespace_rollback_body_drift_and_restricted_data_refusals_then_restore():
    down_a, down_b = migration("rollback/" + MA), migration("rollback/" + MB)
    # Run a rollback inside a subtransaction to inspect its refusal atomically.
    def nested(sql):
        return sql.replace("BEGIN;", "", 1).rsplit("COMMIT;", 1)[0]

    checks = """
DO $probe$ BEGIN
    PERFORM pg_temp.expect_state($unsafe$%s$unsafe$, '55000');
END $probe$;
INSERT INTO public.listening_tests(test_id,metadata) VALUES('restricted-rollback','{"blackeye":{}}');
DO $probe$ BEGIN
    PERFORM pg_temp.expect_state($unsafe$%s$unsafe$, '55000');
END $probe$;
DELETE FROM public.listening_tests WHERE test_id='restricted-rollback';
ALTER FUNCTION public.fn_admin_exam_content_page_ids(text,text,uuid,boolean,boolean,text,text,integer,integer) SET search_path=public,pg_temp;
DO $probe$ BEGIN PERFORM pg_temp.expect_state($unsafe$%s$unsafe$, '55000'); END $probe$;
ALTER FUNCTION public.fn_admin_exam_content_page_ids(text,text,uuid,boolean,boolean,text,text,integer,integer) SET search_path=pg_catalog,pg_temp;
""" % (nested(down_a), nested(down_b), nested(down_b))
    with local_pg17("rollback") as pg:
        pg.psql(bootstrap() + """
CREATE TEMP TABLE original_functions AS
SELECT proname,prosrc,proconfig,proacl,proowner FROM pg_proc WHERE oid IN (
 'public.fn_admin_exam_content_page_ids(text,text,uuid,boolean,boolean,text,text,integer,integer)'::regprocedure,
 'public.fn_admin_exam_content_levels(text)'::regprocedure);
""" + migration(MA) + migration(MB) + checks + down_b + down_a + """
DO $$ BEGIN
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM original_functions o JOIN pg_proc p ON p.proname=o.proname
        WHERE p.prosrc IS DISTINCT FROM o.prosrc OR p.proconfig IS DISTINCT FROM o.proconfig
           OR p.proacl IS DISTINCT FROM o.proacl OR p.proowner IS DISTINCT FROM o.proowner), 'original SQL functions restored');
    PERFORM pg_temp.assert_true(to_regprocedure('public.fn_content_namespace_ready()') IS NULL, 'M-A functions removed');
    PERFORM pg_temp.assert_true((SELECT count(*)=4 FROM pg_attribute WHERE attname='restricted' AND NOT attisdropped
        AND attrelid IN ('public.listening_tests'::regclass,'public.listening_content'::regclass,
                        'public.listening_test_attempts'::regclass,'public.dictation_sessions'::regclass)), 'stamps intentionally retained');
    PERFORM pg_temp.assert_true(to_regclass('public.ix_listening_tests_unrestricted') IS NULL, 'indexes removed');
END $$;
""" + migration(MA) + migration(MB) + """
DO $$ BEGIN PERFORM pg_temp.assert_true(public.fn_content_namespace_ready(), 'rollback reapply with retained columns'); END $$;
""")
