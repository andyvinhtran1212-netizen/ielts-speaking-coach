"""FR-027 C3 dormant grant-list contract. No shared database access."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / 'migrations/377_blackeye_course2_grants.sql').read_text()
TABLES = ('blackeye_course2_grants', 'blackeye_course2_grant_log')


def test_377_pending_feature_reserved_and_no_client_grants_or_policies():
    entries = [line.split('\t') for line in (ROOT / 'migrations/forward-policy.tsv').read_text().splitlines()
               if line.startswith('377_blackeye_course2_grants.sql\t')]
    assert len(entries) == 1 and entries[0][1:3] == ['pending_feature', 'blackeye_grants']
    assert 'No apply on merge' in entries[0][3]
    for table in TABLES:
        assert f'CREATE TABLE public.{table}' in SQL
        assert f'ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY' in SQL
    assert not re.search(r'CREATE\s+POLICY', SQL, re.I)
    for grant in re.findall(r'GRANT\b.*?;', SQL, re.S):
        assert 'TO service_role' in grant
        assert not re.search(r'\b(UPDATE|DELETE|TRUNCATE)\b', grant)
    assert SQL.count('SECURITY DEFINER SET search_path = pg_catalog, pg_temp') == 2
    for fn in ('fn_blackeye_audit_grant', 'fn_blackeye_grant_append_only'):
        assert f'REVOKE ALL ON FUNCTION public.{fn}() FROM PUBLIC, anon, authenticated' in SQL
    assert SQL.count('CHECK (actor_id <> grantee_id)') == 2
    assert SQL.count('BEFORE UPDATE OR DELETE OR TRUNCATE') == 2
    assert 'INSERT INTO public.blackeye_course2_grant_log' in SQL


def test_no_http_grant_writer_is_registered():
    from routers.admin_class_assignments import router
    # CV-1 fallback: no grant UI or write handler exists. Denial is performed
    # by the explicit absent-route guard, never an unreviewed grant service.
    assert not any('grant' in route.path and any(m in route.methods for m in ('POST', 'PATCH', 'PUT', 'DELETE'))
                   for route in router.routes)


def test_377_not_added_to_clone_acl_coverage_or_postconditions():
    source = (ROOT / 'scripts/sql/staging_clone_postconditions.sql').read_text()
    assert 'blackeye_course2_grant' not in source and '377' not in source
    source = (ROOT / 'scripts/staging_clone.py').read_text() if (ROOT / 'scripts/staging_clone.py').exists() else ''
    assert '377_blackeye_course2_grants.sql' not in source
