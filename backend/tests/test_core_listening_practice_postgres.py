"""Execute the unchanged migration-224 first-answer function on disposable PG.

This tests the RPC's boolean/race contract, not the entire 224 rollout. The
minimal product table is isolated; the caller's auth is tested at route level.
"""

import asyncio
import json
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest

from test_migration_240_core_attempt_evidence import DB, probe, psql

SQL = (Path(__file__).resolve().parents[1] / "migrations/224_active_player_resume_ttl.sql").read_text()
HEADER = "CREATE OR REPLACE FUNCTION public.fn_insert_listening_answer_once("
assert SQL.count(HEADER) == 1
FUNCTION = HEADER + SQL.split(HEADER, 1)[1].split("\n$$;", 1)[0] + "\n$$;"


@pytest.fixture(scope="module")
def schema(probe):
    psql(f"""CREATE TABLE {probe}.listening_test_attempts (
        id uuid PRIMARY KEY, status text NOT NULL,
        answers jsonb NOT NULL DEFAULT '[]', resume_expires_at timestamptz
    )""")
    psql(FUNCTION.replace("public.", f"{probe}.").replace("search_path = public,", f"search_path = {probe},"))
    return probe


def test_actual_first_answer_return_contract_is_true_false_or_null(schema):
    attempt = uuid4()
    psql(f"INSERT INTO {schema}.listening_test_attempts(id,status,resume_expires_at) VALUES ('{attempt}','in_progress',now()+interval '1 hour')")
    assert psql(f"SELECT {schema}.fn_insert_listening_answer_once('{attempt}',1,'ninety')") == "t"
    assert psql(f"SELECT {schema}.fn_insert_listening_answer_once('{attempt}',1,'nineteen')") == "f"
    answers = json.loads(psql(f"SELECT answers FROM {schema}.listening_test_attempts WHERE id='{attempt}'"))
    assert len(answers) == 1 and answers[0]["user_answer"] == "ninety"
    assert psql(f"SELECT {schema}.fn_insert_listening_answer_once('{uuid4()}',1,'x') IS NULL") == "t"
    psql(f"UPDATE {schema}.listening_test_attempts SET resume_expires_at=now()-interval '1 hour' WHERE id='{attempt}'")
    assert psql(f"SELECT {schema}.fn_insert_listening_answer_once('{attempt}',1,'x') IS NULL") == "t"


@pytest.mark.parametrize("change", ["submitted", "rival_answer"])
def test_false_can_mean_finalization_race_without_any_canonical_answer(schema, change):
    attempt = uuid4()

    async def check():
        blocker = await asyncpg.connect(DB)
        reader = await asyncpg.connect(DB)
        transaction = blocker.transaction()
        task = None
        try:
            await blocker.execute(f"INSERT INTO {schema}.listening_test_attempts(id,status,resume_expires_at) VALUES ($1,'in_progress',now()+interval '1 hour')", attempt)
            await transaction.start()
            if change == "submitted":
                await blocker.execute(f"UPDATE {schema}.listening_test_attempts SET status='submitted' WHERE id=$1", attempt)
            else:
                await blocker.execute(f"UPDATE {schema}.listening_test_attempts SET answers='[{{\"q_num\":1,\"user_answer\":\"ninety\"}}]' WHERE id=$1", attempt)
            task = asyncio.create_task(reader.fetchval(
                f"SELECT {schema}.fn_insert_listening_answer_once($1,1,'nineteen')", attempt))
            # Wait for a proven row-lock overlap, not an arbitrary sleep. The
            # function's initial SELECT saw the old active/empty snapshot.
            async with asyncio.timeout(3):
                while True:
                    blocked = await blocker.fetchval("SELECT $1 = ANY(pg_blocking_pids($2))",
                                                     blocker.get_server_pid(), reader.get_server_pid())
                    if blocked: break
                    if task.done(): raise AssertionError("RPC did not overlap the writer lock")
                    await asyncio.sleep(0.01)
            await transaction.commit()
            assert await asyncio.wait_for(task, 3) is False
            row = await reader.fetchrow(f"SELECT status,answers FROM {schema}.listening_test_attempts WHERE id=$1", attempt)
            answers = json.loads(row["answers"])
            if change == "submitted":
                assert row["status"] == "submitted" and answers == []
            else:
                assert row["status"] == "in_progress" and answers == [{"q_num": 1, "user_answer": "ninety"}]
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await reader.close()
            await blocker.close()

    asyncio.run(check())
