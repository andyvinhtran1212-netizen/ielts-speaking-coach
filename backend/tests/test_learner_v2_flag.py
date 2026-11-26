"""LEARNERCORE-0063 FR-072 / FR-073 / FR-074: the new learner UI flag.

learner_v2_enabled = runtime_flags('learner_v2_all')
                     OR (users.feature_flags.learner_v2 is True
                         AND runtime_flags('learner_v2'))

Both runtime keys default off and deny on a lookup error. /auth/me returns the
field from both the sync and the USE_ASYNC_DB branch; the admin route writes
only users.feature_flags.learner_v2 and answers with the stored value.
"""

from __future__ import annotations

import asyncio
import itertools

import pytest
from sqlalchemy import text
from fastapi import HTTPException

from services import feature_flags, runtime_flags

COMBOS = list(itertools.product((False, True), repeat=3))  # all, per_user, switch


def _expected(all_on: bool, per_user: bool, switch: bool) -> bool:
    return all_on or (per_user and switch)


class _Res:
    def __init__(self, data):
        self.data = data


class _Q:
    """Minimal chain for runtime_flags / users reads and the users update."""

    def __init__(self, db, table):
        self.db, self.table, self.key, self.payload = db, table, None, None

    def select(self, *_a, **_k):
        return self

    def eq(self, _col, val):
        self.key = val
        return self

    def limit(self, _n):
        return self

    def update(self, payload):
        self.payload = payload
        return self

    def execute(self):
        if self.table in self.db.fail:
            raise RuntimeError("db down")
        self.db.calls.append((self.table, self.key, self.payload is not None))
        if self.table == "runtime_flags":
            row = self.db.flags.get(self.key)
            return _Res([] if row is None else [{"enabled": row}])
        if self.table == "users":
            user = self.db.users.get(self.key)
            if self.payload is not None:
                if user is not None:
                    user.update(self.payload)
                return _Res([])
            return _Res([] if user is None else [dict(user)])
        raise AssertionError(self.table)


class _DB:
    def __init__(self, *, flags=None, users=None, fail=()):
        self.flags = dict(flags or {})
        self.users = {k: dict(v) for k, v in (users or {}).items()}
        self.fail = set(fail)
        self.calls: list = []

    def table(self, name):
        return _Q(self, name)


@pytest.fixture(autouse=True)
def _cold_cache():
    runtime_flags.clear_cache()
    yield
    runtime_flags.clear_cache()


def _db_for(monkeypatch, all_on, per_user, switch, *, fail=()):
    db = _DB(
        flags={"learner_v2_all": all_on, "learner_v2": switch},
        users={"u-1": {"id": "u-1", "feature_flags": {"learner_v2": per_user}}},
        fail=fail,
    )
    monkeypatch.setattr(runtime_flags, "supabase_admin", db)
    monkeypatch.setattr(feature_flags, "supabase_admin", db)
    return db


async def _run(build):
    return build(feature_flags.supabase_admin).execute()


# ── feature_flags helpers ─────────────────────────────────────────────────────


@pytest.mark.parametrize("all_on,per_user,switch", COMBOS)
def test_sync_helper_matches_fr072(monkeypatch, all_on, per_user, switch):
    _db_for(monkeypatch, all_on, per_user, switch)
    assert feature_flags.is_learner_v2_enabled("u-1") is _expected(all_on, per_user, switch)


@pytest.mark.parametrize("all_on,per_user,switch", COMBOS)
def test_async_helper_matches_fr072(monkeypatch, all_on, per_user, switch):
    _db_for(monkeypatch, all_on, per_user, switch)
    got = asyncio.run(feature_flags.ais_learner_v2_enabled("u-1", run=_run))
    assert got is _expected(all_on, per_user, switch)


@pytest.mark.parametrize("all_on,per_user,switch", COMBOS)
def test_per_user_value_passed_in_skips_the_users_read(monkeypatch, all_on, per_user, switch):
    db = _db_for(monkeypatch, all_on, not per_user, switch)  # row disagrees on purpose
    assert feature_flags.is_learner_v2_enabled("u-1", per_user=per_user) is _expected(
        all_on, per_user, switch)
    assert not any(t == "users" for t, *_ in db.calls)


def test_missing_runtime_rows_deny(monkeypatch):
    db = _db_for(monkeypatch, False, True, False)
    db.flags = {}
    assert feature_flags.is_learner_v2_enabled("u-1") is False
    assert asyncio.run(feature_flags.ais_learner_v2_enabled("u-1", run=_run)) is False


