"""Exercise migration 380, its rollback and its playback cap on disposable Postgres."""
import os
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import asyncpg
import pytest

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "380_listening_skill_drill_homework.sql"
ORIGINAL = Path(__file__).parent / "fixtures" / "skill_drill_migration_380_original.sql"


@pytest.mark.asyncio
async def test_380_preserves_submissions_and_bounds_checkpoints_across_pages():
    url = os.environ.get("TEST_PG_URL")
    if not url:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("TEST_PG_URL is required")
        pytest.skip("Disposable TEST_PG_URL is not configured")
    target = urlsplit(url)
    assert target.hostname in {"127.0.0.1", "localhost", "::1"}
    assert target.path == "/postgres" or target.path.lstrip("/").startswith("aver_")
    schema = "skill_drill_" + uuid4().hex
    con = await asyncpg.connect(url)
    forward = (MIGRATIONS / NAME).read_text().replace("public.", f"{schema}.")
    rollback = (MIGRATIONS / "rollback" / NAME).read_text().replace("public.", f"{schema}.")
    try:
        for role in ("anon", "authenticated", "service_role"):
            await con.execute(f"DO $$ BEGIN CREATE ROLE {role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$")
        await con.execute(f"""
            CREATE SCHEMA {schema};
            SET search_path = {schema}, pg_catalog;
            CREATE TABLE class_assignment_items (id uuid PRIMARY KEY);
            CREATE TABLE class_assignments (content_config jsonb);
            CREATE TABLE listening_test_attempts (id uuid PRIMARY KEY, started_at timestamptz, class_assignment_item_id uuid, status text);
            CREATE TABLE dictation_attempts (id uuid PRIMARY KEY, user_id uuid, test_id uuid, section_num int,
                                            status text, started_at timestamptz);
            CREATE TABLE dictation_sessions (id uuid PRIMARY KEY, section_num int, completed_at timestamptz);
            CREATE UNIQUE INDEX uq_dictation_attempts_one_active_section
                ON dictation_attempts(user_id,test_id,section_num) WHERE status='in_progress';
        """)
        assert "SET LOCAL lock_timeout" in forward
        await con.execute(forward)
        await con.execute(rollback)
        assert not await con.fetchval(f"SELECT to_regclass('{schema}.listening_drill_playback')")
        # Staging recorded this exact earlier 380, with CASCADE and only v1.
        await con.execute(ORIGINAL.read_text().replace("public.", f"{schema}."))
        item, attempt, page = uuid4(), uuid4(), uuid4()
        await con.execute("INSERT INTO class_assignment_items VALUES ($1)", item)
        await con.execute("INSERT INTO listening_test_attempts VALUES ($1, clock_timestamp() - interval '2 hours', $2, 'in_progress')",
                          attempt, item)
        await con.execute("INSERT INTO dictation_sessions VALUES ($1, 1, clock_timestamp(), $2)", uuid4(), item)
        await con.execute("INSERT INTO dictation_attempts VALUES ($1, $2, $3, 1, 'in_progress', clock_timestamp(), $4)",
                          uuid4(), uuid4(), uuid4(), item)
        old_checkpoint = f"SELECT {schema}.fn_record_listening_drill_playback($1,'listening',$2,$3,2,3000)"
        await con.execute(old_checkpoint, item, attempt, page)
        await con.execute(forward)
        assert await con.fetchval("SELECT count(*) FROM dictation_attempts") == 1
        assert await con.fetchval("SELECT count(*) FROM dictation_sessions") == 1
        assert tuple(await con.fetchrow("SELECT plays,played_ms FROM listening_drill_playback")) == (2, 3000)
        assert await con.fetchval("SELECT to_regprocedure($1) IS NULL",
                                  f"{schema}.fn_record_listening_drill_playback(uuid,text,uuid,uuid,integer,integer)")
        for role in ("anon", "authenticated"):
            for signature in ("fn_record_listening_drill_playback_v2(uuid,text,uuid,uuid,integer,integer)",
                              "fn_listening_drill_homework_ready()"):
                assert not await con.fetchval("SELECT has_function_privilege($1,$2,'EXECUTE')",
                                              role, f"{schema}.{signature}")
        checkpoint = f"SELECT {schema}.fn_record_listening_drill_playback_v2($1,'listening',$2,$3,$4,$5)"
        await con.execute(checkpoint, item, attempt, page, 90, 3000000)
        await con.execute(checkpoint, item, attempt, page, 89, 1000)
        second = uuid4()
        await con.execute("INSERT INTO listening_test_attempts VALUES ($1, clock_timestamp() - interval '2 hours', $2, 'in_progress')",
                          second, item)
        with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError, match="checkpoint_scope"):
            await con.execute(checkpoint, item, second, page, 100, 1000000)
        await con.execute(checkpoint, item, second, uuid4(), 100, 1000000)
        assert tuple(await con.fetchrow("SELECT sum(plays),sum(played_ms) FROM listening_drill_playback")) == (120, 3600000)
        for _ in range(64):
            await con.execute(checkpoint, item, second, uuid4(), 100, 1000000)
        assert await con.fetchval("SELECT count(*) FROM listening_drill_playback") == 64
        await con.execute("UPDATE listening_test_attempts SET status='submitted' WHERE id=$1", second)
        with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError, match="attempt_inactive"):
            await con.execute(checkpoint, item, second, uuid4(), 100, 1000000)
        fresh_item, fresh_attempt = uuid4(), uuid4()
        await con.execute("INSERT INTO class_assignment_items VALUES ($1)", fresh_item)
        await con.execute("INSERT INTO listening_test_attempts VALUES ($1, clock_timestamp() + interval '1 hour', $2, 'in_progress')",
                          fresh_attempt, fresh_item)
        await con.execute(checkpoint, fresh_item, fresh_attempt, uuid4(), 120, 3600000)
        bounded = await con.fetchrow("SELECT plays,played_ms FROM listening_drill_playback WHERE class_assignment_item_id=$1",
                                     fresh_item)
        assert tuple(bounded) == (1, 0)
        assert not await con.fetchval("SELECT has_table_privilege('authenticated','listening_drill_playback','SELECT')")
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await con.execute("DELETE FROM class_assignment_items WHERE id=$1", item)
        assert await con.fetchval("SELECT count(*) FROM dictation_sessions") == 1
        for table in ("dictation_attempts", "dictation_sessions"):
            assert await con.fetchval(
                "SELECT confdeltype::text FROM pg_constraint WHERE conrelid=$1::regclass AND contype='f'",
                f"{schema}.{table}") == "r"
        with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError, match="homework evidence exists"):
            await con.execute(rollback)
        await con.execute("ROLLBACK")
    finally:
        await con.execute("ROLLBACK")
        await con.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
        await con.close()
