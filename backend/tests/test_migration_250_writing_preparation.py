"""Validated Writing A against isolated LOCAL PostgreSQL, not deployed evidence."""
import asyncio
import json
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_core_admission_design_postgres import wait_blocked
from test_migration_240_core_attempt_evidence import DB, probe, psql
from test_migration_247_core_admission import rotate
from test_migration_248_writing_admission import schema as writing_schema, execute, snapshot
from test_migration_249_writing_provenance import schema as provenance_schema

SQL = (Path(__file__).resolve().parents[1] / "migrations/250_writing_admission_preparation.sql").read_text()


@pytest.fixture(scope="module")
def schema(provenance_schema):
    scoped = SQL.replace("public.", f"{provenance_schema}.").replace("pg_catalog,public", f"pg_catalog,{provenance_schema}")
    psql(scoped)
    psql(scoped)
    return provenance_schema


@pytest.fixture(autouse=True)
def capture_on(schema):
    psql(f"INSERT INTO {schema}.core_writing_capture_control(enabled,manifest_digest) VALUES(true,'{'e'*64}') "
         "ON CONFLICT (singleton) DO UPDATE SET enabled=true,manifest_digest=excluded.manifest_digest")


def seed(schema):
    data = dict(user=uuid4(), student=uuid4(), assignment=uuid4(), nonce=uuid4().hex * 2)
    psql(f"INSERT INTO {schema}.students VALUES('{data['student']}','{data['user']}'); "
         f"INSERT INTO {schema}.writing_assignments(id,student_id) VALUES('{data['assignment']}','{data['student']}')")
    return data


def prepare_sql(schema, data):
    return (f"SELECT {schema}.fn_prepare_writing_admission('{data['user']}','{data['student']}',"
            f"'{data['assignment']}','{data['nonce']}')")


def prepare(schema, data):
    return json.loads(psql("SET ROLE service_role; " + prepare_sql(schema, data)))


def counts(schema, data):
    return tuple(int(psql(f"SELECT count(*) FROM {schema}.{table} WHERE principal_id='{data['user']}'"))
                 for table in ("core_admission_scopes", "core_attempt_episodes", "core_admission_commands"))


def test_preparation_does_not_start_timer_and_exact_retry_recovers_after_execution(schema):
    data = seed(schema)
    source = snapshot(schema, data)
    first = prepare(schema, data)
    assert first["command"]["phase"] == "accepted"
    assert first["assignment"]["started_at"] is None
    assert snapshot(schema, data) == source and counts(schema, data) == (1, 1, 1)
    assert prepare(schema, data) == first
    command_id = first["command"]["command_id"]
    assert psql(f"SELECT execute_before > created_at AND execute_before <= created_at+interval '2 minutes' "
                f"FROM {schema}.core_admission_commands WHERE id='{command_id}'") == "t"
    data["command"] = UUID(command_id)
    started = execute(schema, data)
    recovered = prepare(schema, data)
    assert recovered == started and recovered["command"]["execute_before"] == first["command"]["execute_before"]
    assert counts(schema, data) == (1, 1, 1)


@pytest.mark.parametrize("activity", ["baseline", "draft", "start", "essay", "reassignment"])
def test_ineligible_source_never_allocates_scope_episode_or_command(schema, activity):
    if activity == "baseline":
        psql(f"UPDATE {schema}.core_writing_capture_control SET enabled=false")
    data = seed(schema)
    if activity == "draft":
        psql(f"INSERT INTO {schema}.writing_drafts(assignment_id,student_id,draft_text) "
             f"VALUES('{data['assignment']}','{data['student']}','previous work'); "
             f"DELETE FROM {schema}.writing_drafts WHERE assignment_id='{data['assignment']}'")
    elif activity == "start":
        psql(f"UPDATE {schema}.writing_assignments SET status='in_progress',started_at=clock_timestamp() WHERE id='{data['assignment']}'; "
             f"UPDATE {schema}.writing_assignments SET status='pending',started_at=NULL WHERE id='{data['assignment']}'")
    elif activity == "essay":
        psql(f"UPDATE {schema}.writing_assignments SET essay_id='{uuid4()}' WHERE id='{data['assignment']}'; "
             f"UPDATE {schema}.writing_assignments SET essay_id=NULL WHERE id='{data['assignment']}'")
    elif activity == "reassignment":
        other = uuid4()
        psql(f"INSERT INTO {schema}.students VALUES('{other}','{uuid4()}'); "
             f"UPDATE {schema}.writing_assignments SET student_id='{other}' WHERE id='{data['assignment']}'; "
             f"UPDATE {schema}.writing_assignments SET student_id='{data['student']}' WHERE id='{data['assignment']}'")
    before = snapshot(schema, data)
    with pytest.raises(RuntimeError, match="writing_admission_baseline_conflict"):
        prepare(schema, data)
    assert counts(schema, data) == (0, 0, 0) and snapshot(schema, data) == before


