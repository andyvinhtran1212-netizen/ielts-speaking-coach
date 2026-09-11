"""Real Writing execution transactions + actual migration-224 draft guard, LOCAL PG."""
import asyncio
import json
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_migration_240_core_attempt_evidence import DB, probe, psql
from test_migration_247_core_admission import SQL as LEDGER_SQL, rotate
from test_core_admission_design_postgres import wait_blocked

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
SQL = (MIGRATIONS / "248_writing_admission_execution.sql").read_text()
TTL_SQL = (MIGRATIONS / "224_active_player_resume_ttl.sql").read_text()


@pytest.fixture(scope="module")
def schema(probe):
    def scoped(sql):
        return sql.replace("public.", f"{probe}.").replace("pg_catalog,public", f"pg_catalog,{probe}") \
            .replace("pg_catalog, public", f"pg_catalog, {probe}").replace("search_path = public,", f"search_path = {probe},")
    psql(scoped(LEDGER_SQL))
    psql(f"""
        CREATE TABLE {probe}.students(id uuid PRIMARY KEY,user_id uuid NOT NULL);
        CREATE TABLE {probe}.writing_assignments(
            id uuid PRIMARY KEY,student_id uuid NOT NULL REFERENCES {probe}.students(id),
            status text NOT NULL DEFAULT 'pending',started_at timestamptz,
            is_timed boolean NOT NULL DEFAULT true,time_limit_minutes integer DEFAULT 40,
            auto_submitted boolean NOT NULL DEFAULT false,renderer_affinity text DEFAULT 'next',
            renderer_affinity_claimed_at timestamptz DEFAULT clock_timestamp(),
            renderer_affinity_expires_at timestamptz DEFAULT clock_timestamp()+interval '24 hours'
        );
        CREATE TABLE {probe}.writing_drafts(
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            assignment_id uuid NOT NULL UNIQUE REFERENCES {probe}.writing_assignments(id),
            student_id uuid NOT NULL,draft_text text NOT NULL DEFAULT ''
        );
    """)
    # Actual product guard, not a fake mutex invented solely for this test.
    guard = "CREATE OR REPLACE FUNCTION public.fn_guard_writing_draft_mutation()" + TTL_SQL.split(
        "CREATE OR REPLACE FUNCTION public.fn_guard_writing_draft_mutation()", 1)[1].split(
        "-- Parent terminal-state guards", 1)[0]
    psql(scoped(guard))
    psql(scoped(SQL))
    psql(scoped(SQL))
    rotate(probe)
    return probe


def seed(schema, *, short=False):
    user, student, assignment = uuid4(), uuid4(), uuid4()
    psql(f"INSERT INTO {schema}.students VALUES ('{student}','{user}'); "
         f"INSERT INTO {schema}.writing_assignments(id,student_id) VALUES ('{assignment}','{student}')")
    data = dict(user=user, student=student, assignment=assignment)
    data["command"] = prepare(schema, data, short=short)
    return data


def prepare(schema, data, *, short=False):
    deadline = "50 milliseconds" if short else "1 hour"
    result = json.loads(psql(f"SET ROLE service_role; SELECT {schema}.fn_prepare_core_admission("
        f"'{data['user']}','{uuid4().hex*2}','{'a'*64}','writing_assignment',"
        f"'{data['assignment']}','{data['assignment']}','start',clock_timestamp()+interval '{deadline}')"))
    return UUID(result["command_id"])


def execute_sql(schema, data):
    return (f"SELECT {schema}.fn_execute_writing_admission('{data['user']}','{data['student']}',"
            f"'{data['assignment']}','{data['command']}',0)")


def execute(schema, data):
    return json.loads(psql("SET ROLE service_role; " + execute_sql(schema, data)))


def snapshot(schema, data):
    return json.loads(psql(f"SELECT to_jsonb(a) FROM {schema}.writing_assignments a WHERE id='{data['assignment']}'"))


def phase(schema, data):
    return psql(f"SELECT phase FROM {schema}.core_admission_commands WHERE id='{data['command']}'")


