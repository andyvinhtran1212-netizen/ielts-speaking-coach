"""Real PG17 activation transaction, built without migration 337 or 346.

The test cluster must be disposable and loopback-only (the shared psql helper
enforces this). Reuse the actual 227 membership writers and 326 roster guards.
"""
import asyncio
import json
import os
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest

import test_migration_326_student_archive as m326
import test_migration_331_archived_student_give_guard as m331
from test_migration_240_core_attempt_evidence import DB, psql

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
SQL = (MIGRATIONS / "359_activation_serialize.sql").read_text()
ROLLBACK = (MIGRATIONS / "rollback/359_activation_serialize.sql").read_text()
SIGNATURE = "fn_activation_serialize(uuid,uuid,text,text,jsonb)"


def migrated(sql, schema):
    return sql.replace("public.", schema + ".").replace("pg_catalog, public, pg_temp", f"pg_catalog, {schema}, pg_temp")


@pytest.fixture(scope="module")
def activation_db():
    # A pre-provisioned non-superuser can own this disposable schema. CI's
    # superuser still uses the shared bootstrap for the Supabase test roles.
    try:
        available = psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 359 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") == "t":
        m331._require_pg()
    schema = "activation359_" + uuid4().hex
    try:
        m326._build(schema)
        psql(m326._migrated(schema))
        psql(f"""
            ALTER TABLE {schema}.users ADD COLUMN avatar_url text,
                ADD COLUMN permissions jsonb, ADD COLUMN access_code_used text,
                ADD COLUMN suspended_at timestamptz;
            ALTER TABLE {schema}.cohorts ADD COLUMN is_active boolean DEFAULT true,
                ADD COLUMN created_by uuid;
            ALTER TABLE {schema}.students ADD COLUMN created_by uuid;
            CREATE TABLE {schema}.access_codes (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE,
                cohort_id uuid REFERENCES {schema}.cohorts(id),
                issued_by uuid REFERENCES {schema}.users(id),
                is_used boolean DEFAULT false, used_by uuid, used_at timestamptz,
                is_revoked boolean DEFAULT false, expires_at timestamptz,
                permissions jsonb, grants_role text, intended_email text);
            CREATE TABLE {schema}.user_code_assignments (
                user_id uuid, code_id uuid, assigned_at timestamptz, is_active boolean,
                PRIMARY KEY (user_id, code_id));
        """)
        psql(f"SET search_path = {schema}, pg_temp; "
             + (MIGRATIONS / "099_access_code_audit.sql").read_text())
        psql(migrated(SQL, schema))
        psql(migrated(SQL, schema))
        yield schema
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def seed(schema, *, active=False, instructor=None):
    user, code_id, cohort = (str(uuid4()) for _ in range(3))
    code = "TX359" + code_id[:8].upper()
    psql(f"INSERT INTO {schema}.users (id, is_active, permissions, access_code_used) "
         f"VALUES ('{user}', {str(active).lower()}, '[\"old\"]', 'PREVIOUS'); "
         f"INSERT INTO {schema}.cohorts (id) VALUES ('{cohort}'); "
         f"INSERT INTO {schema}.access_codes (id, code, cohort_id, permissions, issued_by) "
         f"VALUES ('{code_id}', '{code}', '{cohort}', '[\"new\"]', "
         + (f"'{instructor}'" if instructor else "NULL") + ")")
    return user, code_id, code, cohort


def call(schema, user, code_id, code):
    return json.loads(psql(f"SET ROLE service_role; SELECT {schema}.fn_activation_serialize("
                          f"'{user}', '{code_id}', '{code}', 'synthetic@example.test', '{{}}')"))


def state(schema, user, code_id):
    return json.loads(psql(f"SELECT jsonb_build_object("
        f"'user', (SELECT to_jsonb(u) FROM {schema}.users u WHERE id='{user}'),"
        f"'code', (SELECT to_jsonb(c) FROM {schema}.access_codes c WHERE id='{code_id}'),"
        f"'students', (SELECT coalesce(jsonb_agg(s), '[]') FROM {schema}.students s WHERE user_id='{user}'),"
        f"'memberships', (SELECT coalesce(jsonb_agg(m), '[]') FROM {schema}.student_cohort_memberships m "
        f"WHERE student_id IN (SELECT id FROM {schema}.students WHERE user_id='{user}')))"))


