"""Owned on-demand fencing on isolated LOCAL PG; no live start/coverage evidence."""
import asyncio
import json
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_core_admission_design_postgres import wait_blocked
from test_migration_240_core_attempt_evidence import DB, probe, psql
from test_migration_248_writing_admission import schema as writing_schema, execute, execute_sql, snapshot
from test_migration_249_writing_provenance import schema as provenance_schema
from test_migration_250_writing_preparation import schema as preparation_schema, capture_on, seed, prepare, counts

SQL = (Path(__file__).resolve().parents[1] / 'migrations/251_writing_admission_reconciliation.sql').read_text()


@pytest.fixture(scope='module')
def schema(preparation_schema):
    scoped = SQL.replace('public.', f'{preparation_schema}.').replace('pg_catalog,public', f'pg_catalog,{preparation_schema}')
    psql(scoped)
    psql(scoped)
    return preparation_schema


def query(schema, data):
    return (f"SELECT {schema}.fn_reconcile_writing_admission('{data['user']}','{data['student']}',"
            f"'{data['assignment']}','{data['command']}')")


def reconcile(schema, data):
    return json.loads(psql('SET ROLE service_role; ' + query(schema, data)))


def command(schema, *, short=False):
    data = seed(schema)
    if short:
        # Trusted fixture-only prepare uses the real immutable semantic contract
        # with a 50 ms deadline; no editing production command history or clocks.
        semantic = f"encode(sha256(convert_to('writing-admission-v1:{data['assignment']}','UTF8')),'hex')"
        raw = json.loads(psql(f"SET ROLE service_role; SELECT {schema}.fn_prepare_core_admission("
            f"'{data['user']}','{data['nonce']}',{semantic},'writing_assignment',"
            f"'{data['assignment']}','{data['assignment']}','start',clock_timestamp()+interval '50 milliseconds')"))
        data['command'] = UUID(raw['command_id'])
    else:
        data['command'] = UUID(prepare(schema, data)['command']['command_id'])
    return data


def expire(schema, data):
    psql(f"SELECT pg_sleep(greatest(0,extract(epoch FROM execute_before-clock_timestamp()))::double precision+0.01) "
         f"FROM {schema}.core_admission_commands WHERE id='{data['command']}'")


def test_expired_fencing_is_idempotent_and_never_mutates_source_or_denominator(schema):
    data = command(schema, short=True)
    expire(schema, data)
    before = snapshot(schema, data)
    first = reconcile(schema, data)
    assert first['command']['phase'] == 'unstarted_expired' and first['command']['generation'] == 1
    assert reconcile(schema, data) == first
    assert snapshot(schema, data) == before and counts(schema, data) == (1, 1, 1)
    assert psql(f"SELECT count(*) FROM {schema}.core_admission_journal WHERE command_id='{data['command']}'") == '2'
    assert psql(f"SELECT count(*) FROM {schema}.core_admission_bindings WHERE principal_id='{data['user']}'") == '0'
    with pytest.raises(RuntimeError, match='writing_admission_fenced'):
        execute(schema, data)


def test_early_reconcile_cannot_cancel_a_live_command(schema):
    data = command(schema)
    before = snapshot(schema, data)
    assert reconcile(schema, data)['command']['phase'] == 'accepted'
    assert snapshot(schema, data) == before
    assert psql(f"SELECT count(*) FROM {schema}.core_admission_journal WHERE command_id='{data['command']}'") == '1'
    assert execute(schema, data)['command']['phase'] == 'bound'


