"""Real PG17 ACL, append-only audit and self-grant probes; synthetic IDs only."""
import json
from pathlib import Path
from uuid import uuid4

import pytest
from test_migration_240_core_attempt_evidence import psql, probe

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope='module')
def grants_schema(probe):
    schema = 'blackeye_377_' + uuid4().hex
    try:
        psql(f'''CREATE SCHEMA {schema};
        GRANT USAGE ON SCHEMA {schema} TO anon,authenticated,service_role;
        CREATE TABLE {schema}.users(id uuid PRIMARY KEY);
        CREATE TABLE {schema}.cohorts(id uuid PRIMARY KEY);''')
        sql = (ROOT / 'migrations/377_blackeye_course2_grants.sql').read_text().replace('public.', schema + '.')
        sql = sql.replace('auth.role()', "current_setting('request.jwt.claim.role',true)")
        psql(sql)
        yield schema
    finally:
        psql(f'DROP SCHEMA IF EXISTS {schema} CASCADE')


def test_catalog_client_privileges_policies_and_search_path(grants_schema):
    s = grants_schema
    for table in ('blackeye_course2_grants', 'blackeye_course2_grant_log'):
        for role in ('anon', 'authenticated'):
            for privilege in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'):
                assert psql(f"SELECT has_table_privilege('{role}','{s}.{table}','{privilege}')") == 'f'
        assert psql(f"SELECT count(*) FROM pg_policies WHERE schemaname='{s}' AND tablename='{table}'") == '0'
        assert psql(f"SELECT relrowsecurity FROM pg_class WHERE oid='{s}.{table}'::regclass") == 't'
    rows = json.loads(psql(f'''SELECT json_agg(json_build_object('name',p.proname,'config',p.proconfig,
      'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE')))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='{s}' '''))
    assert len(rows) == 2
    assert all(r['config'] == ['search_path=pg_catalog, pg_temp'] and not r['anon'] and not r['authenticated'] for r in rows)


def test_authenticated_direct_write_and_self_grant_leave_zero_rows(grants_schema):
    s = grants_schema
    actor, cohort = uuid4(), uuid4()
    psql(f"INSERT INTO {s}.users VALUES ('{actor}'); INSERT INTO {s}.cohorts VALUES ('{cohort}')")
    insert = f"INSERT INTO {s}.blackeye_course2_grants(cohort_id,grantee_id,actor_id,role,action,reason) VALUES ('{cohort}','{actor}','{actor}','teacher','grant','synthetic')"
    for role in ('anon', 'authenticated'):
        with pytest.raises(RuntimeError, match='permission denied'):
            psql(f"SET ROLE {role}; SET request.jwt.claim.role='{role}'; {insert}")
    with pytest.raises(RuntimeError, match='check constraint|blackeye_grant_forbidden'):
        psql("SET ROLE service_role; SET request.jwt.claim.role='service_role'; " + insert)
    for table in ('blackeye_course2_grants', 'blackeye_course2_grant_log'):
        assert psql(f'SELECT count(*) FROM {s}.{table}') == '0'


def test_grant_revoke_log_readback_and_mutation_rejection(grants_schema):
    s = grants_schema
    actor, grantee, cohort = uuid4(), uuid4(), uuid4()
    psql(f"INSERT INTO {s}.users VALUES ('{actor}'),('{grantee}'); INSERT INTO {s}.cohorts VALUES ('{cohort}')")
    prefix = "SET ROLE service_role; SET request.jwt.claim.role='service_role'; "
    for action in ('grant', 'revoke'):
        psql(prefix + f"INSERT INTO {s}.blackeye_course2_grants(cohort_id,grantee_id,actor_id,role,action,reason) VALUES ('{cohort}','{grantee}','{actor}','teacher','{action}','synthetic {action}')")
    records = json.loads(psql(prefix + f"SELECT json_agg(l ORDER BY occurred_at) FROM {s}.blackeye_course2_grant_log l WHERE cohort_id='{cohort}'"))
    assert [r['action'] for r in records] == ['grant', 'revoke']
    assert all(r['actor_id'] == str(actor) and r['grantee_id'] == str(grantee) and r['reason'] for r in records)
    for table in ('blackeye_course2_grants', 'blackeye_course2_grant_log'):
        for command in (f"UPDATE {s}.{table} SET reason='rewrite'", f'DELETE FROM {s}.{table}', f'TRUNCATE {s}.{table} CASCADE'):
            with pytest.raises(RuntimeError, match='blackeye_grant_append_only'):
                psql(command)
    rollback = (ROOT / 'migrations/rollback/377_blackeye_course2_grants.sql').read_text().replace('public.', s + '.')
    with pytest.raises(RuntimeError, match='blackeye_grant_history_exists'):
        psql(rollback)
    assert psql(f'SELECT count(*) FROM {s}.blackeye_course2_grant_log') == '2'