def test_acl_search_path_and_safe_reapply(activation_db):
    schema = activation_db
    assert psql(f"SELECT to_regclass('{schema}.access_code_audit') IS NOT NULL") == "t"
    assert psql(f"SELECT prosecdef FROM pg_proc WHERE oid='{schema}.{SIGNATURE}'::regprocedure") == "t"
    config = json.loads(psql(f"SELECT to_json(proconfig) FROM pg_proc WHERE oid='{schema}.{SIGNATURE}'::regprocedure"))
    assert f"search_path=pg_catalog, {schema}, pg_temp" in config
    assert "lock_timeout=3s" in config and "statement_timeout=15s" in config
    for role in ("anon", "authenticated"):
        assert psql(f"SELECT has_function_privilege('{role}', '{schema}.{SIGNATURE}', 'EXECUTE')") == "f"
    assert psql(f"SELECT has_function_privilege('service_role', '{schema}.{SIGNATURE}', 'EXECUTE')") == "t"
    assert psql(f"SELECT count(*) FROM pg_proc p, LATERAL aclexplode(p.proacl) a "
                f"WHERE p.oid='{schema}.{SIGNATURE}'::regprocedure AND a.grantee=0") == "0"


def test_works_without_337_or_346_and_is_idempotent(activation_db):
    schema = activation_db
    user, cid, code, _ = seed(schema)
    assert psql(f"SELECT count(*) FROM information_schema.columns WHERE table_schema='{schema}' "
                "AND table_name='cohorts' AND column_name='archived_at'") == "0"
    result = call(schema, user, cid, code)
    assert result["status"] == "ok"
    before = state(schema, user, cid)
    assert call(schema, user, cid, code)["status"] == "ok"
    assert state(schema, user, cid) == before
    duplicate = call(schema, user, cid, code)
    assert duplicate["student_id"] == before["students"][0]["id"]
    assert duplicate["cohort_id"] == before["code"]["cohort_id"]
    assert duplicate["promote_role"] is None
    assert before["user"]["is_active"] is True
    assert before["user"]["permissions"] == ["new"]
    assert before["user"]["access_code_used"] == code
    assert before["code"]["used_by"] == user and before["code"]["used_at"]
    assert len(before["students"]) == len(before["memberships"]) == 1


@pytest.mark.parametrize("phase", ["enrollment", "claim"])
def test_failure_rolls_back_all_user_student_and_membership_writes(activation_db, phase):
    schema = activation_db
    user, cid, code, _ = seed(schema)
    before = state(schema, user, cid)
    table = "students" if phase == "enrollment" else "access_codes"
    event = "INSERT" if phase == "enrollment" else "UPDATE"
    psql(f"""CREATE FUNCTION {schema}.fail_{phase}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'private marker' USING ERRCODE='23503'; END $$;
        CREATE TRIGGER fail359 BEFORE {event} ON {schema}.{table}
        FOR EACH ROW EXECUTE FUNCTION {schema}.fail_{phase}();""")
    try:
        result = call(schema, user, cid, code)
        assert result == {"status": "activation_error", "phase": phase, "sqlstate": "23503"}
        assert state(schema, user, cid) == before
        assert "private marker" not in json.dumps(result)
    finally:
        psql(f"DROP TRIGGER fail359 ON {schema}.{table}; DROP FUNCTION {schema}.fail_{phase}()")


def test_same_user_serializes_on_real_database_lock(activation_db):
    schema = activation_db
    user, cid, code, _ = seed(schema)

    async def run():
        first, second = await asyncpg.connect(DB), await asyncpg.connect(DB)
        task = None
        try:
            async with first.transaction():
                await first.execute("SELECT pg_advisory_xact_lock(hashtextextended('activate:' || $1, 0))", user)
                query = f"SELECT {schema}.fn_activation_serialize($1,$2,$3,'synthetic@example.test','{{}}')"
                task = asyncio.create_task(second.fetchval(query, user, cid, code))
                for _ in range(100):
                    await first.execute("SELECT pg_stat_clear_snapshot()")
                    if await first.fetchval("SELECT wait_event='advisory' FROM pg_stat_activity WHERE pid=$1", second.get_server_pid()):
                        break
                    await asyncio.sleep(.01)
                else:
                    pytest.fail("activation did not wait on the per-user advisory lock")
                assert state(schema, user, cid)["user"]["is_active"] is False
            assert json.loads(await asyncio.wait_for(task, 5))["status"] == "ok"
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await first.close()
            await second.close()

    asyncio.run(run())
    final = state(schema, user, cid)
    assert final["code"]["used_by"] == user and final["user"]["is_active"] is True


def test_rollback_and_reapply_preserve_activation_data(activation_db):
    schema = activation_db
    user, cid, code, _ = seed(schema)
    assert call(schema, user, cid, code)["status"] == "ok"
    before = state(schema, user, cid)
    psql(migrated(ROLLBACK, schema))
    assert psql(f"SELECT to_regprocedure('{schema}.{SIGNATURE}') IS NULL") == "t"
    assert state(schema, user, cid) == before
    psql(migrated(SQL, schema))
    assert state(schema, user, cid) == before


