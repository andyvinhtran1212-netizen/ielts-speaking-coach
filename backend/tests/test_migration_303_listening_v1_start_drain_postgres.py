"""Exercise the v1.0 drain gate against disposable PostgreSQL schema."""

from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_migration_240_core_attempt_evidence import psql
from test_migration_295_listening_content_programmes_postgres import DB


pytest_plugins = ("test_migration_295_listening_content_programmes_postgres",)


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "303_listening_v1_start_drain_gate.sql"
).read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def drain_probe(programme_probe):
    schema = str(programme_probe["schema"])
    migrated = SQL.replace("public.", f"{schema}.").replace(
        "search_path = public,", f"search_path = {schema},"
    )
    psql(migrated)
    psql(migrated)
    assert psql(
        f"SELECT count(*) FROM {schema}.listening_programme_start_drain_gates "
        "WHERE package_id IN ('general-listening-practice-v1.0.0', "
        "'ielts-listening-practice-v1.0.0') AND draining=FALSE"
    ) == "2"
    # The reusable migration-295 fixture has a synthetic package ID. Add its
    # gate explicitly; production seeds the two immutable v1.0 IDs above.
    psql(
        f"INSERT INTO {schema}.listening_programme_start_drain_gates "
        "(package_id) VALUES ('fixture-general-v1')"
    )
    psql(
        f"SELECT status FROM {schema}.set_listening_content_package_status("
        f"'fixture-general-v1','{'a' * 64}','publish',NULL)"
    )
    test_id = psql(
        f"SELECT id FROM {schema}.listening_tests "
        "WHERE source_form_id='form-1'"
    )
    return {"schema": schema, "test_id": test_id, "migrated": migrated}


def test_drain_blocks_new_attempts_but_preserves_owned_resume(drain_probe):
    schema = drain_probe["schema"]
    test_id = drain_probe["test_id"]
    first_user = uuid4()
    second_user = uuid4()
    psql(
        f"INSERT INTO {schema}.users (id) VALUES "
        f"('{first_user}'),('{second_user}')"
    )
    created = psql(
        f"SELECT attempt_id || ':' || created FROM "
        f"{schema}.fn_acquire_listening_programme_attempt("
        f"'{test_id}','{first_user}','claim-v1')"
    )
    attempt_id, was_created = created.split(":")
    assert was_created == "true"

    psql(
        f"UPDATE {schema}.listening_programme_start_drain_gates "
        "SET draining=TRUE WHERE package_id='fixture-general-v1'"
    )
    # Reapplying the forward migration must not silently reopen a drain.
    psql(drain_probe["migrated"])
    assert psql(
        f"SELECT draining FROM {schema}.listening_programme_start_drain_gates "
        "WHERE package_id='fixture-general-v1'"
    ) == "t"

    resumed = psql(
        f"SELECT attempt_id || ':' || created FROM "
        f"{schema}.fn_acquire_listening_programme_attempt("
        f"'{test_id}','{first_user}','claim-v1')"
    )
    assert resumed == f"{attempt_id}:false"
    psql(
        f"UPDATE {schema}.listening_test_attempts "
        "SET answers='[{\"q_num\":1,\"user_answer\":\"kept\"}]'::jsonb "
        f"WHERE id='{attempt_id}'"
    )
    assert psql(
        f"SELECT answers->0->>'user_answer' FROM "
        f"{schema}.listening_test_attempts WHERE id='{attempt_id}'"
    ) == "kept"
    psql(
        f"UPDATE {schema}.listening_test_attempts SET status='submitted' "
        f"WHERE id='{attempt_id}'"
    )

    with pytest.raises(RuntimeError, match="listening_programme_new_starts_paused"):
        psql(
            f"SELECT * FROM {schema}.fn_acquire_listening_programme_attempt("
            f"'{test_id}','{second_user}','claim-v1')"
        )
    with pytest.raises(RuntimeError, match="listening_programme_new_starts_paused"):
        psql(
            f"INSERT INTO {schema}.listening_test_attempts "
            "(test_id,user_id,scoring_policy) VALUES "
            f"('{test_id}','{second_user}','report_only')"
        )
    assert psql(
        f"SELECT count(*) FROM {schema}.listening_test_attempts "
        f"WHERE user_id='{second_user}'"
    ) == "0"
    legacy_test_id = psql(
        f"SELECT id FROM {schema}.listening_tests "
        "WHERE test_id='legacy-ielts-fixture'"
    )
    psql(
        f"INSERT INTO {schema}.listening_test_attempts "
        "(test_id,user_id,scoring_policy) VALUES "
        f"('{legacy_test_id}','{second_user}','diagnostic')"
    )


def test_gate_activation_waits_for_in_flight_start(drain_probe):
    schema = drain_probe["schema"]
    test_id = drain_probe["test_id"]
    user_id = uuid4()
    psql(f"INSERT INTO {schema}.users (id) VALUES ('{user_id}')")
    psql(
        f"UPDATE {schema}.listening_programme_start_drain_gates "
        "SET draining=FALSE WHERE package_id='fixture-general-v1'"
    )

    async def overlap():
        first = await asyncpg.connect(DB)
        second = await asyncpg.connect(DB)
        update_task = None
        try:
            tx = first.transaction()
            await tx.start()
            await first.fetchrow(
                f"SELECT * FROM {schema}.fn_acquire_listening_programme_attempt("
                "$1,$2,'claim-v1')",
                UUID(test_id), user_id,
            )
            update_task = asyncio.create_task(second.execute(
                f"UPDATE {schema}.listening_programme_start_drain_gates "
                "SET draining=TRUE WHERE package_id='fixture-general-v1'"
            ))
            for _ in range(100):
                await first.execute("SELECT pg_stat_clear_snapshot()")
                blocked = await first.fetchval(
                    "SELECT wait_event_type = 'Lock' FROM pg_stat_activity "
                    "WHERE pid=$1", second.get_server_pid(),
                )
                if blocked:
                    break
                await asyncio.sleep(0.01)
            assert blocked, "gate activation overtook an in-flight INSERT"
            await tx.commit()
            await asyncio.wait_for(update_task, timeout=5)
        finally:
            if update_task is not None and not update_task.done():
                update_task.cancel()
                await asyncio.gather(update_task, return_exceptions=True)
            await first.close()
            await second.close()

    asyncio.run(overlap())
    assert psql(
        f"SELECT draining FROM {schema}.listening_programme_start_drain_gates "
        "WHERE package_id='fixture-general-v1'"
    ) == "t"