def test_atomic_start_replay_and_completed_readback_never_reset_timer(schema):
    data = seed(schema)
    first = execute(schema, data)
    assert first["command"]["phase"] == "bound"
    assert first["assignment"]["status"] == "in_progress"
    assert first["assignment"]["started_at"] is not None
    canonical = snapshot(schema, data)
    assert execute(schema, data) == first
    assert snapshot(schema, data) == canonical  # Replay does not renew even the lease.
    psql(f"UPDATE {schema}.writing_assignments SET status='submitted',renderer_affinity_expires_at=clock_timestamp()-interval '1 minute' WHERE id='{data['assignment']}'")
    submitted = snapshot(schema, data)
    result = execute(schema, data)
    assert result["assignment"]["status"] == "submitted"
    assert result["assignment"]["started_at"] == first["assignment"]["started_at"]
    assert snapshot(schema, data) == submitted


@pytest.mark.parametrize("baseline", ["draft", "started", "in_progress"])
def test_known_baseline_not_adopted_and_content_preserved(schema, baseline):
    data = seed(schema)
    if baseline == "draft":
        psql(f"INSERT INTO {schema}.writing_drafts(assignment_id,student_id,draft_text) "
             f"VALUES('{data['assignment']}','{data['student']}','original learner draft')")
    elif baseline == "started":
        psql(f"UPDATE {schema}.writing_assignments SET started_at=clock_timestamp()-interval '5 minutes' WHERE id='{data['assignment']}'")
    else:
        psql(f"UPDATE {schema}.writing_assignments SET status='in_progress' WHERE id='{data['assignment']}'")
    before = snapshot(schema, data)
    with pytest.raises(RuntimeError, match="writing_admission_baseline_conflict"):
        execute(schema, data)
    assert snapshot(schema, data) == before and phase(schema, data) == "accepted"
    if baseline == "draft":
        assert psql(f"SELECT draft_text FROM {schema}.writing_drafts WHERE assignment_id='{data['assignment']}'") == "original learner draft"


@pytest.mark.parametrize("change", ["user", "student", "assignment", "command"])
def test_cross_owner_resource_and_missing_are_same_rejection(schema, change):
    data = seed(schema)
    with pytest.raises(RuntimeError, match="writing_admission_not_found"):
        execute(schema, {**data, change: uuid4()})
    assert snapshot(schema, data)["started_at"] is None


def test_lease_rejection_and_bound_marker_failure_roll_back_all_writes(schema):
    data = seed(schema)
    psql(f"UPDATE {schema}.writing_assignments SET renderer_affinity_expires_at=clock_timestamp()-interval '1 minute' WHERE id='{data['assignment']}'")
    with pytest.raises(RuntimeError, match="writing_admission_lease_expired"):
        execute(schema, data)
    assert snapshot(schema, data)["started_at"] is None
    psql(f"UPDATE {schema}.writing_assignments SET renderer_affinity_expires_at=clock_timestamp()+interval '1 hour' WHERE id='{data['assignment']}'")
    before = snapshot(schema, data)
    # Fail after source+binding writes, during the durable command marker.
    psql(f"""
        CREATE FUNCTION {schema}.fixture_reject_bound() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.command_id='{data['command']}'::uuid AND NEW.transition='bound' THEN
                RAISE EXCEPTION 'fixture_bound_failure';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER fixture_reject_bound BEFORE INSERT ON {schema}.core_admission_journal
            FOR EACH ROW EXECUTE FUNCTION {schema}.fixture_reject_bound();
    """)
    try:
        with pytest.raises(RuntimeError, match="fixture_bound_failure"):
            execute(schema, data)
        assert snapshot(schema, data) == before and phase(schema, data) == "accepted"
        assert psql(f"SELECT count(*) FROM {schema}.core_admission_bindings WHERE canonical_id='{data['assignment']}'") == "0"
    finally:
        psql(f"DROP TRIGGER fixture_reject_bound ON {schema}.core_admission_journal; DROP FUNCTION {schema}.fixture_reject_bound()")
    assert execute(schema, data)["command"]["phase"] == "bound"


