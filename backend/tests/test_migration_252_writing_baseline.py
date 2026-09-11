"""Baseline compatibility on isolated local PostgreSQL; never eligible evidence."""
import asyncio
import json
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_core_admission_design_postgres import wait_blocked
from test_migration_240_core_attempt_evidence import DB, probe, psql
from test_migration_248_writing_admission import schema as writing_schema, execute, snapshot
from test_migration_249_writing_provenance import schema as provenance_schema
from test_migration_250_writing_preparation import schema as preparation_schema, capture_on, seed, prepare, counts
from test_migration_251_writing_reconciliation import schema as reconciliation_schema

SQL = (Path(__file__).resolve().parents[1] / 'migrations/252_writing_baseline_entry.sql').read_text()


@pytest.fixture(scope='module')
def schema(reconciliation_schema):
    scoped = SQL.replace('public.', f'{reconciliation_schema}.').replace('pg_catalog,public', f'pg_catalog,{reconciliation_schema}')
    psql(scoped); psql(scoped)
    return reconciliation_schema


def baseline(schema, *, tracked=False):
    if not tracked: psql(f'UPDATE {schema}.core_writing_capture_control SET enabled=false')
    try:
        data = seed(schema)
        if tracked:
            psql(f"INSERT INTO {schema}.writing_drafts(assignment_id,student_id,draft_text) "
                 f"VALUES('{data['assignment']}','{data['student']}','original learner draft')")
        return data
    finally:
        psql(f'UPDATE {schema}.core_writing_capture_control SET enabled=true')


def entry(schema, data):
    raw = psql(f"SET ROLE service_role; SELECT {schema}.fn_get_writing_entry('{data['user']}','{data['student']}','{data['assignment']}')")
    return json.loads(raw) if raw else None


def enter_sql(schema, data, allow=True):
    return (f"SELECT {schema}.fn_enter_writing_baseline('{data['user']}','{data['student']}',"
            f"'{data['assignment']}','{data['nonce']}',{str(allow).lower()})")


def enter(schema, data, allow=True):
    return json.loads(psql('SET ROLE service_role; ' + enter_sql(schema, data, allow)))


@pytest.mark.parametrize('tracked', [False, True])
def test_read_only_baseline_classification_and_entry_never_enroll_history(schema, tracked):
    data = baseline(schema, tracked=tracked)
    before = snapshot(schema, data)
    kind = 'baseline_unclaimed' if tracked else 'baseline_untracked'
    assert entry(schema, data)['kind'] == kind
    assert snapshot(schema, data) == before and counts(schema, data) == (0, 0, 0)
    first = enter(schema, data)
    assert first['kind'] == kind and first['assignment']['started_at'] is not None
    assert counts(schema, data) == (1, 0, 0)  # mutex scope, NOT an eligible episode
    canonical = snapshot(schema, data)
    assert enter(schema, data) == first and enter(schema, data, allow=False) == first
    assert snapshot(schema, data) == canonical
    assert canonical['renderer_affinity_expires_at'] == before['renderer_affinity_expires_at']
    if tracked:
        assert psql(f"SELECT first_activity FROM {schema}.core_writing_origins WHERE assignment_id='{data['assignment']}'") == 'unclaimed'
        assert psql(f"SELECT draft_text FROM {schema}.writing_drafts WHERE assignment_id='{data['assignment']}'") == 'original learner draft'
    else:
        assert psql(f"SELECT count(*) FROM {schema}.core_writing_origins WHERE assignment_id='{data['assignment']}'") == '0'


def test_unstarted_baseline_requires_explicit_permission_and_rolls_back_scope(schema):
    data = baseline(schema)
    before = snapshot(schema, data)
    with pytest.raises(RuntimeError, match='explicit_start_required'): enter(schema, data, allow=False)
    assert snapshot(schema, data) == before and counts(schema, data) == (0, 0, 0)


