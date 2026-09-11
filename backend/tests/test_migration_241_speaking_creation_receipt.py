"""Execute real v3/v4 RPCs on an isolated LOCAL PostgreSQL schema."""

import asyncio
import json
import os
import re
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest

from test_migration_240_core_attempt_evidence import DB, psql

ROOT = Path(__file__).resolve().parents[1] / "migrations"
SQL = (ROOT / "241_speaking_creation_receipt.sql").read_text()


@pytest.fixture(scope="module")
def schema():
    try:
        ready = psql("SELECT 1") == "1"
    except Exception:
        ready = False
    if not ready:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Migration 241 requires explicit local disposable PostgreSQL")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Fixture requires owner of a disposable local cluster")
    name = "creation_probe_" + uuid4().hex
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    psql(f"CREATE SCHEMA {name}")
    def migrate(sql):
        return psql(f"SET search_path = {name}, public; " + sql.replace("public.", name + ".").replace("search_path = public,", f"search_path = {name},"))
    try:
        psql(f"""CREATE TABLE {name}.sessions (
            id uuid PRIMARY KEY, user_id uuid NOT NULL, mode text NOT NULL,
            part integer, topic text, status text NOT NULL,
            started_at timestamptz NOT NULL DEFAULT now(), renderer_affinity text
        ); GRANT USAGE ON SCHEMA {name} TO service_role, anon, authenticated;
        GRANT SELECT, INSERT, UPDATE ON {name}.sessions TO service_role;""")
        migrate((ROOT / "200_speaking_full_test_attempt_identity.sql").read_text())
        migrate((ROOT / "201_session_create_idempotency.sql").read_text())
        migrate((ROOT / "216_version_session_renderer_affinity_create.sql").read_text())
        original_v3 = psql(f"SELECT pg_get_functiondef('{name}.fn_create_session_daily_capped_v3(uuid,uuid,text,integer,text,timestamptz,integer,text)'::regprocedure)")
        migrate(SQL)
        migrate(SQL)
        assert psql(f"SELECT count(*) FROM {name}.sessions") == "0"
        assert psql(f"SELECT pg_get_functiondef('{name}.fn_create_session_daily_capped_v3(uuid,uuid,text,integer,text,timestamptz,integer,text)'::regprocedure)") == original_v3
        yield name
    finally:
        psql(f"DROP SCHEMA {name} CASCADE")


def call(schema, sid, owner, *, mode="practice", part=1, topic="Library", limit=10, affinity=None):
    renderer = "NULL" if affinity is None else "'" + affinity + "'"
    rows = psql(f"""SET ROLE service_role;
        SELECT row_to_json(receipt) FROM {schema}.fn_create_session_daily_capped_v4(
        '{sid}', '{owner}', '{mode}', {part}, '{topic}', CURRENT_DATE, {limit}, {renderer}) receipt""")
    return json.loads(rows)


def test_creation_and_replay_have_identical_row_but_distinct_created_fact(schema):
    sid, owner = uuid4(), uuid4()
    first = call(schema, sid, owner)
    second = call(schema, sid, owner, limit=0)  # replay bypasses quota, just like v3
    assert first["created"] is True and second["created"] is False
    assert first["session_data"] == second["session_data"]
    assert first["session_data"]["id"] == str(sid)
    assert first["session_data"]["renderer_affinity"] is None
    assert psql(f"SELECT count(*) FROM {schema}.sessions WHERE id='{sid}'") == "1"


@pytest.mark.parametrize("affinity", [None, "legacy", "next"])
def test_renderer_values_preserved_on_insert_and_replay(schema, affinity):
    sid, owner = uuid4(), uuid4()
    first = call(schema, sid, owner, affinity=affinity)
    replay = call(schema, sid, owner, affinity="next" if affinity != "next" else None)
    assert first["session_data"]["renderer_affinity"] == affinity
    assert replay["session_data"]["renderer_affinity"] == affinity


def test_full_test_trigger_identity_is_returned_without_reconstructing_it(schema):
    sid, owner = uuid4(), uuid4()
    first = call(schema, sid, owner, mode="test_full")
    replay = call(schema, sid, owner, mode="test_full")
    assert first["session_data"]["full_test_attempt_id"]
    assert first["session_data"] == replay["session_data"]
    assert replay["created"] is False