@pytest.mark.parametrize("same_command", [True, False], ids=["replay", "resume"])
def test_overlapping_executors_preserve_single_start(schema, same_command):
    data = seed(schema)
    later = data if same_command else {**data, "command": prepare(schema, data)}

    async def run():
        first, second = await asyncpg.connect(DB), await asyncpg.connect(DB)
        task = None
        try:
            await first.execute("SET ROLE service_role")
            await second.execute("SET ROLE service_role")
            async with first.transaction():
                result = json.loads(await first.fetchval(execute_sql(schema, data)))
                task = asyncio.create_task(second.fetchval(execute_sql(schema, later)))
                await first.execute("RESET ROLE")
                await wait_blocked(first, second, task)
            resumed = json.loads(await asyncio.wait_for(task, 3))
            assert resumed["assignment"]["started_at"] == result["assignment"]["started_at"]
            assert resumed["command"]["episode_id"] == result["command"]["episode_id"]
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await second.close()
            await first.close()
    asyncio.run(run())
    assert psql(f"SELECT count(*) FROM {schema}.core_admission_bindings WHERE canonical_id='{data['assignment']}'") == "1"


def test_reconciler_fences_waiting_real_executor_before_timer_mutation(schema):
    data = seed(schema, short=True)
    psql(f"SELECT pg_sleep(greatest(0,extract(epoch FROM execute_before-clock_timestamp()))::double precision+0.01) FROM {schema}.core_admission_commands WHERE id='{data['command']}'")

    async def run():
        reconciler, executor = await asyncpg.connect(DB), await asyncpg.connect(DB)
        task = None
        try:
            async with reconciler.transaction():
                await reconciler.fetchval(f"SELECT {schema}.fn_reconcile_core_admission(100)")
                task = asyncio.create_task(executor.fetchval(execute_sql(schema, data)))
                await wait_blocked(reconciler, executor, task)
            with pytest.raises(asyncpg.PostgresError, match="writing_admission_fenced"):
                await asyncio.wait_for(task, 3)
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await executor.close()
            await reconciler.close()
    asyncio.run(run())
    assert snapshot(schema, data)["started_at"] is None
    assert phase(schema, data) == "unstarted_expired"


def test_actual_draft_guard_serializes_prior_content_before_execution(schema):
    data = seed(schema)

    async def run():
        draft, executor = await asyncpg.connect(DB), await asyncpg.connect(DB)
        task = None
        try:
            async with draft.transaction():
                await draft.execute(f"INSERT INTO {schema}.writing_drafts(assignment_id,student_id,draft_text) VALUES($1,$2,'saved before admission')",
                                    data["assignment"], data["student"])
                task = asyncio.create_task(executor.fetchval(execute_sql(schema, data)))
                await wait_blocked(draft, executor, task)
            with pytest.raises(asyncpg.PostgresError, match="writing_admission_baseline_conflict"):
                await asyncio.wait_for(task, 3)
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await executor.close()
            await draft.close()
    asyncio.run(run())
    assert snapshot(schema, data)["started_at"] is None
    assert psql(f"SELECT draft_text FROM {schema}.writing_drafts WHERE assignment_id='{data['assignment']}'") == "saved before admission"


def test_browser_roles_cannot_execute_sql(schema):
    data = seed(schema)
    for role in ("anon", "authenticated"):
        with pytest.raises(RuntimeError, match="permission denied"):
            psql(f"SET ROLE {role}; " + execute_sql(schema, data))


@pytest.mark.parametrize("isolation", ["REPEATABLE READ", "SERIALIZABLE"])
def test_rejects_snapshot_that_can_hide_a_committed_draft(schema, isolation):
    data = seed(schema)
    with pytest.raises(RuntimeError, match="writing_admission_requires_read_committed"):
        psql(f"BEGIN ISOLATION LEVEL {isolation}; SET LOCAL ROLE service_role; {execute_sql(schema, data)}; COMMIT;")
    assert snapshot(schema, data)["started_at"] is None and phase(schema, data) == "accepted"


def test_missing_enabled_draft_guard_blocks_migration(schema):
    body = SQL.replace("public.", f"{schema}.").replace("pg_catalog,public", f"pg_catalog,{schema}")
    body = body.split("BEGIN;", 1)[1].rsplit("COMMIT;", 1)[0]
    with pytest.raises(RuntimeError, match="writing_admission_requires_draft_guard"):
        psql(f"BEGIN; ALTER TABLE {schema}.writing_drafts DISABLE TRIGGER trg_guard_writing_draft_mutation; {body} COMMIT;")
    assert psql(f"SELECT tgenabled FROM pg_trigger WHERE tgrelid='{schema}.writing_drafts'::regclass AND tgname='trg_guard_writing_draft_mutation'") == "O"