@pytest.mark.parametrize('timed', [False, True])
def test_existing_clock_and_terminal_state_survive_resume_even_if_timer_expired(schema, timed):
    data = baseline(schema)
    psql(f"UPDATE {schema}.writing_assignments SET started_at=clock_timestamp()-interval '1 hour',status='in_progress',"
         f"is_timed={str(timed).lower()},time_limit_minutes={'40' if timed else 'NULL'} WHERE id='{data['assignment']}'")
    before = snapshot(schema, data)
    assert enter(schema, data, allow=False)['assignment']['started_at'] == before['started_at']
    assert snapshot(schema, data) == before
    psql(f"UPDATE {schema}.writing_assignments SET status='submitted',renderer_affinity_expires_at=clock_timestamp()-interval '1 day' WHERE id='{data['assignment']}'")
    before = snapshot(schema, data)
    assert enter(schema, data)['kind'] == 'terminal'
    assert snapshot(schema, data) == before and counts(schema, data) == (1, 0, 0)


def test_eligible_and_admitted_work_can_never_use_baseline_entry(schema):
    data = seed(schema)
    assert entry(schema, data)['kind'] == 'eligible'
    with pytest.raises(RuntimeError, match='baseline_ineligible'): enter(schema, data)
    assert counts(schema, data) == (0, 0, 0)
    accepted = prepare(schema, data)
    # Same unknown nonce is rejected even before source classification.
    with pytest.raises(RuntimeError, match='baseline_has_admission'): enter(schema, data)
    with pytest.raises(RuntimeError, match='baseline_has_admission'): enter(schema, {**data, 'nonce': uuid4().hex*2})
    data['command'] = UUID(accepted['command']['command_id'])
    execute(schema, data)
    assert entry(schema, data)['kind'] == 'admitted'
    before = snapshot(schema, data)
    with pytest.raises(RuntimeError, match='baseline_has_admission'): enter(schema, {**data, 'nonce': uuid4().hex*2})
    assert snapshot(schema, data) == before and counts(schema, data) == (1, 1, 1)


def test_baseline_rejected_prepare_nonce_can_enter_without_retrospective_admission(schema):
    data = baseline(schema)
    with pytest.raises(RuntimeError, match='baseline_conflict'): prepare(schema, data)
    assert counts(schema, data) == (0, 0, 0)
    assert enter(schema, data)['kind'] == 'baseline_untracked'
    assert counts(schema, data) == (1, 0, 0)


@pytest.mark.parametrize('field', ['user', 'student', 'assignment'])
def test_wrong_owner_or_missing_baseline_has_no_visibility_or_persistent_scope(schema, field):
    data = baseline(schema)
    attempted = {**data, field: uuid4()}
    assert entry(schema, attempted) is None
    with pytest.raises(RuntimeError, match='not_found'): enter(schema, attempted)
    assert counts(schema, data) == (0, 0, 0) and counts(schema, attempted) == (0, 0, 0)


def test_invalidated_provenance_cannot_be_relabelled_as_baseline(schema):
    data = baseline(schema, tracked=True)
    other = uuid4()
    psql(f"INSERT INTO {schema}.students VALUES('{other}','{uuid4()}'); "
         f"UPDATE {schema}.writing_assignments SET student_id='{other}' WHERE id='{data['assignment']}'; "
         f"UPDATE {schema}.writing_assignments SET student_id='{data['student']}' WHERE id='{data['assignment']}'")
    assert entry(schema, data)['kind'] == 'blocked'
    with pytest.raises(RuntimeError, match='baseline_ineligible'): enter(schema, data)
    assert counts(schema, data) == (0, 0, 0)


def test_cross_resource_admission_nonce_cannot_be_used_for_baseline(schema):
    data = seed(schema); prepare(schema, data)
    old = baseline(schema)
    psql(f"UPDATE {schema}.writing_assignments SET student_id='{data['student']}' WHERE id='{old['assignment']}'")
    attempted = {**data, 'assignment': old['assignment']}
    with pytest.raises(RuntimeError, match='baseline_has_admission'): enter(schema, attempted)
    assert snapshot(schema, old)['started_at'] is None and counts(schema, data) == (1, 1, 1)