def test_expired_resume_command_does_not_fail_or_reset_the_existing_episode(schema):
    data = command(schema)
    first = execute(schema, data)
    canonical = snapshot(schema, data)
    semantic = f"encode(sha256(convert_to('writing-admission-v1:{data['assignment']}','UTF8')),'hex')"
    raw = json.loads(psql(f"SET ROLE service_role; SELECT {schema}.fn_prepare_core_admission("
        f"'{data['user']}','{uuid4().hex*2}',{semantic},'writing_assignment',"
        f"'{data['assignment']}','{data['assignment']}','start',clock_timestamp()+interval '50 milliseconds')"))
    later = {**data, 'command': UUID(raw['command_id'])}
    expire(schema, later)
    result = reconcile(schema, later)
    assert result['command']['phase'] == 'unstarted_expired'
    assert result['command']['episode_id'] == first['command']['episode_id']
    assert result['assignment']['started_at'] == first['assignment']['started_at']
    assert snapshot(schema, data) == canonical and counts(schema, data) == (1, 1, 2)
    assert reconcile(schema, data)['command']['phase'] == 'bound'


def test_journal_failure_rolls_back_fencing_instead_of_leaving_an_unlogged_marker(schema):
    data = command(schema, short=True)
    expire(schema, data)
    psql(f"""CREATE FUNCTION {schema}.reject_test_fence_journal() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.command_id='{data['command']}' AND NEW.transition='unstarted_expired' THEN
          RAISE EXCEPTION 'fixture_journal_failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER reject_test_fence_journal BEFORE INSERT ON {schema}.core_admission_journal
        FOR EACH ROW EXECUTE FUNCTION {schema}.reject_test_fence_journal();""")
    try:
        with pytest.raises(RuntimeError, match='fixture_journal_failure'):
            reconcile(schema, data)
        assert psql(f"SELECT phase FROM {schema}.core_admission_commands WHERE id='{data['command']}'") == 'accepted'
        assert psql(f"SELECT count(*) FROM {schema}.core_admission_journal WHERE command_id='{data['command']}'") == '1'
        assert snapshot(schema, data)['started_at'] is None
    finally:
        psql(f'DROP TRIGGER reject_test_fence_journal ON {schema}.core_admission_journal; DROP FUNCTION {schema}.reject_test_fence_journal()')


def test_bound_and_submitted_recovery_preserves_timer_draft_and_lease(schema):
    data = command(schema)
    first = execute(schema, data)
    psql(f"INSERT INTO {schema}.writing_drafts(assignment_id,student_id,draft_text) "
         f"VALUES('{data['assignment']}','{data['student']}','keep this learner draft')")
    psql(f"UPDATE {schema}.writing_assignments SET status='submitted',renderer_affinity_expires_at=clock_timestamp()-interval '1 day' WHERE id='{data['assignment']}'")
    before = snapshot(schema, data)
    value = reconcile(schema, data)
    assert value['command'] == first['command'] and value['assignment']['status'] == 'submitted'
    assert snapshot(schema, data) == before
    assert psql(f"SELECT draft_text FROM {schema}.writing_drafts WHERE assignment_id='{data['assignment']}'") == 'keep this learner draft'


@pytest.mark.parametrize('field', ['user', 'student', 'assignment', 'command'])
def test_unowned_or_mismatched_target_is_not_found_without_fencing(schema, field):
    data = command(schema, short=True)
    expire(schema, data)
    with pytest.raises(RuntimeError, match='writing_admission_not_found'):
        reconcile(schema, {**data, field: uuid4()})
    assert psql(f"SELECT phase FROM {schema}.core_admission_commands WHERE id='{data['command']}'") == 'accepted'


def test_reassigned_or_deleted_source_is_not_found_without_fencing(schema):
    data = command(schema, short=True)
    expire(schema, data)
    other = uuid4()
    psql(f"INSERT INTO {schema}.students VALUES('{other}','{uuid4()}'); "
         f"UPDATE {schema}.writing_assignments SET student_id='{other}' WHERE id='{data['assignment']}'")
    with pytest.raises(RuntimeError, match='writing_admission_not_found'):
        reconcile(schema, data)
    psql(f"DELETE FROM {schema}.writing_assignments WHERE id='{data['assignment']}'")
    with pytest.raises(RuntimeError, match='writing_admission_not_found'):
        reconcile(schema, data)
    assert psql(f"SELECT phase FROM {schema}.core_admission_commands WHERE id='{data['command']}'") == 'accepted'