@pytest.mark.parametrize("field", ["user", "student", "assignment"])
def test_unowned_or_missing_source_is_indistinguishable_and_rolls_back(schema, field):
    data = seed(schema)
    attempted = {**data, field: uuid4()}
    with pytest.raises(RuntimeError, match="writing_admission_not_found"):
        prepare(schema, attempted)
    assert counts(schema, data) == (0, 0, 0) and counts(schema, attempted) == (0, 0, 0)


def test_conflicting_nonce_does_not_allocate_another_scope(schema):
    data = seed(schema)
    first = prepare(schema, data)
    second = uuid4()
    psql(f"INSERT INTO {schema}.writing_assignments(id,student_id) VALUES('{second}','{data['student']}')")
    with pytest.raises(RuntimeError, match="admission_replay_conflict"):
        prepare(schema, {**data, "assignment": second})
    assert prepare(schema, data) == first and counts(schema, data) == (1, 1, 1)


def test_expired_fenced_command_is_recovered_without_new_deadline(schema):
    data = seed(schema)
    # Use the private foundation to create a short-lived synthetic validated A,
    # avoiding a two-minute wall-clock sleep or edits to immutable command rows.
    semantic = f"encode(sha256(convert_to('writing-admission-v1:{data['assignment']}','UTF8')),'hex')"
    command = json.loads(psql(f"SET ROLE service_role; SELECT {schema}.fn_prepare_core_admission("
        f"'{data['user']}','{data['nonce']}',{semantic},'writing_assignment',"
        f"'{data['assignment']}','{data['assignment']}','start',clock_timestamp()+interval '50 milliseconds')"))
    psql(f"SELECT pg_sleep(greatest(0,extract(epoch FROM execute_before-clock_timestamp()))::double precision+0.01) "
         f"FROM {schema}.core_admission_commands WHERE id='{command['command_id']}'")
    psql(f"SET ROLE service_role; SELECT {schema}.fn_reconcile_core_admission(100)")
    recovered = prepare(schema, data)
    assert recovered["command"]["phase"] == "unstarted_expired"
    assert recovered["command"]["command_id"] == command["command_id"]
    assert recovered["command"]["execute_before"] == command["execute_before"]
    assert recovered["command"]["generation"] == 1 and counts(schema, data) == (1, 1, 1)
    assert snapshot(schema, data)["started_at"] is None


def test_resume_keeps_first_epoch_and_closed_epoch_replay_remains_available(schema):
    data = seed(schema)
    first = prepare(schema, data)
    data["command"] = UUID(first["command"]["command_id"])
    started = execute(schema, data)
    next_epoch = rotate(schema)
    resumed = prepare(schema, {**data, "nonce": uuid4().hex * 2})
    assert resumed["command"]["episode_id"] == first["command"]["episode_id"]
    assert resumed["command"]["activity_epoch_id"] == str(next_epoch)
    assert resumed["assignment"]["started_at"] == started["assignment"]["started_at"]
    assert psql(f"SELECT first_admission_epoch_id FROM {schema}.core_attempt_episodes WHERE id='{first['command']['episode_id']}'") == first["command"]["activity_epoch_id"]
    psql(f"UPDATE {schema}.core_admission_epochs SET state='closed' WHERE state='open' AND domain='writing_assignment'")
    try:
        assert prepare(schema, data) == started
        with pytest.raises(RuntimeError, match="admission_epoch_unavailable"):
            prepare(schema, {**data, "nonce": uuid4().hex * 2})
        assert counts(schema, data) == (1, 1, 2)
        psql(f"UPDATE {schema}.writing_assignments SET status='submitted' WHERE id='{data['assignment']}'")
        assert prepare(schema, data)["assignment"]["status"] == "submitted"
        with pytest.raises(RuntimeError, match="writing_admission_state_conflict"):
            prepare(schema, {**data, "nonce": uuid4().hex * 2})
    finally:
        rotate(schema)


