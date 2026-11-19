"""377 grant regression probes against the D1 fixture's real SQL chain."""
from datetime import datetime, timezone
from uuid import uuid4
import asyncpg
import pytest
from test_exercise_book_postgres import book_schema, seed, rpc, value, query, PROGRAMME  # noqa: F401


def test_catalog_client_privileges_policies_and_search_path(book_schema):
    s=book_schema
    for table in ('exercise_book_cohort_grants','exercise_book_cohort_grant_log'):
        for role in ('anon','authenticated'):
            for privilege in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE'):
                assert not value('SELECT has_table_privilege($1,$2,$3)',role,s+'.'+table,privilege)
        assert value('SELECT count(*) FROM pg_policies WHERE schemaname=$1 AND tablename=$2',s,table)==0
        assert value('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',s+'.'+table)
    rows=query("SELECT prosecdef,proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') client FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname LIKE 'fn_eb_%'",s)
    assert rows and all(x['prosecdef'] and x['proconfig']==['search_path=pg_catalog, pg_temp'] and not x['anon'] and not x['client'] for x in rows)


def test_authenticated_direct_write_and_self_grant_leave_zero_rows(seed):
    d=seed;s=d['s']
    for role in ('anon','authenticated','service_role'):
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            query(f"SET ROLE {role}; INSERT INTO {s}.exercise_book_cohort_grants(actor_id) VALUES('{d['owner']}')")
    with pytest.raises(asyncpg.PostgresError,match='self_grant'):
        rpc(s,'fn_record_cohort_grant',d['owner'],datetime.now(timezone.utc),d['cohort'],PROGRAMME,d['owner'],'teacher','grant','synthetic',uuid4())
    for table in ('exercise_book_cohort_grants','exercise_book_cohort_grant_log'):
        assert value(f'SELECT count(*) FROM {s}.{table} WHERE cohort_id=$1',d['cohort'])==0


def test_grant_revoke_log_readback_and_mutation_rejection(seed):
    d=seed;s=d['s']
    for action in ('grant','revoke'):
        rpc(s,'fn_record_cohort_grant',d['owner'],datetime.now(timezone.utc),d['cohort'],PROGRAMME,d['teacher'],'teacher',action,'synthetic '+action,uuid4())
    rows=rpc(s,'fn_read_cohort_grant_log',d['owner'],datetime.now(timezone.utc),d['cohort'],PROGRAMME)
    assert [r['action'] for r in rows]==['revoke','grant']
    assert all(r['actor_id']==d['owner'] and r['grantee_id']==d['teacher'] and r['reason'] for r in rows)
    for table in ('exercise_book_cohort_grants','exercise_book_cohort_grant_log'):
        for command in (f"UPDATE {s}.{table} SET reason='rewrite'",f'DELETE FROM {s}.{table}',f'TRUNCATE {s}.{table} CASCADE'):
            with pytest.raises(asyncpg.PostgresError,match='exercise_book_append_only'):query(command)