@pytest.mark.parametrize("change", ["user", "mode", "part", "topic"])
def test_existing_payload_conflicts_still_reject(schema, change):
    sid, owner = uuid4(), uuid4()
    first = call(schema, sid, owner)
    kwargs = {"mode": "test_part"} if change == "mode" else {"part": 2} if change == "part" else {"topic": "Other"} if change == "topic" else {}
    with pytest.raises(RuntimeError, match="session_id_conflict"):
        call(schema, sid, uuid4() if change == "user" else owner, **kwargs)
    assert call(schema, sid, owner)["session_data"] == first["session_data"]


def test_quota_failure_does_not_create_row(schema):
    sid = uuid4()
    with pytest.raises(RuntimeError, match="daily_quota_exceeded"):
        call(schema, sid, uuid4(), limit=0)
    assert psql(f"SELECT count(*) FROM {schema}.sessions WHERE id='{sid}'") == "0"


@pytest.mark.parametrize("limit", [4, 5, 6])
def test_v3_v4_have_identical_quota_boundary_on_same_seeded_rows(schema, limit):
    owner, full_id = uuid4(), uuid4()
    psql(f"""INSERT INTO {schema}.sessions(id,user_id,mode,part,topic,status,started_at,full_test_attempt_id)
        SELECT gen_random_uuid(),'{owner}','test_full',part,'Library','completed',CURRENT_DATE,'{full_id}'
          FROM generate_series(1,3) part;
        INSERT INTO {schema}.sessions(id,user_id,mode,part,topic,status,started_at) VALUES
          (gen_random_uuid(),'{owner}','practice',1,'Library','abandoned',CURRENT_DATE),
          (gen_random_uuid(),'{owner}','test_part',1,'Library','in_progress',CURRENT_DATE),
          (gen_random_uuid(),'{owner}','practice',1,'Library','completed',CURRENT_DATE - INTERVAL '1 day'),
          (gen_random_uuid(),'{uuid4()}','practice',1,'Library','completed',CURRENT_DATE);""")
    results = []
    for version in ("v3", "v4"):
        try:
            # Always roll back so both versions see exactly the same seed.
            psql(f"BEGIN; SET ROLE service_role; SELECT * FROM {schema}.fn_create_session_daily_capped_{version}('{uuid4()}','{owner}','practice',1,'Library',CURRENT_DATE,{limit},NULL); ROLLBACK;")
            results.append("accepted")
        except RuntimeError as error:
            assert "daily_quota_exceeded" in str(error)
            results.append("quota")
    assert results == (["accepted"] * 2 if limit == 6 else ["quota"] * 2)
    assert psql(f"SELECT count(*) FROM {schema}.sessions WHERE user_id='{owner}'") == "6"


def test_installed_v3_v4_lock_keys_and_order_match(schema):
    definitions = [psql(f"SELECT pg_get_functiondef('{schema}.fn_create_session_daily_capped_{version}(uuid,uuid,text,integer,text,timestamptz,integer,text)'::regprocedure)") for version in ("v3", "v4")]
    locks = [re.findall(r"PERFORM\s+pg_advisory_xact_lock\(([^;]+)\);", definition) for definition in definitions]
    assert locks[0] == locks[1] == ["hashtext(p_user_id::text)::bigint", "hashtext(p_session_id::text)::bigint"]


def test_browser_roles_cannot_execute_creation_receipt(schema):
    signature = f"{schema}.fn_create_session_daily_capped_v4(uuid,uuid,text,integer,text,timestamptz,integer,text)"
    for role in ("anon", "authenticated"):
        assert psql(f"SELECT has_function_privilege('{role}', '{signature}', 'EXECUTE')") == "f"
    assert psql(f"SELECT has_function_privilege('service_role', '{signature}', 'EXECUTE')") == "t"


def test_repeatable_read_is_rejected_instead_of_claiming_stale_existence(schema):
    with pytest.raises(RuntimeError, match="requires_read_committed"):
        psql(f"""BEGIN ISOLATION LEVEL REPEATABLE READ; SET ROLE service_role;
            SELECT * FROM {schema}.fn_create_session_daily_capped_v4(
                '{uuid4()}','{uuid4()}','practice',1,'Library',CURRENT_DATE,10,NULL); COMMIT;""")