@pytest.mark.parametrize("same_nonce", [True, False])
def test_concurrent_prepares_share_episode_and_never_start_source(schema, same_nonce):
    data = seed(schema)
    later = data if same_nonce else {**data, "nonce": uuid4().hex * 2}

    async def run():
        first, second = await asyncpg.connect(DB), await asyncpg.connect(DB)
        task = None
        try:
            async with first.transaction():
                result = json.loads(await first.fetchval(prepare_sql(schema, data)))
                task = asyncio.create_task(second.fetchval(prepare_sql(schema, later)))
                await wait_blocked(first, second, task)
            other = json.loads(await asyncio.wait_for(task, 3))
            assert result["command"]["episode_id"] == other["command"]["episode_id"]
            assert (result["command"]["command_id"] == other["command"]["command_id"]) == same_nonce
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await second.close()
            await first.close()
    asyncio.run(run())
    assert snapshot(schema, data)["started_at"] is None
    assert counts(schema, data) == (1, 1, 1 if same_nonce else 2)


def test_draft_committed_while_prepare_waits_is_checked_before_admission(schema):
    data = seed(schema)

    async def run():
        draft, admission = await asyncpg.connect(DB), await asyncpg.connect(DB)
        task = None
        try:
            async with draft.transaction():
                await draft.execute(f"INSERT INTO {schema}.writing_drafts(assignment_id,student_id,draft_text) VALUES($1,$2,'kept draft')",
                                    data["assignment"], data["student"])
                task = asyncio.create_task(admission.fetchval(prepare_sql(schema, data)))
                await wait_blocked(draft, admission, task)
            with pytest.raises(asyncpg.PostgresError, match="writing_admission_baseline_conflict"):
                await asyncio.wait_for(task, 3)
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await admission.close()
            await draft.close()
    asyncio.run(run())
    assert counts(schema, data) == (0, 0, 0)
    assert psql(f"SELECT draft_text FROM {schema}.writing_drafts WHERE assignment_id='{data['assignment']}'") == "kept draft"


def test_journal_failure_rolls_back_preparation_and_can_retry_same_nonce(schema):
    data = seed(schema)
    psql(f"""CREATE FUNCTION {schema}.fixture_reject_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'fixture_acceptance_failure'; END $$;
        CREATE TRIGGER fixture_reject_acceptance BEFORE INSERT ON {schema}.core_admission_journal
        FOR EACH ROW EXECUTE FUNCTION {schema}.fixture_reject_acceptance();""")
    try:
        with pytest.raises(RuntimeError, match="fixture_acceptance_failure"):
            prepare(schema, data)
        assert counts(schema, data) == (0, 0, 0)
        assert snapshot(schema, data)["started_at"] is None
    finally:
        psql(f"DROP TRIGGER fixture_reject_acceptance ON {schema}.core_admission_journal; DROP FUNCTION {schema}.fixture_reject_acceptance()")
    assert prepare(schema, data)["command"]["phase"] == "accepted"


@pytest.mark.parametrize("isolation", ["REPEATABLE READ", "SERIALIZABLE"])
def test_non_read_committed_cannot_admit(schema, isolation):
    data = seed(schema)
    with pytest.raises(RuntimeError, match="requires_read_committed"):
        psql(f"BEGIN ISOLATION LEVEL {isolation}; " + prepare_sql(schema, data))
    assert counts(schema, data) == (0, 0, 0)


def test_browser_roles_cannot_call_preparation(schema):
    data = seed(schema)
    for role in ("anon", "authenticated"):
        with pytest.raises(RuntimeError, match="permission denied"):
            psql(f"SET ROLE {role}; " + prepare_sql(schema, data))
    assert counts(schema, data) == (0, 0, 0)