@pytest.mark.parametrize('lease', ['missing', 'expired'])
def test_baseline_lease_policy_cannot_be_bypassed(schema, lease):
    data = baseline(schema)
    expiry = 'NULL' if lease == 'missing' else "clock_timestamp()-interval '1 minute'"
    psql(f"UPDATE {schema}.writing_assignments SET renderer_affinity_expires_at={expiry} WHERE id='{data['assignment']}'")
    before = snapshot(schema, data)
    with pytest.raises(RuntimeError, match='lease_expired'): enter(schema, data)
    assert snapshot(schema, data) == before and counts(schema, data) == (0, 0, 0)


@pytest.mark.parametrize('same_nonce', [False, True])
def test_concurrent_baseline_entries_share_one_clock_without_creating_episode(schema, same_nonce):
    data = baseline(schema)
    later = data if same_nonce else {**data, 'nonce': uuid4().hex*2}
    async def run():
        first, second = await asyncpg.connect(DB), await asyncpg.connect(DB)
        task = None
        try:
            await first.execute('SET ROLE service_role'); await second.execute('SET ROLE service_role')
            async with first.transaction():
                one = json.loads(await first.fetchval(enter_sql(schema, data)))
                task = asyncio.create_task(second.fetchval(enter_sql(schema, later)))
                await wait_blocked(first, second, task)
            assert json.loads(await asyncio.wait_for(task, 3)) == one
        finally:
            if task is not None and not task.done():
                task.cancel(); await asyncio.gather(task, return_exceptions=True)
            await second.close(); await first.close()
    asyncio.run(run())
    assert counts(schema, data) == (1, 0, 0)


def test_stale_owner_classification_is_rechecked_after_source_lock_wait(schema):
    data = baseline(schema)
    assert entry(schema, data)['kind'] == 'baseline_untracked'
    other = uuid4()
    psql(f"INSERT INTO {schema}.students VALUES('{other}','{uuid4()}')")
    async def run():
        owner, starter = await asyncpg.connect(DB), await asyncpg.connect(DB)
        task = None
        try:
            async with owner.transaction():
                await owner.execute(f'UPDATE {schema}.writing_assignments SET student_id=$1 WHERE id=$2', other, data['assignment'])
                task = asyncio.create_task(starter.fetchval(enter_sql(schema, data)))
                await wait_blocked(owner, starter, task)
            with pytest.raises(asyncpg.PostgresError, match='not_found'): await asyncio.wait_for(task, 3)
        finally:
            if task is not None and not task.done():
                task.cancel(); await asyncio.gather(task, return_exceptions=True)
            await starter.close(); await owner.close()
    asyncio.run(run())
    assert snapshot(schema, data)['started_at'] is None and counts(schema, data) == (0, 0, 0)


def test_private_privileges_and_read_committed_contract(schema):
    for sig in ['fn_get_writing_entry(uuid,uuid,uuid)', 'fn_enter_writing_baseline(uuid,uuid,uuid,text,boolean)']:
        for role in ['anon', 'authenticated']:
            assert psql(f"SELECT has_function_privilege('{role}','{schema}.{sig}','EXECUTE')") == 'f'
        assert psql(f"SELECT has_function_privilege('service_role','{schema}.{sig}','EXECUTE')") == 't'
    data = baseline(schema)
    with pytest.raises(RuntimeError, match='requires_read_committed'):
        psql('BEGIN ISOLATION LEVEL REPEATABLE READ; ' + enter_sql(schema, data) + '; COMMIT')
    with pytest.raises(RuntimeError, match='invalid_input'):
        psql(f'SELECT {schema}.fn_enter_writing_baseline(NULL,NULL,NULL,NULL,NULL)')
