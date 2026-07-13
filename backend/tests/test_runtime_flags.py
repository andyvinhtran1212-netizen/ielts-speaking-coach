"""Runtime kill-switch flags (ADR-010 / FE migration plan B37).

Pins the mechanism the mutation-pilot checklist depends on:
  * missing row / lookup error -> caller default (fail-open, NOT cached)
  * stored value wins and is cached for the TTL window
  * set_flag invalidates the cache entry (flip visible immediately in-process)
  * require_flag() dependency raises 503 feature_disabled when off
  * admin router validates the key shape
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from services import runtime_flags


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, store, name, fail=False):
        self._store = store
        self._name = name
        self._fail = fail
        self._eq_key = None

    def select(self, *_a, **_k):
        return self

    def eq(self, _col, val):
        self._eq_key = val
        return self

    def limit(self, _n):
        return self

    def order(self, *_a, **_k):
        return self

    def upsert(self, row):
        self._upsert_row = row
        return self

    def execute(self):
        if self._fail:
            raise RuntimeError("boom")
        if hasattr(self, "_upsert_row"):
            self._store[self._upsert_row["key"]] = self._upsert_row
            return _Result([self._upsert_row])
        if self._eq_key is not None:
            row = self._store.get(self._eq_key)
            return _Result([row] if row else [])
        return _Result(list(self._store.values()))


class _FakeSupabase:
    def __init__(self, fail=False):
        self.rows: dict[str, dict] = {}
        self.fail = fail

    def table(self, name):
        return _Query(self.rows, name, fail=self.fail)


@pytest.fixture(autouse=True)
def _clean_cache():
    runtime_flags.clear_cache()
    yield
    runtime_flags.clear_cache()


def test_missing_row_returns_default(monkeypatch):
    monkeypatch.setattr(runtime_flags, "supabase_admin", _FakeSupabase())
    assert runtime_flags.is_enabled("nope") is True
    assert runtime_flags.is_enabled("nope", default=False) is False


def test_stored_value_wins_and_is_cached(monkeypatch):
    fake = _FakeSupabase()
    fake.rows["writing_submit"] = {"key": "writing_submit", "enabled": False}
    monkeypatch.setattr(runtime_flags, "supabase_admin", fake)

    assert runtime_flags.is_enabled("writing_submit") is False
    # Mutate the backing store WITHOUT invalidating: cache must still answer.
    fake.rows["writing_submit"]["enabled"] = True
    assert runtime_flags.is_enabled("writing_submit") is False
    # After invalidation the new value is visible.
    runtime_flags.clear_cache()
    assert runtime_flags.is_enabled("writing_submit") is True


def test_ttl_expiry_refetches(monkeypatch):
    fake = _FakeSupabase()
    fake.rows["k"] = {"key": "k", "enabled": False}
    monkeypatch.setattr(runtime_flags, "supabase_admin", fake)

    t = [1000.0]
    monkeypatch.setattr(runtime_flags.time, "monotonic", lambda: t[0])
    assert runtime_flags.is_enabled("k") is False
    fake.rows["k"]["enabled"] = True
    t[0] += runtime_flags._TTL_SECONDS + 1
    assert runtime_flags.is_enabled("k") is True


def test_lookup_error_returns_default_and_is_not_cached(monkeypatch):
    fake = _FakeSupabase(fail=True)
    monkeypatch.setattr(runtime_flags, "supabase_admin", fake)
    assert runtime_flags.is_enabled("k", default=True) is True

    # Backend recovers -> the very next call must see the real row (no
    # negative caching of errors).
    fake.fail = False
    fake.rows["k"] = {"key": "k", "enabled": False}
    assert runtime_flags.is_enabled("k") is False


def test_set_flag_upserts_and_invalidates(monkeypatch):
    fake = _FakeSupabase()
    fake.rows["k"] = {"key": "k", "enabled": True}
    monkeypatch.setattr(runtime_flags, "supabase_admin", fake)

    assert runtime_flags.is_enabled("k") is True          # primes the cache
    stored = runtime_flags.set_flag("k", False, note="drill", updated_by="u1")
    assert stored["enabled"] is False
    assert runtime_flags.is_enabled("k") is False         # cache was invalidated


def test_require_flag_dependency(monkeypatch):
    fake = _FakeSupabase()
    fake.rows["mut"] = {"key": "mut", "enabled": False}
    monkeypatch.setattr(runtime_flags, "supabase_admin", fake)

    guard = runtime_flags.require_flag("mut")
    with pytest.raises(HTTPException) as exc:
        guard()
    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "feature_disabled"

    fake.rows["mut"]["enabled"] = True
    runtime_flags.clear_cache()
    guard()  # enabled -> no raise


@pytest.mark.asyncio
async def test_admin_router_rejects_bad_key(monkeypatch):
    from routers import admin_flags

    async def _fake_admin(_auth):
        return {"id": "admin-1"}

    monkeypatch.setattr(admin_flags, "require_admin", _fake_admin)
    with pytest.raises(HTTPException) as exc:
        await admin_flags.patch_flag(
            "BAD KEY!", admin_flags.FlagUpdate(enabled=False), authorization="Bearer x",
        )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_admin_router_flips_flag(monkeypatch):
    from routers import admin_flags

    fake = _FakeSupabase()
    monkeypatch.setattr(runtime_flags, "supabase_admin", fake)

    async def _fake_admin(_auth):
        return {"id": "admin-1"}

    monkeypatch.setattr(admin_flags, "require_admin", _fake_admin)
    out = await admin_flags.patch_flag(
        "writing_submit", admin_flags.FlagUpdate(enabled=False, note="drill"),
        authorization="Bearer x",
    )
    assert out["flag"]["enabled"] is False
    assert runtime_flags.is_enabled("writing_submit") is False
