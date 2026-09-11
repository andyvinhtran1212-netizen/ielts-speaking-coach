"""Actual private ledger RPCs on disposable LOCAL PG; no source enrollment claim."""
import asyncio
import json
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_migration_240_core_attempt_evidence import DB, probe, psql
from test_core_admission_design_postgres import wait_blocked

SQL = (Path(__file__).resolve().parents[1] / "migrations/247_core_admission_ledger.sql").read_text()


@pytest.fixture(scope="module")
def schema(probe):
    migrated = SQL.replace("public.", f"{probe}.").replace("pg_catalog, public", f"pg_catalog, {probe}")
    psql(migrated)
    psql(migrated)
    return probe


def rotate(schema, domain="writing_assignment"):
    previous = psql(f"SELECT id FROM {schema}.core_admission_epochs WHERE domain='{domain}' AND state='open'")
    expected = f"'{previous}'" if previous else "NULL"
    epoch = uuid4()
    assert psql(f"SET ROLE service_role; SELECT {schema}.fn_rotate_core_admission_epoch('{epoch}','{domain}','{'e'*64}',{expected})") == str(epoch)
    return epoch


def fields():
    return dict(principal=uuid4(), nonce=uuid4().hex * 2, semantic="a" * 64,
        scope=uuid4(), resource=uuid4(), domain="writing_assignment", action="start")


def prepare(schema, data, deadline="clock_timestamp()+interval '1 hour'"):
    return json.loads(psql(f"SET ROLE service_role; SELECT {schema}.fn_prepare_core_admission("
        f"'{data['principal']}','{data['nonce']}','{data['semantic']}','{data['domain']}',"
        f"'{data['scope']}','{data['resource']}','{data['action']}',{deadline})"))


def count(schema, table, predicate="TRUE"):
    return int(psql(f"SELECT count(*) FROM {schema}.{table} WHERE {predicate}"))


def expire(schema, command):
    # Wait only to the DB-generated deadline; never rewrite immutable history.
    psql(f"SELECT pg_sleep(greatest(0,extract(epoch FROM execute_before-clock_timestamp()))::double precision + 0.01) "
         f"FROM {schema}.core_admission_commands WHERE id='{command}'")


def test_no_activation_and_private_tables_functions(schema):
    assert count(schema, "core_admission_epochs") == 0
    assert "UPDATE public.writing_assignments" not in SQL
    for role in ("anon", "authenticated", "service_role"):
        for table in ("core_admission_epochs", "core_admission_scopes", "core_attempt_episodes",
                      "core_admission_commands", "core_admission_bindings", "core_admission_journal"):
            with pytest.raises(RuntimeError, match="permission denied"):
                psql(f"SET ROLE {role}; SELECT * FROM {schema}.{table}")
            with pytest.raises(RuntimeError, match="permission denied"):
                psql(f"SET ROLE {role}; DELETE FROM {schema}.{table}")
    for role in ("anon", "authenticated"):
        with pytest.raises(RuntimeError, match="permission denied"):
            psql(f"SET ROLE {role}; SELECT {schema}.fn_reconcile_core_admission(1)")
    assert psql(f"SELECT has_function_privilege('service_role','{schema}.fn_guard_core_admission_identity()','EXECUTE')") == "f"


def test_prepare_replay_preserves_command_deadline_and_journal(schema):
    rotate(schema)
    data = fields()
    first = prepare(schema, data)
    assert prepare(schema, data, "clock_timestamp()-interval '1 day'") == first
    assert count(schema, "core_attempt_episodes", f"principal_id='{data['principal']}'") == 1
    assert count(schema, "core_admission_journal", f"command_id='{first['command_id']}'") == 1
    assert first["phase"] == "accepted" and first["generation"] == 0
    for changes in ({"scope": uuid4()}, {"resource": uuid4()}, {"semantic": "b"*64},
                    {"action": "resume"}, {"domain": "reading_exam"}):
        with pytest.raises(RuntimeError, match="admission_replay_conflict"):
            prepare(schema, {**data, **changes})
    assert count(schema, "core_admission_scopes", f"principal_id='{data['principal']}'") == 1


def test_owned_status_and_principal_nonce_isolation(schema):
    rotate(schema)
    data = fields()
    first = prepare(schema, data)
    stranger = uuid4()
    raw = psql(f"SET ROLE service_role; SELECT {schema}.fn_get_core_admission('{stranger}','{first['command_id']}')")
    assert raw == ""
    raw = psql(f"SET ROLE service_role; SELECT {schema}.fn_get_core_admission('{data['principal']}','{first['command_id']}')")
    assert json.loads(raw) == first
    other = prepare(schema, {**data, "principal": stranger})
    assert other["command_id"] != first["command_id"] and other["episode_id"] != first["episode_id"]


