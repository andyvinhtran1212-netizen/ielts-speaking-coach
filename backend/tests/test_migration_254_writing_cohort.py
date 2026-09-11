"""One closed-epoch snapshot, real local PG with product provenance and view."""
import asyncio
import json
from pathlib import Path
from uuid import UUID, uuid4

import pytest
import asyncpg

from services.core_writing_cohort import summarize_writing_cohort
from test_migration_240_core_attempt_evidence import DB, probe, psql
from test_migration_247_core_admission import rotate
from test_migration_248_writing_admission import schema as writing_schema, execute, snapshot
from test_migration_249_writing_provenance import schema as provenance_schema
from test_migration_250_writing_preparation import schema as preparation_schema, capture_on, seed, prepare
from test_migration_251_writing_reconciliation import schema as reconciliation_schema
from test_migration_252_writing_baseline import schema as baseline_schema
from test_migration_253_writing_nonce_lookup import schema as nonce_schema

MIGRATIONS = Path(__file__).resolve().parents[1] / 'migrations'
SQL = (MIGRATIONS / '254_writing_admission_cohort_snapshot.sql').read_text()


@pytest.fixture(scope='module')
def schema(nonce_schema):
    psql(f"""
        CREATE TABLE {nonce_schema}.writing_essays(id uuid PRIMARY KEY,student_id uuid NOT NULL,
            status text NOT NULL,is_flagged boolean DEFAULT false,current_version integer DEFAULT 1,deleted_at timestamptz);
        CREATE TABLE {nonce_schema}.writing_feedback(essay_id uuid NOT NULL,version integer NOT NULL,
            overall_band_score numeric,UNIQUE(essay_id,version));
        CREATE TABLE {nonce_schema}.writing_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),essay_id uuid NOT NULL,
            job_type text NOT NULL,status text NOT NULL,created_at timestamptz NOT NULL,completed_at timestamptz);
    """)
    view = (MIGRATIONS / '109_grading_versions_readpath.sql').read_text().split('CREATE OR REPLACE VIEW writing_feedback_current AS', 1)[1].split(';', 1)[0]
    psql(f'SET search_path={nonce_schema},public; CREATE OR REPLACE VIEW writing_feedback_current AS' + view + ';')
    scoped = SQL.replace('public.', f'{nonce_schema}.').replace('pg_catalog,public', f'pg_catalog,{nonce_schema}')
    psql(scoped); psql(scoped)
    return nonce_schema


def read(schema, epoch):
    return json.loads(psql(f"SET ROLE service_role; SELECT {schema}.fn_read_writing_admission_cohort('{epoch}')"))


def start(schema):
    data = seed(schema)
    accepted = prepare(schema, data); data['command'] = UUID(accepted['command']['command_id'])
    data['epoch'] = UUID(accepted['command']['activity_epoch_id'])
    execute(schema, data)
    return data


def test_open_epoch_refused_and_missing_epoch_private(schema):
    data = start(schema)
    with pytest.raises(RuntimeError, match='writing_cohort_membership_open'): read(schema, data['epoch'])
    with pytest.raises(RuntimeError, match='writing_cohort_not_found'): read(schema, uuid4())


def test_closed_cohort_keeps_unbound_and_late_binding_changes_state_without_membership(schema):
    rotate(schema)  # isolate this test's first-admission epoch
    data = seed(schema); accepted = prepare(schema, data)
    epoch = UUID(accepted['command']['activity_epoch_id']); data['command'] = UUID(accepted['command']['command_id'])
    rotate(schema)
    first = read(schema, epoch)
    assert first['episode_count'] == 1 and first['episodes'][0]['binding'] is None
    assert summarize_writing_cohort(first, epoch)['states']['unstarted'] == 1
    execute(schema, data)
    second = read(schema, epoch)
    assert second['episode_count'] == 1 and summarize_writing_cohort(second, epoch)['states']['pending'] == 1
    # Resume belongs to a later activity epoch, not its first-membership cohort.
    resumed = prepare(schema, {**data, 'nonce': uuid4().hex * 2})
    later_epoch = UUID(resumed['command']['activity_epoch_id']); rotate(schema)
    assert read(schema, later_epoch)['episode_count'] == 0
    assert read(schema, epoch)['episode_count'] == 1


