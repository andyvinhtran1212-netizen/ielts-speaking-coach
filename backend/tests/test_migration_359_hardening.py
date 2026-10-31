"""SA F6/F7 regression probes on a disposable, loopback-only PostgreSQL.

Use the existing 359 fixture, including its non-superuser apply/reapply path.
Every overload is schema-local and is removed before another probe runs.
"""
import asyncio
import json

import asyncpg
import pytest

from test_migration_240_core_attempt_evidence import DB, psql
from test_migration_359_activation_serialize import (
    ROLLBACK, SIGNATURE, SQL, activation_db, call, migrated, seed, state,
)


@pytest.mark.parametrize("overload", ["users", "access_codes", "cohorts", "receipt"])
def test_specific_json_overloads_cannot_shadow_rpc(activation_db, overload):
    schema = activation_db
    user, cid, code, _ = seed(schema)
    expected = "ok"
    if overload == "receipt":
        signature = "jsonb_build_object(text,text)"
        payload = '{"shadowed":true}'
        code += "INVALID"
        expected = "invalid_code"
    else:
        signature = f"to_jsonb({schema}.{overload})"
        payload = {
            "users": '{}',
            "access_codes": '{"permissions":["shadowed"]}',
            "cohorts": '{"is_active":false,"archived_at":"2026-01-01"}',
        }[overload]
        if overload == "users":
            psql(f"UPDATE {schema}.users SET suspended_at=now() WHERE id='{user}'")
            expected = "account_suspended"
    before = state(schema, user, cid)
    psql(f"CREATE FUNCTION {schema}.{signature} RETURNS jsonb LANGUAGE sql "
         f"AS $$ SELECT '{payload}'::jsonb $$")
    try:
        # Prove that this overload actually wins an unqualified invocation.
        expression = ("jsonb_build_object('status','invalid_code')" if overload == "receipt"
                      else f"to_jsonb(t) FROM {schema}.{overload} t LIMIT 1")
        assert json.loads(psql(f"SET search_path=pg_catalog,{schema},pg_temp; SELECT {expression}")) == json.loads(payload)
        result = call(schema, user, cid, code)
        assert result["status"] == expected, result
        assert "shadowed" not in json.dumps(result)
        after = state(schema, user, cid)
        if expected == "ok":
            assert after["user"]["permissions"] == ["new"]
            assert after["user"]["is_active"] is True
            assert after["code"]["used_by"] == user
            assert len(after["students"]) == len(after["memberships"]) == 1
        else:
            assert after == before
    finally:
        psql(f"DROP FUNCTION {schema}.{signature}")


@pytest.mark.parametrize("null_parameter", ["user_id", "code_id", "code"])
def test_null_identifiers_return_before_any_lock_or_write(activation_db, null_parameter):
    schema = activation_db
    user, cid, code, _ = seed(schema)
    before = state(schema, user, cid)
    args = dict(user_id=user, code_id=cid, code=code)
    args[null_parameter] = None

    async def probe():
        conn = await asyncpg.connect(DB)
        try:
            async with conn.transaction():
                await conn.execute("SET LOCAL ROLE service_role")
                result = json.loads(await conn.fetchval(
                    f"SELECT {schema}.fn_activation_serialize($1::uuid,$2::uuid,$3,$4,$5::jsonb)",
                    args["user_id"], args["code_id"], args["code"], "synthetic@example.test", "{}"))
                locks = await conn.fetchval("SELECT count(*) FROM pg_locks "
                                            "WHERE pid=pg_backend_pid() AND locktype='advisory'")
                row_locks = await conn.fetchval("SELECT count(*) FROM pg_locks "
                    "WHERE pid=pg_backend_pid() AND locktype='relation' AND relation IN "
                    "(SELECT oid FROM pg_class WHERE relnamespace=$1::regnamespace)", schema)
                assert result == {"status": "invalid_code"}, result
                assert locks == 0, "NULL input acquired an activation advisory lock"
                assert row_locks == 0, "NULL input touched product tables"
                assert state(schema, user, cid) == before
        finally:
            await conn.close()

    asyncio.run(probe())
    assert state(schema, user, cid) == before


def test_catalog_owner_reapply_rollback_and_wrong_owner_refusal(activation_db):
    schema = activation_db
    oid = f"'{schema}.{SIGNATURE}'::regprocedure"
    catalog = (f"SELECT pg_catalog.to_jsonb(p) - 'oid' FROM pg_proc p WHERE oid={oid}")
    owner = psql("SELECT current_user")
    assert psql(f"SELECT proowner=current_user::regrole FROM pg_proc WHERE oid={oid}") == "t"
    first = json.loads(psql(catalog))
    psql(migrated(SQL, schema))
    assert json.loads(psql(catalog)) == first
    psql(migrated(ROLLBACK, schema))
    assert psql(f"SELECT to_regprocedure('{schema}.{SIGNATURE}') IS NULL") == "t"
    psql(migrated(ROLLBACK, schema))
    psql(migrated(SQL, schema))
    assert json.loads(psql(catalog)) == first
    # CREATE OR REPLACE preserves a pre-existing owner. Membership lets this
    # migrating role replace the function, but it must reject the wrong owner.
    psql(f"GRANT CREATE ON SCHEMA {schema} TO service_role; "
         f"ALTER FUNCTION {schema}.{SIGNATURE} OWNER TO service_role")
    try:
        with pytest.raises(RuntimeError, match="activation_serialize_owner_invalid"):
            psql(migrated(SQL, schema))
    finally:
        psql(f'ALTER FUNCTION {schema}.{SIGNATURE} OWNER TO "{owner}"; '
             f"REVOKE CREATE ON SCHEMA {schema} FROM service_role")
        psql(migrated(SQL, schema))
    assert psql(f"SELECT proowner=current_user::regrole FROM pg_proc WHERE oid={oid}") == "t"
