"""Durable capture/finalize against isolated local PostgreSQL, no live capture."""
import asyncio
import json
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest

from services.core_writing_cohort import summarize_writing_cohort
from services import core_admission, core_writing_reports
from test_core_admission_design_postgres import wait_blocked
from test_migration_240_core_attempt_evidence import DB, probe, psql
from test_migration_247_core_admission import rotate
from test_migration_248_writing_admission import schema as writing_schema, execute
from test_migration_249_writing_provenance import schema as provenance_schema
from test_migration_250_writing_preparation import schema as preparation_schema, capture_on, seed, prepare
from test_migration_251_writing_reconciliation import schema as reconciliation_schema
from test_migration_252_writing_baseline import schema as baseline_schema
from test_migration_253_writing_nonce_lookup import schema as nonce_schema
from test_migration_254_writing_cohort import schema as cohort_schema

SQL = (Path(__file__).resolve().parents[1] / 'migrations/255_writing_cohort_reports.sql').read_text()


@pytest.fixture(scope='module')
def schema(cohort_schema):
    scoped = SQL.replace('public.', f'{cohort_schema}.').replace('pg_catalog,public', f'pg_catalog,{cohort_schema}')
    psql(scoped); psql(scoped)
    assert psql(f'SELECT enabled FROM {cohort_schema}.core_writing_report_control') == 'f'
    return cohort_schema


@pytest.fixture(autouse=True)
def reset_capture(schema):
    psql(f'UPDATE {schema}.core_writing_report_control SET enabled=false,policy_digest=NULL')


def enable(schema):
    psql(f"UPDATE {schema}.core_writing_report_control SET enabled=true,policy_digest='{'e'*64}'")


def member(schema, *, close=True):
    rotate(schema); data = seed(schema); raw = prepare(schema, data)
    data.update(command=UUID(raw['command']['command_id']), epoch=UUID(raw['command']['activity_epoch_id']))
    if close: rotate(schema)
    return data


def capture_sql(schema, report, epoch):
    return f"SELECT {schema}.fn_capture_writing_cohort_report('{report}','{epoch}')"


def capture(schema, report, epoch):
    return json.loads(psql('SET ROLE service_role; ' + capture_sql(schema, report, epoch)))


def finish_sql(schema, raw, summary=None, digest=None):
    if summary is None: summary = summarize_writing_cohort(raw['source_snapshot'], UUID(raw['epoch_id']))
    encoded = json.dumps(summary).replace("'", "''")
    return (f"SELECT {schema}.fn_finalize_writing_cohort_report('{raw['id']}',"
            f"'{digest or raw['snapshot_digest']}','{encoded}'::jsonb)")


def test_default_off_never_captures_and_open_epoch_never_persists(schema):
    data = member(schema, close=False); report = uuid4()
    with pytest.raises(RuntimeError, match='writing_report_capture_disabled'): capture(schema, report, data['epoch'])
    enable(schema)
    with pytest.raises(RuntimeError, match='writing_cohort_membership_open'): capture(schema, report, data['epoch'])
    assert psql(f"SELECT count(*) FROM {schema}.core_writing_cohort_reports WHERE id='{report}'") == '0'


def test_capture_replay_freezes_source_and_finalize_replay_never_overwrites(schema):
    data = member(schema); enable(schema); report = uuid4()
    raw = capture(schema, report, data['epoch'])
    assert raw['summary'] is None and raw['source_snapshot']['episodes'][0]['binding'] is None
    execute(schema, data)
    assert capture(schema, report, data['epoch']) == raw
    final = json.loads(psql('SET ROLE service_role; ' + finish_sql(schema, raw)))
    assert final['summary']['states']['unstarted'] == 1
    assert json.loads(psql('SET ROLE service_role; ' + finish_sql(schema, raw))) == final
    current = capture(schema, uuid4(), data['epoch'])
    assert current['source_snapshot']['episodes'][0]['binding'] is not None
    assert current['snapshot_digest'] != raw['snapshot_digest']
    assert psql(f"SELECT snapshot_digest=encode(sha256(convert_to(source_snapshot::text,'UTF8')),'hex'),"
                f"summary_digest=encode(sha256(convert_to(summary::text,'UTF8')),'hex') FROM {schema}.core_writing_cohort_reports WHERE id='{report}'") == 't|t'


def test_capture_off_preserves_existing_report_recovery_and_finish(schema):
    data = member(schema); enable(schema); report = uuid4(); raw = capture(schema, report, data['epoch'])
    psql(f'UPDATE {schema}.core_writing_report_control SET enabled=false')
    assert capture(schema, report, data['epoch']) == raw
    with pytest.raises(RuntimeError, match='writing_report_capture_disabled'): capture(schema, uuid4(), data['epoch'])
    final = json.loads(psql('SET ROLE service_role; ' + finish_sql(schema, raw)))
    assert final['summary'] is not None


@pytest.mark.parametrize('damage', ['digest','epoch','count','reason','extra','pass_claim','source_clock','states'])
def test_wrong_or_content_bearing_summary_is_rejected_without_finalization(schema, damage):
    data = member(schema); enable(schema); raw = capture(schema, uuid4(), data['epoch'])
    summary = summarize_writing_cohort(raw['source_snapshot'], data['epoch']); digest = None
    if damage == 'digest': digest = 'f'*64
    if damage == 'epoch': summary['epoch_id'] = str(uuid4())
    if damage == 'count': summary['states']['success'] = 99
    if damage == 'reason': summary['reasons'] = {'PRIVATE_LEARNER_TEXT': 1}
    if damage == 'extra': summary['essay_text'] = 'PRIVATE_LEARNER_TEXT'
    if damage == 'pass_claim': summary['gate_f'] = 'pass'
    if damage == 'source_clock': summary['snapshot_at'] = '2000-01-01T00:00:00Z'
    if damage == 'states': del summary['states']['unknown']
    with pytest.raises(RuntimeError): psql('SET ROLE service_role; ' + finish_sql(schema, raw, summary, digest))
    assert psql(f"SELECT summary IS NULL FROM {schema}.core_writing_cohort_reports WHERE id='{raw['id']}'") == 't'