def test_current_feedback_view_regrade_and_owner_change_are_canonical(schema):
    rotate(schema); data = start(schema); rotate(schema); epoch = data['epoch']; essay = uuid4()
    psql(f"INSERT INTO {schema}.writing_essays(id,student_id,status,current_version) VALUES('{essay}','{data['student']}','graded',1); "
         f"INSERT INTO {schema}.writing_feedback VALUES('{essay}',1,6.5); "
         f"UPDATE {schema}.writing_assignments SET essay_id='{essay}',status='graded' WHERE id='{data['assignment']}'")
    original = snapshot(schema, data)
    report = summarize_writing_cohort(read(schema, epoch), epoch)
    assert report['states']['success'] == 1 and snapshot(schema, data) == original
    # Simulate partial regrade commit: current version moved but feedback absent.
    psql(f"UPDATE {schema}.writing_essays SET current_version=2 WHERE id='{essay}'")
    assert summarize_writing_cohort(read(schema, epoch), epoch)['states']['unknown'] == 1
    psql(f"INSERT INTO {schema}.writing_feedback VALUES('{essay}',2,7.0)")
    assert summarize_writing_cohort(read(schema, epoch), epoch)['states']['success'] == 1
    psql(f"UPDATE {schema}.students SET user_id='{uuid4()}' WHERE id='{data['student']}'")
    changed = summarize_writing_cohort(read(schema, epoch), epoch)
    assert changed['admitted_episode_count'] == 1 and changed['states']['unknown'] == 1


def test_missing_assignment_remains_a_cohort_member(schema):
    rotate(schema); data = start(schema); rotate(schema)
    psql(f"DELETE FROM {schema}.writing_assignments WHERE id='{data['assignment']}'")
    raw = read(schema, data['epoch'])
    assert raw['episode_count'] == 1 and raw['episodes'][0]['source'] is None
    assert summarize_writing_cohort(raw, data['epoch'])['states']['unknown'] == 1


def test_snapshot_is_read_only_private_and_excludes_learner_content(schema):
    rotate(schema); data = start(schema); rotate(schema)
    psql(f"INSERT INTO {schema}.writing_drafts(assignment_id,student_id,draft_text) "
         f"VALUES('{data['assignment']}','{data['student']}','PRIVATE_LEARNER_TEXT')")
    sql = f"SELECT {schema}.fn_read_writing_admission_cohort('{data['epoch']}')"
    raw = psql('BEGIN READ ONLY; SET LOCAL ROLE service_role; ' + sql + '; COMMIT;')
    assert 'PRIVATE_LEARNER_TEXT' not in raw and 'nonce_digest' not in raw and 'draft_text' not in raw
    for role in ['anon', 'authenticated']:
        with pytest.raises(RuntimeError, match='permission denied'): psql(f'SET ROLE {role}; ' + sql)


def test_large_cohort_is_refused_not_truncated(schema):
    epoch = rotate(schema)
    # Fixture-only bulk membership to exercise the guard, not prospective
    # admission evidence. No source rows/commands are fabricated in production.
    psql(f"""
        WITH inserted AS (
            INSERT INTO {schema}.core_admission_scopes(principal_id,domain,scope_key,resource_id)
            SELECT gen_random_uuid(),'writing_assignment',gen_random_uuid(),gen_random_uuid() FROM generate_series(1,1001)
            RETURNING id,principal_id,domain
        ) INSERT INTO {schema}.core_attempt_episodes(scope_id,principal_id,domain,first_admission_epoch_id)
          SELECT id,principal_id,domain,'{epoch}' FROM inserted;
    """)
    rotate(schema)
    with pytest.raises(RuntimeError, match='writing_cohort_requires_materialization'): read(schema, epoch)


def test_source_regrade_snapshot_does_not_mix_versions_across_reads(schema):
    rotate(schema); data = start(schema); rotate(schema); essay = uuid4()
    psql(f"INSERT INTO {schema}.writing_essays(id,student_id,status,current_version) VALUES('{essay}','{data['student']}','graded',1); "
         f"INSERT INTO {schema}.writing_feedback VALUES('{essay}',1,6.5); "
         f"UPDATE {schema}.writing_assignments SET essay_id='{essay}',status='graded' WHERE id='{data['assignment']}'")
    async def run():
        reader, writer = await asyncpg.connect(DB), await asyncpg.connect(DB)
        sql = f"SELECT {schema}.fn_read_writing_admission_cohort('{data['epoch']}')"
        try:
            await reader.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
            first = json.loads(await reader.fetchval(sql))
            await writer.execute('BEGIN')
            await writer.execute(f"UPDATE {schema}.writing_essays SET current_version=2 WHERE id='{essay}'")
            await writer.execute(f"INSERT INTO {schema}.writing_feedback VALUES('{essay}',2,7.0)")
            await writer.execute('COMMIT')
            retained = json.loads(await reader.fetchval(sql))
            assert retained['episodes'] == first['episodes']
            assert summarize_writing_cohort(retained, data['epoch'])['states']['success'] == 1
            await reader.execute('COMMIT')
            current = json.loads(await reader.fetchval(sql))
            source = current['episodes'][0]['source']['essay']
            assert source['current_version'] == source['feedback'][0]['version'] == 2
            assert summarize_writing_cohort(current, data['epoch'])['admitted_episode_count'] == 1
        finally:
            await reader.close(); await writer.close()
    asyncio.run(run())