def test_missing_epoch_rolls_back_all_allocations(schema):
    data = {**fields(), "domain": "mock_writing"}
    with pytest.raises(RuntimeError, match="admission_epoch_unavailable"):
        prepare(schema, data)
    assert count(schema, "core_admission_scopes", f"principal_id='{data['principal']}'") == 0
    assert count(schema, "core_attempt_episodes", f"principal_id='{data['principal']}'") == 0


@pytest.mark.parametrize("same_nonce", [True, False], ids=["exact-replay", "concurrent-resume"])
def test_real_rpc_concurrent_preparation_is_one_episode(schema, same_nonce):
    rotate(schema)
    data = fields()

    async def run():
        first, second = await asyncpg.connect(DB), await asyncpg.connect(DB)
        task = None
        query = f"SELECT {schema}.fn_prepare_core_admission($1,$2,$3,$4,$5,$6,'start',clock_timestamp()+interval '1 hour')"
        args = (data["principal"], data["nonce"], data["semantic"], data["domain"], data["scope"], data["resource"])
        try:
            await first.execute("SET ROLE service_role")
            await second.execute("SET ROLE service_role")
            async with first.transaction():
                initial = json.loads(await first.fetchval(query, *args))
                other_args = args if same_nonce else (args[0], uuid4().hex*2, *args[2:])
                task = asyncio.create_task(second.fetchval(query, *other_args))
                await first.execute("RESET ROLE")
                await wait_blocked(first, second, task)
            other = json.loads(await asyncio.wait_for(task, 3))
            assert initial["episode_id"] == other["episode_id"]
            assert (initial["command_id"] == other["command_id"]) is same_nonce
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await second.close()
            await first.close()
    asyncio.run(run())
    assert count(schema, "core_attempt_episodes", f"principal_id='{data['principal']}'") == 1


def test_epoch_rotation_waits_for_real_admission_then_preserves_first_cohort(schema):
    old_epoch = rotate(schema)
    new_epoch, data = uuid4(), fields()

    async def run():
        writer, closer = await asyncpg.connect(DB), await asyncpg.connect(DB)
        task = None
        try:
            async with writer.transaction():
                accepted = json.loads(await writer.fetchval(
                    f"SELECT {schema}.fn_prepare_core_admission($1,$2,$3,$4,$5,$6,'start',clock_timestamp()+interval '1 hour')",
                    data["principal"], data["nonce"], data["semantic"], data["domain"], data["scope"], data["resource"]))
                task = asyncio.create_task(closer.fetchval(
                    f"SELECT {schema}.fn_rotate_core_admission_epoch($1,'writing_assignment',$2,$3)", new_epoch, "e"*64, old_epoch))
                await wait_blocked(writer, closer, task)
            assert await asyncio.wait_for(task, 3) == new_epoch
            return accepted
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await closer.close()
            await writer.close()
    first = asyncio.run(run())
    later = prepare(schema, {**data, "nonce": uuid4().hex*2, "action": "resume"})
    assert later["episode_id"] == first["episode_id"]
    assert later["activity_epoch_id"] == str(new_epoch)
    assert psql(f"SELECT first_admission_epoch_id FROM {schema}.core_attempt_episodes WHERE id='{first['episode_id']}'") == str(old_epoch)
    with pytest.raises(RuntimeError, match="admission_immutable_identity"):
        psql(f"UPDATE {schema}.core_attempt_episodes SET first_admission_epoch_id='{new_epoch}' WHERE id='{first['episode_id']}'")
    assert psql(f"SET ROLE service_role; SELECT {schema}.fn_rotate_core_admission_epoch('{new_epoch}','writing_assignment','{'e'*64}','{old_epoch}')") == str(new_epoch)
    with pytest.raises(RuntimeError, match="admission_epoch_conflict"):
        psql(f"SET ROLE service_role; SELECT {schema}.fn_rotate_core_admission_epoch('{uuid4()}','writing_assignment','{'e'*64}','{old_epoch}')")
    assert psql(f"SELECT id FROM {schema}.core_admission_epochs WHERE domain='writing_assignment' AND state='open'") == str(new_epoch)