def test_id_conflict_immutability_and_private_permissions(schema):
    data = member(schema); enable(schema); report = uuid4(); raw = capture(schema, report, data['epoch'])
    with pytest.raises(RuntimeError, match='writing_report_conflict'): capture(schema, report, uuid4())
    with pytest.raises(RuntimeError, match='writing_report_immutable'):
        psql(f"UPDATE {schema}.core_writing_cohort_reports SET epoch_id='{uuid4()}' WHERE id='{report}'")
    with pytest.raises(RuntimeError, match='writing_report_immutable'):
        psql(f"DELETE FROM {schema}.core_writing_cohort_reports WHERE id='{report}'")
    for role in ['anon','authenticated','service_role']:
        with pytest.raises(RuntimeError, match='permission denied'):
            psql(f'SET ROLE {role}; SELECT * FROM {schema}.core_writing_cohort_reports')
    for role in ['anon','authenticated']:
        with pytest.raises(RuntimeError, match='permission denied'):
            psql(f"SET ROLE {role}; SELECT {schema}.fn_get_writing_cohort_report('{report}')")
    final = json.loads(psql('SET ROLE service_role; ' + finish_sql(schema, raw)))
    altered = dict(final['summary']); altered['reasons'] = {'command_history_incomplete': 1}
    with pytest.raises(RuntimeError, match='writing_report_result_conflict'):
        psql('SET ROLE service_role; ' + finish_sql(schema, raw, altered))


def test_concurrent_capture_and_finalize_same_id_recover_one_artifact(schema):
    data = member(schema); enable(schema); report = uuid4()
    async def run():
        first, second = await asyncpg.connect(DB), await asyncpg.connect(DB)
        try:
            records = await asyncio.gather(first.fetchval(capture_sql(schema, report, data['epoch'])), second.fetchval(capture_sql(schema, report, data['epoch'])))
            assert json.loads(records[0]) == json.loads(records[1])
            raw = json.loads(records[0])
            finals = await asyncio.gather(first.fetchval(finish_sql(schema, raw)), second.fetchval(finish_sql(schema, raw)))
            assert json.loads(finals[0]) == json.loads(finals[1])
        finally:
            await first.close(); await second.close()
    asyncio.run(run())
    assert psql(f"SELECT count(*) FROM {schema}.core_writing_cohort_reports WHERE id='{report}'") == '1'


def test_snapshot_clock_is_after_capture_lock_wait_and_epoch_closure(schema):
    data = member(schema, close=False); report = uuid4()
    async def run():
        blocker, reader = await asyncpg.connect(DB), await asyncpg.connect(DB)
        task = None
        try:
            await blocker.execute('BEGIN')
            await blocker.execute(f"UPDATE {schema}.core_writing_report_control SET enabled=true,policy_digest='{'e'*64}'")
            task = asyncio.create_task(reader.fetchval(capture_sql(schema, report, data['epoch'])))
            await wait_blocked(blocker, reader, task)
            rotate(schema)  # closure after the reader's outer SQL statement began
            await blocker.execute('COMMIT')
            raw = json.loads(await asyncio.wait_for(task, 3))
            assert summarize_writing_cohort(raw['source_snapshot'], data['epoch'])['admitted_episode_count'] == 1
        finally:
            if task and not task.done(): task.cancel()
            await blocker.close(); await reader.close()
    asyncio.run(run())


def test_python_report_workflow_with_real_sql_payloads(schema, monkeypatch):
    """Driver adapter tests service/SQL together, explicitly not PostgREST."""
    data = member(schema); enable(schema); report = uuid4()
    async def run():
        connection = await asyncpg.connect(DB)
        calls = []
        async def rpc(name, params):
            calls.append(name)
            if name == 'fn_get_writing_cohort_report':
                raw = await connection.fetchval(f'SELECT {schema}.{name}($1)', UUID(params['p_report_id']))
            elif name == 'fn_capture_writing_cohort_report':
                raw = await connection.fetchval(f'SELECT {schema}.{name}($1,$2)', UUID(params['p_report_id']), UUID(params['p_epoch_id']))
            elif name == 'fn_finalize_writing_cohort_report':
                raw = await connection.fetchval(f'SELECT {schema}.{name}($1,$2,$3)', UUID(params['p_report_id']), params['p_snapshot_digest'], json.dumps(params['p_summary']))
            else:
                raise AssertionError(name)
            return json.loads(raw) if raw is not None else None
        monkeypatch.setattr(core_admission, '_rpc', rpc)
        try:
            await connection.execute('SET ROLE service_role')
            result = await core_writing_reports.create_or_resume_writing_report(report, data['epoch'])
            assert result['summary']['states']['unstarted'] == 1 and 'source_snapshot' not in result
            assert await core_writing_reports.get_writing_report(report) == result
            assert await core_writing_reports.create_or_resume_writing_report(report, data['epoch']) == result
            assert calls.count('fn_capture_writing_cohort_report') == calls.count('fn_finalize_writing_cohort_report') == 1
        finally:
            await connection.close()
    asyncio.run(run())
