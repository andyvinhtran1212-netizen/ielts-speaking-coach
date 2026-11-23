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


def _admin_route(monkeypatch, db, *, admin=True):
    from routers import admin_flags

    async def _fake_admin(_authorization):
        if not admin:
            raise HTTPException(403, "Admin only")
        return {"id": "admin-1"}

    monkeypatch.setattr(admin_flags, "require_admin", _fake_admin)
    monkeypatch.setattr(admin_flags, "supabase_admin", db)
    return admin_flags


@pytest.mark.parametrize("enabled", (True, False))
def test_admin_sets_flag_and_returns_stored_value(monkeypatch, enabled):
    db = _DB(users={"u-1": {"id": "u-1", "feature_flags": {"vocab_enabled": True,
                                                             "learner_v2": not enabled}}})
    admin_flags = _admin_route(monkeypatch, db)
    out = asyncio.run(admin_flags.admin_set_learner_v2_flag(
        "u-1", admin_flags.LearnerV2FlagPayload(enabled=enabled), authorization="Bearer x"))
    assert out == {"user_id": "u-1", "learner_v2": enabled}
    # Only the learner_v2 key changes; other per-user flags are kept.
    assert db.users["u-1"]["feature_flags"] == {"vocab_enabled": True, "learner_v2": enabled}
    # Read, write, read back.
    assert [(t, w) for t, _k, w in db.calls] == [("users", False), ("users", True), ("users", False)]


def test_admin_flag_answer_comes_from_the_read_back(monkeypatch):
    db = _DB(users={"u-1": {"id": "u-1", "feature_flags": {}}})

    admin_flags = _admin_route(monkeypatch, db)
    original_update = _Q.update

    def _lost_update(self, payload):  # write silently not applied
        self.payload = {}
        return self

    monkeypatch.setattr(_Q, "update", _lost_update)
    out = asyncio.run(admin_flags.admin_set_learner_v2_flag(
        "u-1", admin_flags.LearnerV2FlagPayload(enabled=True), authorization="Bearer x"))
    monkeypatch.setattr(_Q, "update", original_update)
    assert out == {"user_id": "u-1", "learner_v2": False}


def test_admin_flag_rejects_non_admin(monkeypatch):
    db = _DB(users={"u-1": {"id": "u-1", "feature_flags": {}}})
    admin_flags = _admin_route(monkeypatch, db, admin=False)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(admin_flags.admin_set_learner_v2_flag(
            "u-1", admin_flags.LearnerV2FlagPayload(enabled=True), authorization="Bearer x"))
    assert exc.value.status_code == 403
    assert db.calls == []


def test_admin_flag_unknown_user_is_404(monkeypatch):
    admin_flags = _admin_route(monkeypatch, _DB())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(admin_flags.admin_set_learner_v2_flag(
            "nope", admin_flags.LearnerV2FlagPayload(enabled=True), authorization="Bearer x"))
    assert exc.value.status_code == 404


def test_admin_flag_db_error_is_503_without_driver_text(monkeypatch):
    admin_flags = _admin_route(monkeypatch, _DB(fail={"users"}))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(admin_flags.admin_set_learner_v2_flag(
            "u-1", admin_flags.LearnerV2FlagPayload(enabled=True), authorization="Bearer x"))
    assert exc.value.status_code == 503
    assert "db down" not in str(exc.value.detail)
