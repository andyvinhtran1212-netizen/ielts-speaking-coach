"""Combined real affected history; unexecuted full history remains PARTIAL."""
import json
from pathlib import Path
import re

import pytest

from namespace_catalog_state import STATE_SQL, retained_column_normalization, states
from namespace_history import history_bootstrap, package_import_sql
from namespace_pg17 import MA, MB, local_pg17, migration
from namespace_sql_inventory import CATALOG_SQL, audit_catalog, from_output, load_allowlist, readers


def test_combined_history_catalog_and_namespace_readiness():
    with local_pg17("combined-history") as pg:
        output = pg.psql(history_bootstrap() + migration(MA) + migration(MB) + """
DO $$ BEGIN
    PERFORM pg_temp.assert_true(public.fn_content_namespace_ready(), 'combined 295/305/306/353/376/379/380 catalog ready');
    PERFORM pg_temp.assert_true(public.fn_listening_drill_homework_ready(), '380 readiness retained');
END $$;
""" + CATALOG_SQL)
        catalog, = from_output(output)
        found = readers(catalog)
        opened = sorted(set(found) - set(load_allowlist()))
        (pg.log_dir / "combined-history-OPEN.json").write_text(json.dumps(opened, indent=2) + "\n")
        (pg.log_dir / "combined-history-catalog.json").write_text(json.dumps(catalog, indent=2) + "\n")
        with pytest.raises(AssertionError, match="unlisted SQL reader") as audit:
            audit_catalog(catalog)
        (pg.log_dir / "combined-history-audit.txt").write_text(str(audit.value) + "\n")
        fixtures = Path(__file__).with_name("fixtures")
        baseline = json.loads((fixtures / "restricted_content_sql_OPEN.json").read_text())
        additional = json.loads((fixtures / "restricted_content_sql_history_OPEN.json").read_text())
        assert all(r["state"] == "OPEN" and r["owner"] and r["reason"] for r in baseline + additional)
        assert opened == sorted(r["object"] for r in baseline + additional), "Combined history may not silently acquire new readers"
        assert str(audit.value).splitlines() == [
            f"unlisted SQL reader: {key} ({','.join(found[key]['tables']) or 'dynamic relation'})"
            for key in opened
        ], "Proven readers must still pass every safety check in the combined catalog"
        assert "public.fn_guard_blackeye_admission()" in found


def test_combined_history_rollback_restores_whole_catalog_with_only_retained_columns():
    with local_pg17("combined-history-rollback") as pg:
        output = pg.psql(history_bootstrap() + STATE_SQL + migration(MA) + migration(MB)
                         + migration("rollback/" + MB) + migration("rollback/" + MA) + STATE_SQL)
        before, after = states(output)
        normalized = retained_column_normalization(after)
        diff = {key: {"before": before.get(key), "after": normalized.get(key)}
                for key in before.keys() | normalized.keys() if before.get(key) != normalized.get(key)}
        (pg.log_dir / "rollback-full-catalog-diff.json").write_text(json.dumps(diff, indent=2) + "\n")
        assert not diff, "Only SA-permitted retained columns/view projection may differ after rollback"
        added = set(after) - set(before)
        assert added == {"column:" + name + ".restricted" for name in (
            "listening_tests", "listening_content", "listening_test_attempts", "dictation_sessions", "listening_public_practice_catalog")}


def test_358_combination_refuses_before_replacing_original_sql_configs():
    forward = migration(MB).replace("BEGIN;", "", 1).rsplit("COMMIT;", 1)[0]
    with local_pg17("history-358-refusal") as pg:
        pg.psql(history_bootstrap() + migration("358_public_function_search_path_pin.sql") + migration(MA) + """
DO $probe$ BEGIN
    PERFORM pg_temp.expect_state($forward$""" + forward + """$forward$, '55000');
    PERFORM pg_temp.assert_true((SELECT proconfig=ARRAY['search_path=pg_catalog, public, pg_temp'] FROM pg_proc
        WHERE oid='public.fn_admin_exam_content_levels(text)'::regprocedure), '358 hardening was not overwritten');
END $probe$;
""")


