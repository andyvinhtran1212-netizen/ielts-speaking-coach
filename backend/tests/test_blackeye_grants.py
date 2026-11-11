"""Source contracts for reserved 377/378. Runtime ACL checks run on PG17."""
from pathlib import Path
import re
import hashlib

ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / 'migrations/377_exercise_book_cohort_grants.sql').read_text()
TABLES = ('exercise_book_registry','exercise_book_grant_owners','exercise_book_cohort_grants','exercise_book_cohort_grant_log')


def test_377_pending_feature_reserved_and_no_client_grants_or_policies():
    entries = [line.split('\t') for line in (ROOT/'migrations/forward-policy.tsv').read_text().splitlines()
               if line.startswith('377_exercise_book_cohort_grants.sql\t')]
    assert len(entries)==1 and entries[0][1:3]==['pending_feature','blackeye_grants']
    assert 'No apply on merge' in entries[0][3]
    for table in TABLES:
        assert f'CREATE TABLE public.{table}' in SQL
        assert f'ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY' in SQL
        assert f'REVOKE ALL ON TABLE public.{table} FROM PUBLIC,anon,authenticated,service_role;' in SQL
    assert not re.search(r'CREATE\s+POLICY',SQL,re.I)
    for grant in re.findall(r'^GRANT\b.*?;',SQL,re.M|re.S):
        assert 'TO service_role' in grant
        assert not re.search(r'\b(INSERT|UPDATE|DELETE|TRUNCATE)\b',grant)
    functions=re.findall(r'CREATE FUNCTION public\.(\w+)\(',SQL)
    assert len(functions)==10
    assert SQL.count('SECURITY DEFINER SET search_path = pg_catalog, pg_temp')==len(functions)
    assert 'CHECK (actor_id <> grantee_id)' in SQL
    assert SQL.count('BEFORE UPDATE OR DELETE OR TRUNCATE')==2
    assert 'INSERT INTO public.exercise_book_cohort_grant_log' in SQL
    assert not re.search(r'INSERT INTO public\.exercise_book_grant_owners',SQL)
    assert 'suspended_at IS NULL' in SQL and 'FOR SHARE OF o,u' in SQL
    assert 'fn_staff_security_record' in SQL


def test_no_http_grant_writer_is_registered():
    from routers.admin_class_assignments import router
    # D2 supplies the routes later; SQL alone must not expose an HTTP writer.
    assert not any('grant' in route.path and any(m in route.methods for m in ('POST','PATCH','PUT','DELETE')) for route in router.routes)


def test_377_not_added_to_clone_acl_coverage_or_postconditions():
    source=(ROOT/'scripts/sql/staging_clone_postconditions.sql').read_text()
    assert 'exercise_book_cohort_grant' not in source and '377' not in source
    source=(ROOT/'scripts/staging_clone.py').read_text() if (ROOT/'scripts/staging_clone.py').exists() else ''
    assert '377_exercise_book_cohort_grants.sql' not in source


def test_376_bytes_are_the_reviewed_pr1_artifacts():
    # PR1 2f0aaf9a79f4, merged without changing its SQL; the split must never edit PR1 SQL.
    expected = {'backend/migrations/376_blackeye_admission.sql': '4ed9dcfbea4b592f22e6eed5657984238ed8e68fac4d918975e90b65f4732fd2', 'backend/migrations/rollback/376_blackeye_admission.sql': 'f8e5a39060f923fac262d6d5de91ccbb742755650cc5952d0d13f505bcb02ff1', 'docs/proposals/blackeye-u1/admission.sql': 'c31172983cf3a9f63af7b68357d5a40327926f83982383d93f01754c2d368853'}
    for name, digest in expected.items():
        assert hashlib.sha256((ROOT.parent/name).read_bytes()).hexdigest()==digest


def test_378_has_no_shared_unique_or_request_table_and_is_pg17_gated():
    sql=(ROOT/'migrations/378_exercise_book_assignments.sql').read_text()
    assert not re.search(r'ALTER TABLE public\.(class_assignments|class_assignment_items).*?UNIQUE',sql,re.S|re.I)
    assert re.findall(r'CREATE TABLE public\.(\w+)',sql)==['class_assignment_activities','exercise_book_attempt_links']
    assert 'request_fingerprint' in sql and 'p_result_summary is ignored' in sql
    workflow=(ROOT.parent/'.github/workflows/backend-tests.yml').read_text()
    pg17=workflow.split('PG17_TEST_FILES: >-',1)[1].split('jobs:',1)[0]
    for name in ('test_blackeye_admission_postgres.py','test_blackeye_grants_postgres.py','test_exercise_book_postgres.py'):
        assert 'tests/'+name in pg17