def test_runtime_lookup_error_denies_even_for_an_opted_in_learner(monkeypatch):
    _db_for(monkeypatch, True, True, True, fail={"runtime_flags"})
    assert feature_flags.is_learner_v2_enabled("u-1") is False
    assert asyncio.run(feature_flags.ais_learner_v2_enabled("u-1", run=_run)) is False


def test_users_lookup_error_denies(monkeypatch):
    _db_for(monkeypatch, False, True, True, fail={"users"})
    assert feature_flags.is_learner_v2_enabled("u-1") is False


def test_truthy_non_boolean_opt_in_is_not_enough(monkeypatch):
    db = _db_for(monkeypatch, False, True, True)
    db.users["u-1"]["feature_flags"] = {"learner_v2": "true"}
    assert feature_flags.is_learner_v2_enabled("u-1") is False


# ── /auth/me, both DB branches ────────────────────────────────────────────────


@pytest.mark.parametrize("use_async", (False, True))
@pytest.mark.parametrize("all_on,per_user,switch", COMBOS)
def test_auth_me_field_in_both_branches(monkeypatch, use_async, all_on, per_user, switch):
    from config import settings
    from routers import auth as auth_module

    db = _db_for(monkeypatch, all_on, per_user, switch)
    monkeypatch.setattr(settings, "USE_ASYNC_DB", use_async)
    if use_async:
        async def _aexecute(build, **_k):
            return build(db).execute()
        monkeypatch.setattr(auth_module, "aexecute", _aexecute)
        got = asyncio.run(feature_flags.ais_learner_v2_enabled(
            "u-1", run=_aexecute, per_user=per_user))
    else:
        got = auth_module._me_sync_learner_v2("u-1", per_user)
    assert got is _expected(all_on, per_user, switch)


def test_auth_me_response_model_defaults_to_false():
    from models.auth import AuthMeResponse

    assert AuthMeResponse.model_fields["learner_v2_enabled"].default is False


# ── POST /admin/users/{user_id}/learner-v2-flag ───────────────────────────────


U1 = "00000000-0000-4000-8000-000000000001"


class _FakeEngine:
    """Applies the route's UPDATE the way Postgres would: jsonb_set on one key."""

    def __init__(self, users=None, fail=False):
        self.users = users or {}
        self.fail = fail
        self.statements = []

    def begin(self):
        engine = self

        class _Conn:
            async def __aenter__(self):
                if engine.fail:
                    raise RuntimeError("db down: password=secret")
                return self

            async def __aexit__(self, *_exc):
                return False

            async def execute(self, statement, params):
                engine.statements.append((str(statement), dict(params)))
                row = engine.users.get(params["user_id"])

                class _Result:
                    def first(self_inner):
                        if row is None:
                            return None
                        flags = dict(row.get("feature_flags") or {})
                        flags["learner_v2"] = params["enabled"]
                        row["feature_flags"] = flags
                        return (flags,)
                return _Result()
        return _Conn()


def _admin_route(monkeypatch, engine, *, admin=True):
    from routers import admin_flags

    async def _fake_admin(_authorization):
        if not admin:
            raise HTTPException(403, "Admin only")
        return {"id": "admin-1"}

    monkeypatch.setattr(admin_flags, "require_admin", _fake_admin)
    monkeypatch.setattr(admin_flags, "_db_engine", engine)

    class _NoPostgrest:
        def table(self, name):
            raise AssertionError(f"the flag route must not read-modify-write via PostgREST ({name})")

    monkeypatch.setattr(admin_flags, "supabase_admin", _NoPostgrest())
    return admin_flags


@pytest.mark.parametrize("enabled", (True, False))
def test_admin_sets_flag_and_returns_stored_value(monkeypatch, enabled):
    engine = _FakeEngine(users={U1: {"feature_flags": {"vocab_enabled": True, "learner_v2": not enabled}}})
    admin_flags = _admin_route(monkeypatch, engine)
    out = asyncio.run(admin_flags.admin_set_learner_v2_flag(
        U1, admin_flags.LearnerV2FlagPayload(enabled=enabled), authorization="Bearer x"))
    assert out == {"user_id": U1, "learner_v2": enabled}
    assert engine.users[U1]["feature_flags"] == {"vocab_enabled": True, "learner_v2": enabled}
    # One statement, no read before the write.
    assert len(engine.statements) == 1
    assert engine.statements[0][1] == {"enabled": enabled, "user_id": U1}