@pytest.mark.parametrize("first_version", ["v2", "v3", "v4"])
def test_concurrent_retry_waits_for_same_lock_and_never_claims_second_create(schema, first_version):
    sid, owner = uuid4(), uuid4()
    query = f"SELECT * FROM {schema}.fn_create_session_daily_capped_{{version}}($1,$2,'practice',1,'Library',CURRENT_DATE,10,NULL)"
    async def run():
        first, second = await asyncpg.connect(DB), await asyncpg.connect(DB)
        waiter = None
        try:
            await first.execute("SET ROLE service_role")
            await second.execute("SET ROLE service_role")
            tx = first.transaction()
            await tx.start()
            first_query = query.format(version=first_version)
            if first_version == "v2":
                first_query = first_query.replace(",10,NULL)", ",10)")
            inserted = await first.fetchrow(first_query, sid, owner)
            if first_version == "v4":
                assert inserted["created"] is True
            await first.execute("RESET ROLE")
            waiter = asyncio.create_task(second.fetchrow(query.format(version="v4"), sid, owner))
            blocked = False
            for _ in range(300):
                await first.execute("SELECT pg_stat_clear_snapshot()")
                blocked = await first.fetchval("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted)", second.get_server_pid())
                if blocked:
                    break
                await asyncio.sleep(0.01)
            assert blocked, "retry did not overlap the uncommitted create"
            await tx.commit()
            return await asyncio.wait_for(waiter, 5)
        finally:
            if waiter is not None and not waiter.done():
                waiter.cancel()
                await asyncio.gather(waiter, return_exceptions=True)
            await first.close()
            await second.close()
    replay = asyncio.run(run())
    assert replay["created"] is False
    assert json.loads(replay["session_data"])["id"] == str(sid)
    assert psql(f"SELECT count(*) FROM {schema}.sessions WHERE id='{sid}'") == "1"


def test_rls_hidden_existing_row_cannot_be_reported_as_a_new_create(schema):
    sid, owner = uuid4(), uuid4()
    call(schema, sid, owner)
    # Temporary grants/policies live only in the transaction that errors and
    # rolls back. No global role changes or production policy assumptions.
    with pytest.raises(RuntimeError, match="row-level security"):
        psql(f"""BEGIN; ALTER TABLE {schema}.sessions ENABLE ROW LEVEL SECURITY;
            GRANT SELECT, INSERT ON {schema}.sessions TO authenticated;
            GRANT EXECUTE ON FUNCTION {schema}.fn_create_session_daily_capped_v4(uuid,uuid,text,integer,text,timestamptz,integer,text) TO authenticated;
            SET ROLE authenticated;
            SELECT * FROM {schema}.fn_create_session_daily_capped_v4('{sid}','{owner}','practice',1,'Library',CURRENT_DATE,10,NULL);
            ROLLBACK;""")
    assert call(schema, sid, owner)["created"] is False


@pytest.mark.parametrize("null_field", ["session", "user"])
def test_missing_identity_is_rejected_without_writing(schema, null_field):
    sid = "NULL" if null_field == "session" else f"'{uuid4()}'"
    owner = "NULL" if null_field == "user" else f"'{uuid4()}'"
    before = psql(f"SELECT count(*) FROM {schema}.sessions")
    with pytest.raises(RuntimeError, match="requires_identity"):
        psql(f"SET ROLE service_role; SELECT * FROM {schema}.fn_create_session_daily_capped_v4({sid},{owner},'practice',1,'Library',CURRENT_DATE,10,NULL)")
    assert psql(f"SELECT count(*) FROM {schema}.sessions") == before


def test_v4_is_additive_and_start_truth_comes_from_insert_returning():
    assert "DROP FUNCTION" not in SQL and "CREATE TRIGGER" not in SQL
    assert "UPDATE public.sessions" not in SQL
    assert "SECURITY DEFINER" not in SQL
    assert "SELECT to_jsonb(inserted), true FROM inserted" in SQL
    assert "RETURN QUERY SELECT to_jsonb(existing), false" in SQL