def test_combined_active_history_import_capture_flags_and_exact_376_admission_blocker():
    with local_pg17("combined-history-active") as pg:
        pg.psql(history_bootstrap(active=True) + package_import_sql() + package_import_sql(blackeye=True) + """
SELECT status FROM public.set_listening_content_package_status(
    p_package_id=>'fixture-general-v1',p_manifest_sha256=>repeat('a',64),p_action=>'publish',p_actor=>NULL);
SELECT status FROM public.set_listening_content_package_status(
    p_package_id=>'fixture-blackeye-v1',p_manifest_sha256=>repeat('a',64),p_action=>'publish',p_actor=>NULL);
CREATE TEMP TABLE package_before AS SELECT id,policy_revision,mock_content_revision,metadata FROM public.listening_tests;
SELECT set_config('app.listening_package_status_transition','preserve-caller-setting',false);
""" + migration(MA) + migration(MB) + """
DO $$ BEGIN
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.listening_tests t JOIN package_before b USING(id)
        WHERE (t.policy_revision,t.mock_content_revision,t.metadata) IS DISTINCT FROM (b.policy_revision,b.mock_content_revision,b.metadata)), 'backfill preserves package revisions and payload');
    PERFORM pg_temp.assert_true(current_setting('app.listening_package_status_transition')='preserve-caller-setting', 'backfill restores package setting');
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.listening_public_practice_catalog), 'generic catalog excludes imported restricted form');
    PERFORM pg_temp.expect_state('UPDATE public.listening_content SET transcript=''tampered''', '55000');
END $$;
-- Actual 295/306 acquisition still admits ordinary programme work.
SELECT attempt_id FROM public.fn_acquire_listening_programme_attempt_v2(
    (SELECT id FROM public.listening_tests WHERE test_id='pkg-fixture-form-1'),
    '90000000-0000-0000-0000-000000000001','legacy');
SET request.jwt.claim.role='service_role';
-- OUT OF SCOPE BLOCKER: unchanged 376's final snapshot#>path-'key'
-- expression raises 42725. Do not claim successful dedicated admission.
DO $$ DECLARE paper public.listening_tests%ROWTYPE; BEGIN
    SELECT * INTO paper FROM public.listening_tests WHERE test_id='fixture-blackeye-form';
    PERFORM pg_temp.expect_state(format('SELECT public.fn_acquire_blackeye_attempt(%L,%L,%L,''legacy'')',
        paper.id,'90000000-0000-0000-0000-000000000002',
        (paper.metadata#>'{blackeye,binding}')-'answer_set_revision'), '42725');
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.listening_test_attempts), '376 failure rolled back attempted admission');
    RAISE NOTICE 'PARTIAL: unchanged 376 dedicated admission blocked by snapshot JSON operator precedence (42725); SA + Black Eye owner';
END $$;
-- Exercise the real shared 295/306/376-trigger capture machinery separately;
-- this is an internal pipeline proof, not a successful dedicated 376 RPC.
SELECT attempt_id FROM public.fn_acquire_listening_programme_attempt_v2(
    (SELECT id FROM public.listening_tests WHERE test_id='fixture-blackeye-form'),
    '90000000-0000-0000-0000-000000000002','legacy');
INSERT INTO public.dictation_sessions(test_id_external) VALUES('fixture-blackeye-form');
DO $$ BEGIN
    PERFORM pg_temp.assert_true((SELECT count(*)=2 FROM public.mock_paper_attempt_snapshots), 'both internal capture snapshots persisted');
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.v_listening_attempts_public), 'generic activity excludes restricted capture');
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.listening_test_attempts WHERE restricted), 'restricted capture carries persisted flag');
    PERFORM pg_temp.assert_true((SELECT jsonb_array_length(s.marking_rows)=1 AND s.paper_row#>>'{metadata,blackeye,readiness}'='ready'
        FROM public.mock_paper_attempt_snapshots s JOIN public.listening_test_attempts a ON a.id=s.attempt_id WHERE a.restricted), 'dedicated snapshot private review retained');
    PERFORM pg_temp.assert_true(NOT has_table_privilege('authenticated','public.mock_paper_attempt_snapshots','SELECT'), 'private key ACL preserved');
    PERFORM pg_temp.expect_state('DELETE FROM public.listening_tests WHERE test_id=''fixture-blackeye-form''', 'P0001');
END $$;
SET ROLE service_role;
BEGIN;
SET LOCAL aver.allow_unrestrict='on';
DO $$ DECLARE table_name text; refused boolean; BEGIN
    FOREACH table_name IN ARRAY ARRAY['listening_tests','listening_content','listening_test_attempts','dictation_sessions'] LOOP
        refused := false;
        BEGIN EXECUTE format('UPDATE public.%I SET restricted=false WHERE restricted',table_name);
        EXCEPTION WHEN check_violation OR object_not_in_prerequisite_state THEN refused := true;
        END;
        PERFORM pg_temp.assert_true(refused,'non-owner GUC cannot lower '||table_name);
    END LOOP;
END $$;
COMMIT;
RESET ROLE;
DO $$ BEGIN
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.listening_tests WHERE restricted), 'test restriction retained');
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.listening_content WHERE restricted), 'content restriction retained');
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.listening_test_attempts WHERE restricted), 'attempt restriction retained');
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.dictation_sessions WHERE restricted), 'report restriction retained');
END $$;
""")