def test_reconciler_skips_locked_and_fences_expiry_without_failed_episode(schema):
    rotate(schema)
    a = prepare(schema, fields(), "clock_timestamp()+interval '50 milliseconds'")
    b = prepare(schema, fields(), "clock_timestamp()+interval '50 milliseconds'")
    expire(schema, b["command_id"])

    async def run():
        holder, reconciler = await asyncpg.connect(DB), await asyncpg.connect(DB)
        try:
            await reconciler.execute("SET ROLE service_role")
            async with holder.transaction():
                await holder.fetchrow(f"SELECT id FROM {schema}.core_admission_commands WHERE id=$1 FOR UPDATE", UUID(a["command_id"]))
                result = json.loads(await asyncio.wait_for(reconciler.fetchval(
                    f"SELECT {schema}.fn_reconcile_core_admission(100)"), 3))
                assert result == {"fenced_commands": 1, "coverage": "unknown", "gate_f": "not_assessed"}
                assert await holder.fetchval(f"SELECT phase FROM {schema}.core_admission_commands WHERE id=$1", UUID(a["command_id"])) == "accepted"
        finally:
            await reconciler.close()
            await holder.close()
    asyncio.run(run())
    result = json.loads(psql(f"SET ROLE service_role; SELECT {schema}.fn_reconcile_core_admission(100)"))
    assert result["fenced_commands"] == 1
    for command in (a, b):
        assert psql(f"SELECT phase || ':' || generation FROM {schema}.core_admission_commands WHERE id='{command['command_id']}'") == "unstarted_expired:1"
        assert count(schema, "core_admission_journal", f"command_id='{command['command_id']}'") == 2
        # An old generation cannot pass the executor's command predicate.
        assert psql(f"UPDATE {schema}.core_admission_commands SET phase='bound' WHERE id='{command['command_id']}' AND phase='accepted' AND generation=0 RETURNING id") == ""
    assert json.loads(psql(f"SET ROLE service_role; SELECT {schema}.fn_reconcile_core_admission(100)"))["fenced_commands"] == 0


@pytest.mark.parametrize("limit", ["NULL", "0", "101", "-1"])
def test_reconciler_rejects_unbounded_requests(schema, limit):
    with pytest.raises(RuntimeError, match="admission_invalid_batch_size"):
        psql(f"SET ROLE service_role; SELECT {schema}.fn_reconcile_core_admission({limit})")


def test_bound_requires_binding_and_identity_cannot_be_rewritten(schema):
    rotate(schema)
    data = fields()
    command = prepare(schema, data)
    with pytest.raises(RuntimeError, match="admission_binding_required"):
        psql(f"UPDATE {schema}.core_admission_commands SET phase='bound' WHERE id='{command['command_id']}'")
    with pytest.raises(RuntimeError, match="admission_invalid_transition"):
        psql(f"UPDATE {schema}.core_admission_commands SET principal_id='{uuid4()}' WHERE id='{command['command_id']}'")
    assert count(schema, "core_admission_journal", f"command_id='{command['command_id']}'") == 1


def test_migration_rejects_existing_broken_nonce_uniqueness(schema):
    # The entire failed re-application rolls back, including this deliberate
    # LOCAL fixture corruption. No shared source schema is touched.
    migrated = SQL.replace("public.", f"{schema}.").replace("pg_catalog, public", f"pg_catalog, {schema}")
    # Remove only the outer transaction delimiters, not function BEGIN tokens.
    body = migrated.split("BEGIN;", 1)[1].rsplit("COMMIT;", 1)[0]
    with pytest.raises(RuntimeError, match="admission_uniqueness_drift"):
        psql(f"BEGIN; ALTER TABLE {schema}.core_admission_commands DROP CONSTRAINT "
             f"core_admission_commands_principal_id_protocol_nonce_digest_key; {body} COMMIT;")
    assert psql(f"SELECT count(*) FROM pg_constraint WHERE conrelid='{schema}.core_admission_commands'::regclass "
                "AND conname='core_admission_commands_principal_id_protocol_nonce_digest_key'") == "1"


@pytest.mark.parametrize("operation", ["prepare", "rotate", "reconcile"])
def test_mutation_rpcs_require_read_committed(schema, operation):
    if operation == "prepare":
        statement = (f"SELECT {schema}.fn_prepare_core_admission('{uuid4()}','{'a'*64}','{'b'*64}',"
                     f"'writing_assignment','{uuid4()}','{uuid4()}','start',clock_timestamp()+interval '1 hour')")
    elif operation == "rotate":
        statement = f"SELECT {schema}.fn_rotate_core_admission_epoch('{uuid4()}','writing_assignment','{'c'*64}',NULL)"
    else:
        statement = f"SELECT {schema}.fn_reconcile_core_admission(1)"
    with pytest.raises(RuntimeError, match="admission_requires_read_committed"):
        psql(f"BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL ROLE service_role; {statement}; COMMIT;")