def test_admin_flag_sql_touches_only_the_learner_v2_key():
    from routers import admin_flags

    sql = " ".join(str(admin_flags._SET_LEARNER_V2_SQL).split())
    assert "jsonb_set(COALESCE(feature_flags, '{}'::jsonb), '{learner_v2}'," in sql
    assert "WHERE id = CAST(:user_id AS uuid)" in sql and "RETURNING feature_flags" in sql
    assert sql.count("feature_flags =") == 1


def test_admin_flag_answer_comes_from_the_stored_row(monkeypatch):
    engine = _FakeEngine(users={U1: {"feature_flags": {}}})
    admin_flags = _admin_route(monkeypatch, engine)

    async def _stored_false(_uid, _enabled):  # write lost: the stored row says false
        return {"learner_v2": False}

    monkeypatch.setattr(admin_flags, "_set_learner_v2", _stored_false)
    out = asyncio.run(admin_flags.admin_set_learner_v2_flag(
        U1, admin_flags.LearnerV2FlagPayload(enabled=True), authorization="Bearer x"))
    assert out == {"user_id": U1, "learner_v2": False}


def test_admin_flag_rejects_non_admin(monkeypatch):
    engine = _FakeEngine(users={U1: {"feature_flags": {}}})
    admin_flags = _admin_route(monkeypatch, engine, admin=False)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(admin_flags.admin_set_learner_v2_flag(
            U1, admin_flags.LearnerV2FlagPayload(enabled=True), authorization="Bearer x"))
    assert exc.value.status_code == 403
    assert engine.statements == []


@pytest.mark.parametrize("user_id", ("nope", "00000000-0000-4000-8000-0000000000ff"))
def test_admin_flag_unknown_user_is_404(monkeypatch, user_id):
    admin_flags = _admin_route(monkeypatch, _FakeEngine())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(admin_flags.admin_set_learner_v2_flag(
            user_id, admin_flags.LearnerV2FlagPayload(enabled=True), authorization="Bearer x"))
    assert exc.value.status_code == 404


@pytest.mark.parametrize("engine", (_FakeEngine(fail=True), None))
def test_admin_flag_db_error_is_503_without_driver_text(monkeypatch, engine):
    admin_flags = _admin_route(monkeypatch, engine)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(admin_flags.admin_set_learner_v2_flag(
            U1, admin_flags.LearnerV2FlagPayload(enabled=True), authorization="Bearer x"))
    assert exc.value.status_code == 503
    assert "db down" not in str(exc.value.detail) and "secret" not in str(exc.value.detail)


def test_admin_flag_sql_keeps_a_concurrent_key_on_real_postgres():
    """The UPDATE against a real database (skipped unless one is configured):
    a key written between the admin's page load and the click survives."""
    import os

    url = os.environ.get("LEARNER_V2_FLAG_TEST_DATABASE_URL")
    if not url:
        pytest.skip("LEARNER_V2_FLAG_TEST_DATABASE_URL is not configured")
    from sqlalchemy.ext.asyncio import create_async_engine
    from routers import admin_flags

    async def _run():
        engine = create_async_engine(url)
        try:
            async with engine.begin() as conn:
                await conn.execute(text("CREATE SCHEMA IF NOT EXISTS lv2_test"))
                await conn.execute(text("DROP TABLE IF EXISTS lv2_test.users"))
                await conn.execute(text("CREATE TABLE lv2_test.users (id uuid PRIMARY KEY, feature_flags jsonb)"))
                await conn.execute(text("INSERT INTO lv2_test.users VALUES (CAST(:id AS uuid), NULL)"), {"id": U1})
                # The concurrent writer lands first.
                await conn.execute(text(
                    "UPDATE lv2_test.users SET feature_flags = '{\"vocab_curated_enabled\": true}'"))
            sql = text(str(admin_flags._SET_LEARNER_V2_SQL).replace("public.users", "lv2_test.users"))
            async with engine.begin() as conn:
                row = (await conn.execute(sql, {"enabled": True, "user_id": U1})).first()
                await conn.execute(text("DROP SCHEMA lv2_test CASCADE"))
            return row[0]
        finally:
            await engine.dispose()

    assert asyncio.run(_run()) == {"vocab_curated_enabled": True, "learner_v2": True}