@pytest.mark.parametrize("first_commits", [False, True])
def test_two_concurrent_same_user_same_code_activations(activation_db, first_commits):
    """Two real RPCs contend; an uncommitted winner is invisible to readers."""
    schema = activation_db
    user, cid, code, _ = seed(schema)
    before = state(schema, user, cid)

    async def run_pair():
        first, second = await asyncpg.connect(DB), await asyncpg.connect(DB)
        task = None
        transaction = first.transaction()
        await transaction.start()
        try:
            query = f"SELECT {schema}.fn_activation_serialize($1,$2,$3,'synthetic@example.test','{{}}')"
            winner = json.loads(await first.fetchval(query, user, cid, code))
            assert winner["status"] == "ok"
            task = asyncio.create_task(second.fetchval(query, user, cid, code))
            for _ in range(100):
                await first.execute("SELECT pg_stat_clear_snapshot()")
                if await first.fetchval("SELECT wait_event='advisory' FROM pg_stat_activity WHERE pid=$1",
                                        second.get_server_pid()):
                    break
                await asyncio.sleep(.01)
            else:
                pytest.fail("second same-code activation did not wait for the first RPC")
            assert state(schema, user, cid) == before
            if first_commits:
                await transaction.commit()
            else:
                await transaction.rollback()
            assert json.loads(await asyncio.wait_for(task, 5))["status"] == "ok"
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            if first.is_in_transaction():
                await transaction.rollback()
            await first.close()
            await second.close()

    asyncio.run(run_pair())
    final = state(schema, user, cid)
    assert final["user"]["is_active"] is True
    assert final["user"]["access_code_used"] == code
    assert final["user"]["permissions"] == ["new"]
    assert final["code"]["is_used"] is True and final["code"]["used_by"] == user
    assert final["code"]["used_at"]
    assert len(final["students"]) == len(final["memberships"]) == 1
    assert final["memberships"][0]["is_active"] is True
    if first_commits:
        assert call(schema, user, cid, code)["status"] == "ok"
        assert state(schema, user, cid) == final


@pytest.mark.parametrize("existing_user", [False, True])
def test_claim_failure_has_no_partial_writes_including_profile_link(activation_db, existing_user):
    schema = activation_db
    user, cid, code, _ = seed(schema, active=existing_user)
    if not existing_user:
        psql(f"DELETE FROM {schema}.users WHERE id='{user}'")
    student = str(uuid4())
    psql(f"INSERT INTO {schema}.students(id,student_code,full_name) "
         f"VALUES ('{student}','{code}','Synthetic bridge')")
    before = state(schema, user, cid)
    bridge_before = psql(f"SELECT to_jsonb(s) FROM {schema}.students s WHERE id='{student}'")
    psql(f"""CREATE FUNCTION {schema}.reject_claim359() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic claim failure' USING ERRCODE='23514'; END $$;
        CREATE TRIGGER reject_claim359 BEFORE UPDATE ON {schema}.access_codes
        FOR EACH ROW EXECUTE FUNCTION {schema}.reject_claim359();""")
    try:
        assert call(schema, user, cid, code) == {
            "status": "activation_error", "phase": "claim", "sqlstate": "23514"}
        assert state(schema, user, cid) == before
        assert psql(f"SELECT to_jsonb(s) FROM {schema}.students s WHERE id='{student}'") == bridge_before
        assert psql(f"SELECT count(*) FROM {schema}.student_cohort_memberships WHERE student_id='{student}'") == "0"
    finally:
        psql(f"DROP TRIGGER reject_claim359 ON {schema}.access_codes; DROP FUNCTION {schema}.reject_claim359()")


def test_archived_cohort_refusal_preserves_account_and_unused_claim(activation_db):
    """Archive metadata alone must refuse before any activation/claim writes."""
    schema = activation_db
    user, cid, code, cohort = seed(schema)
    psql(f"ALTER TABLE {schema}.cohorts ADD COLUMN archived_at timestamptz; "
         f"UPDATE {schema}.cohorts SET is_active=false, archived_at=now() WHERE id='{cohort}'")
    try:
        before = state(schema, user, cid)
        assert call(schema, user, cid, code) == {"status": "cohort_archived"}
        assert state(schema, user, cid) == before
        assert before["code"]["is_used"] is False and before["code"]["used_by"] is None
        assert before["students"] == before["memberships"] == []
    finally:
        psql(f"ALTER TABLE {schema}.cohorts DROP COLUMN archived_at")
