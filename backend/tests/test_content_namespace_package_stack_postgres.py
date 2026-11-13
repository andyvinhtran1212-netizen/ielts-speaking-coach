"""Real 353/379 package/source guards with 381 on disposable local PG17.

Tests the unchanged guard bodies and their triggers, not full historical
migration application. Existing package payload and revisions stay immutable.
"""
from namespace_pg17 import MA, MB, bootstrap, local_pg17, migration


def test_namespace_backfill_and_cross_package_cascade_preserve_package_guards():
    source = migration("353_listening_package_status_revision.sql")
    guard = source[source.index("CREATE OR REPLACE FUNCTION public.fn_protect_listening_package_child()"):
                   source.index("CREATE OR REPLACE FUNCTION public.fn_guard_mock_paper_source()")]
    source = migration("379_listening_import_source_skip.sql")
    source_guard = source[source.index("CREATE OR REPLACE FUNCTION public.fn_guard_mock_paper_source()"):
                          source.index("REVOKE ALL ON FUNCTION public.fn_guard_mock_paper_source()")]
    setup = """
ALTER TABLE public.listening_content_packages ADD COLUMN published_at timestamptz;
INSERT INTO public.listening_content_packages(id,programme_id,status) VALUES
 ('40000000-0000-0000-0000-000000000001','ielts-listening-practice','validated'),
 ('40000000-0000-0000-0000-000000000002','ielts-listening-practice','validated');
CREATE TRIGGER trg_protect_listening_package_child BEFORE INSERT OR UPDATE OR DELETE ON public.listening_tests
FOR EACH ROW EXECUTE FUNCTION public.fn_protect_listening_package_child();
CREATE TRIGGER trg_protect_listening_package_child BEFORE INSERT OR UPDATE OR DELETE ON public.listening_content
FOR EACH ROW EXECUTE FUNCTION public.fn_protect_listening_package_child();
SELECT set_config('app.listening_package_import','40000000-0000-0000-0000-000000000001',false);
INSERT INTO public.listening_tests(id,test_id,content_package_id) VALUES
 ('00000000-0000-0000-0000-000000000001','ordinary-package','40000000-0000-0000-0000-000000000001');
INSERT INTO public.listening_content(id,test_id) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
SELECT set_config('app.listening_package_import','40000000-0000-0000-0000-000000000002',false);
INSERT INTO public.listening_tests(id,test_id,metadata,content_package_id) VALUES
 ('00000000-0000-0000-0000-000000000002','hidden-package','{"blackeye":{}}','40000000-0000-0000-0000-000000000002');
INSERT INTO public.listening_content(id,test_id) VALUES
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
SELECT set_config('app.listening_package_import','40000000-0000-0000-0000-000000000001',false);
INSERT INTO public.listening_content(id,test_id,parent_content_id) VALUES
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
RESET app.listening_package_import;
CREATE OR REPLACE FUNCTION public.fn_mock_admission_contract_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS 'SELECT true';
CREATE TEMP TABLE original_tests AS SELECT id,to_jsonb(t) AS payload FROM public.listening_tests t;
CREATE TEMP TABLE original_content AS SELECT id,to_jsonb(c) AS payload FROM public.listening_content c;
SELECT set_config('app.listening_package_status_transition','caller-setting-must-survive',false);
"""
    with local_pg17("package-stack") as pg:
        pg.psql(bootstrap() + guard + source_guard + setup + migration(MA) + migration(MB) + """
DO $$ BEGIN
    PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.listening_tests WHERE restricted), 'packaged test backfill');
    PERFORM pg_temp.assert_true((SELECT count(*)=2 FROM public.listening_content WHERE restricted), 'cross-package provenance cascade');
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.listening_tests t JOIN original_tests o USING(id)
        WHERE to_jsonb(t)-'restricted' IS DISTINCT FROM o.payload), 'package test payload and revision unchanged');
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.listening_content c JOIN original_content o USING(id)
        WHERE to_jsonb(c)-'restricted' IS DISTINCT FROM o.payload), 'package content payload unchanged');
    PERFORM pg_temp.assert_true(current_setting('app.listening_package_status_transition')='caller-setting-must-survive', 'legacy setting restored');
    PERFORM pg_temp.expect_state('UPDATE public.listening_tests SET title=''forbidden'' WHERE test_id=''ordinary-package''', '55000');
    PERFORM pg_temp.expect_state('UPDATE public.listening_content SET transcript=''forbidden''', '55000');
END $$;
-- A later marker on a standalone provenance parent must also taint a packaged
-- descendant without modifying the package's source payload or revision.
INSERT INTO public.listening_tests(id,test_id) VALUES('00000000-0000-0000-0000-000000000003','standalone-parent');
INSERT INTO public.listening_content(id,test_id) VALUES
 ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003');
SELECT set_config('app.listening_package_import','40000000-0000-0000-0000-000000000001',false);
INSERT INTO public.listening_content(id,test_id,parent_content_id) VALUES
 ('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004');
RESET app.listening_package_import;
UPDATE public.listening_tests SET metadata='{"blackeye":{}}' WHERE test_id='standalone-parent';
DO $$ BEGIN
    PERFORM pg_temp.assert_true((SELECT restricted FROM public.listening_content WHERE id='10000000-0000-0000-0000-000000000005'), 'later cross-package cascade');
    PERFORM pg_temp.assert_true(current_setting('app.listening_package_status_transition')='caller-setting-must-survive', 'cascade restores legacy setting');
END $$;
""")