def test_combined_history_provenance_backfill_snapshot_after_delete_and_page_parity():
    seed = """
INSERT INTO public.listening_tests(id,test_id,is_public,course_level) VALUES
 ('00000000-0000-0000-0000-000000000001','ordinary-history',true,'B1'),
 ('00000000-0000-0000-0000-000000000002','hidden-history',true,'C2');
INSERT INTO public.listening_test_attempts(id,test_id) VALUES
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
INSERT INTO public.mock_paper_attempt_snapshots(skill,attempt_id,paper_id,paper_revision,policy_revision,attempt_purpose,paper_row,source_rows,marking_rows)
 VALUES('listening','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',1,1,'practice','{"metadata":{"blackeye":{}}}','[]','[]');
UPDATE public.listening_tests SET metadata='{"blackeye":{}}' WHERE test_id='hidden-history';
INSERT INTO public.listening_content(id,test_id,source_test_id,parent_content_id) VALUES
 ('10000000-0000-0000-0000-000000000001',NULL,'00000000-0000-0000-0000-000000000002',NULL),
 ('10000000-0000-0000-0000-000000000002',NULL,NULL,'10000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000003',NULL,NULL,'10000000-0000-0000-0000-000000000004'),
 ('10000000-0000-0000-0000-000000000004',NULL,NULL,'10000000-0000-0000-0000-000000000003');
INSERT INTO public.dictation_sessions(test_id_external) VALUES('ordinary-history'),('hidden-history'),('missing-history'),(NULL);
"""
    page = re.search(r'AS \$\$(.*?)\$\$', migration("301_admin_exam_content_page_snapshot.sql"), re.S).group(1)
    query = page[page.index("    WITH source AS ("):page.index(" INTO v_result;")].strip() + ";"
    query = query.replace("WHERE p_kind = 'listening'", "WHERE p_kind = 'listening' AND NOT paper.restricted")
    values = {"p_kind": "'listening'::text", "p_course_level": "NULL::text", "p_cohort_id": "NULL::uuid",
              "p_exam_only": "NULL::boolean", "p_is_public": "NULL::boolean", "p_attention": "'all'::text",
              "p_limit": "5", "p_offset": "0", "v_query": "NULL::text"}
    query = re.sub(r"\b(" + "|".join(values) + r")\b", lambda m: values[m.group()], query)
    with local_pg17("combined-history-backfill") as pg:
        output = pg.psql(history_bootstrap() + seed + migration(MA) + migration(MB) + """
DO $$ DECLARE page jsonb; BEGIN
    PERFORM pg_temp.assert_true((SELECT count(*)=4 FROM public.listening_content WHERE restricted), 'NULL test links, source ancestry and cycles fail closed');
    PERFORM pg_temp.assert_true((SELECT count(*)=3 FROM public.dictation_sessions WHERE restricted), 'hidden and unresolved historical reports restricted');
    PERFORM pg_temp.assert_true((SELECT bool_and(restricted) FROM public.listening_test_attempts), 'frozen snapshot backfill');
    page := public.fn_admin_exam_content_page_ids('listening',p_limit=>5);
    PERFORM pg_temp.assert_true(page->>'total'='1' AND jsonb_array_length(page->'rows')=1 AND jsonb_array_length(page->'ids')=1, 'bounded count/page parity');
    PERFORM pg_temp.assert_true(public.fn_admin_exam_content_levels('listening')='["B1"]'::jsonb, 'hidden-only level excluded');
END $$;
DELETE FROM public.listening_tests WHERE test_id='ordinary-history';
DO $$ BEGIN
    PERFORM pg_temp.assert_true((SELECT bool_and(restricted) FROM public.listening_test_attempts), 'snapshot restriction survives source catalog removal in additive phase');
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.mock_paper_attempt_snapshots), 'frozen snapshot retained after catalog delete');
END $$;
""" + "\nEXPLAIN (ANALYZE, COSTS OFF, BUFFERS) " + query)
        assert '381 dictation backfill: 2 unresolved/ambiguous rows; 3 total restricted rows' in output