def test_private_permissions_and_isolation_contract(schema):
    signature = f'{schema}.fn_reconcile_writing_admission(uuid,uuid,uuid,uuid)'
    for role in ['anon', 'authenticated']:
        assert psql(f"SELECT has_function_privilege('{role}','{signature}','EXECUTE')") == 'f'
    assert psql(f"SELECT has_function_privilege('service_role','{signature}','EXECUTE')") == 't'
    data = command(schema)
    with pytest.raises(RuntimeError, match='requires_read_committed'):
        psql('BEGIN ISOLATION LEVEL REPEATABLE READ; ' + query(schema, data) + '; COMMIT')
    with pytest.raises(RuntimeError, match='admission_invalid_input'):
        psql(f'SELECT {schema}.fn_reconcile_writing_admission(NULL,NULL,NULL,NULL)')


def test_fencer_never_waits_for_product_or_scope_locks(schema):
    data = command(schema, short=True)
    expire(schema, data)
    async def run():
        holder, fencer = await asyncpg.connect(DB), await asyncpg.connect(DB)
        try:
            async with holder.transaction():
                await holder.execute(f"SELECT id FROM {schema}.core_admission_scopes WHERE principal_id=$1 FOR UPDATE", data['user'])
                await holder.execute(f"SELECT id FROM {schema}.writing_assignments WHERE id=$1 FOR UPDATE", data['assignment'])
                await fencer.execute('SET ROLE service_role')
                value = json.loads(await asyncio.wait_for(fencer.fetchval(query(schema, data)), 2))
                assert value['command']['phase'] == 'unstarted_expired'
        finally:
            await fencer.close()
            await holder.close()
    asyncio.run(run())


@pytest.mark.parametrize('winner', ['execute', 'fence'])
def test_executor_and_fencer_serialize_without_overwriting_the_winner(schema, winner):
    data = command(schema, short=winner == 'fence')
    if winner == 'fence':
        expire(schema, data)
    async def run():
        first, second = await asyncpg.connect(DB), await asyncpg.connect(DB)
        task = None
        try:
            await first.execute('SET ROLE service_role')
            await second.execute('SET ROLE service_role')
            async with first.transaction():
                first_query = execute_sql(schema, data) if winner == 'execute' else query(schema, data)
                second_query = query(schema, data) if winner == 'execute' else execute_sql(schema, data)
                value = json.loads(await first.fetchval(first_query))
                task = asyncio.create_task(second.fetchval(second_query))
                await wait_blocked(first, second, task)
            if winner == 'execute':
                assert json.loads(await asyncio.wait_for(task, 3)) == value
                assert value['command']['phase'] == 'bound'
            else:
                with pytest.raises(asyncpg.PostgresError, match='writing_admission_fenced'):
                    await asyncio.wait_for(task, 3)
                assert value['command']['phase'] == 'unstarted_expired'
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await second.close()
            await first.close()
    asyncio.run(run())
    assert (snapshot(schema, data)['started_at'] is not None) == (winner == 'execute')


def test_deadline_is_evaluated_after_waiting_for_command_lock(schema):
    data = command(schema, short=True)
    async def run():
        holder, fencer = await asyncpg.connect(DB), await asyncpg.connect(DB)
        task = None
        try:
            async with holder.transaction():
                await holder.execute(f"SELECT id FROM {schema}.core_admission_commands WHERE id=$1 FOR UPDATE", data['command'])
                task = asyncio.create_task(fencer.fetchval(query(schema, data)))
                await wait_blocked(holder, fencer, task)
                await holder.execute(f"SELECT pg_sleep(greatest(0,extract(epoch FROM execute_before-clock_timestamp()))::double precision+0.01) "
                                     f"FROM {schema}.core_admission_commands WHERE id=$1", data['command'])
            assert json.loads(await asyncio.wait_for(task, 3))['command']['phase'] == 'unstarted_expired'
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await fencer.close()
            await holder.close()
    asyncio.run(run())
