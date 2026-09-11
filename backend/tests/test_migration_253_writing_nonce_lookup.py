"""Actual read-only recovery RPC on isolated local PG; no live evidence."""
import asyncio
import json
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_migration_240_core_attempt_evidence import DB, probe, psql
from test_migration_248_writing_admission import schema as writing_schema, execute, snapshot
from test_migration_249_writing_provenance import schema as provenance_schema
from test_migration_250_writing_preparation import schema as preparation_schema, seed, prepare, prepare_sql, counts, capture_on
from test_migration_251_writing_reconciliation import schema as reconciliation_schema, command, expire, reconcile
from test_migration_252_writing_baseline import schema as baseline_schema, baseline

SQL = (Path(__file__).resolve().parents[1] / 'migrations/253_writing_admission_nonce_lookup.sql').read_text()


@pytest.fixture(scope='module')
def schema(baseline_schema):
    scoped = SQL.replace('public.', f'{baseline_schema}.').replace('pg_catalog,public', f'pg_catalog,{baseline_schema}')
    psql(scoped); psql(scoped)
    return baseline_schema


def query(schema, data):
    return (f"SELECT {schema}.fn_find_writing_admission('{data['user']}','{data['student']}',"
            f"'{data['assignment']}','{data['nonce']}')")


def lookup(schema, data):
    raw = psql('SET ROLE service_role; ' + query(schema, data))
    return json.loads(raw) if raw else None


def test_missing_nonce_is_read_only_and_never_creates_a_scope(schema):
    data = baseline(schema)
    before = snapshot(schema, data)
    assert lookup(schema, data) is None
    assert snapshot(schema, data) == before and counts(schema, data) == (0, 0, 0)


@pytest.mark.parametrize('phase', ['accepted', 'bound', 'unstarted_expired'])
def test_recover_every_command_phase_without_mutation(schema, phase):
    data = command(schema, short=phase == 'unstarted_expired')
    if phase == 'bound': execute(schema, data)
    if phase == 'unstarted_expired': expire(schema, data); reconcile(schema, data)
    before = snapshot(schema, data)
    journal = psql(f"SELECT count(*) FROM {schema}.core_admission_journal WHERE command_id='{data['command']}'")
    result = lookup(schema, data)
    assert result['command']['phase'] == phase and result['command']['command_id'] == str(data['command'])
    assert lookup(schema, data) == result and snapshot(schema, data) == before
    assert data['nonce'] not in json.dumps(result) and counts(schema, data) == (1, 1, 1)
    assert psql(f"SELECT count(*) FROM {schema}.core_admission_journal WHERE command_id='{data['command']}'") == journal


@pytest.mark.parametrize('bound', [False, True])
def test_terminal_source_and_expired_lease_do_not_hide_original_command(schema, bound):
    data = command(schema)
    if bound: execute(schema, data)
    psql(f"UPDATE {schema}.writing_assignments SET status='submitted',renderer_affinity_expires_at=now()-interval '1 hour' "
         f"WHERE id='{data['assignment']}'")
    before = snapshot(schema, data)
    result = lookup(schema, data)
    assert result['assignment']['status'] == 'submitted'
    assert result['command']['phase'] == ('bound' if bound else 'accepted')
    assert snapshot(schema, data) == before


@pytest.mark.parametrize('field', ['user', 'student', 'assignment'])
def test_foreign_or_missing_source_is_not_exposed(schema, field):
    data = command(schema)
    with pytest.raises(RuntimeError, match='writing_admission_not_found'):
        lookup(schema, {**data, field: uuid4()})


def test_nonce_for_another_resource_is_not_false_absence(schema):
    data = command(schema)
    other = uuid4()
    psql(f"INSERT INTO {schema}.writing_assignments(id,student_id) VALUES('{other}','{data['student']}')")
    with pytest.raises(RuntimeError, match='writing_admission_not_found'):
        lookup(schema, {**data, 'assignment': other})


def test_ownership_revocation_hides_old_command(schema):
    data = command(schema)
    psql(f"UPDATE {schema}.students SET user_id='{uuid4()}' WHERE id='{data['student']}'")
    with pytest.raises(RuntimeError, match='writing_admission_not_found'): lookup(schema, data)


def test_nonce_read_does_not_wait_for_source_lock_or_see_uncommitted_prepare(schema):
    data = seed(schema)
    async def run():
        writer = await asyncpg.connect(DB)
        reader = await asyncpg.connect(DB)
        try:
            await writer.execute('BEGIN')
            raw = json.loads(await writer.fetchval(prepare_sql(schema, data)))
            # An in-flight prepare can be absent. The subsequent mutating path
            # still uses this same nonce and revalidates; absence isn't a permit.
            assert await asyncio.wait_for(reader.fetchval(query(schema, data)), 1) is None
            await writer.execute('COMMIT')
            recovered = json.loads(await reader.fetchval(query(schema, data)))
            assert recovered['command']['command_id'] == raw['command']['command_id']
            await writer.execute('BEGIN')
            await writer.execute(f"SELECT id FROM {schema}.writing_assignments WHERE id='{data['assignment']}' FOR UPDATE")
            assert json.loads(await asyncio.wait_for(reader.fetchval(query(schema, data)), 1)) == recovered
            await writer.execute('ROLLBACK')
        finally:
            await writer.close(); await reader.close()
    asyncio.run(run())


def test_lookup_supports_read_only_transaction_and_private_role(schema):
    data = command(schema)
    assert json.loads(psql('BEGIN READ ONLY; SET LOCAL ROLE service_role; ' + query(schema, data) + '; COMMIT;'))['command']['phase'] == 'accepted'
    for role in ['anon', 'authenticated']:
        with pytest.raises(RuntimeError, match='permission denied'):
            psql(f'SET ROLE {role}; ' + query(schema, data))
    with pytest.raises(RuntimeError, match='admission_invalid_input'):
        psql(f"SELECT {schema}.fn_find_writing_admission(NULL,NULL,NULL,NULL)")
    with pytest.raises(RuntimeError, match='admission_invalid_input'):
        lookup(schema, {**data, 'nonce': 'invalid'})
