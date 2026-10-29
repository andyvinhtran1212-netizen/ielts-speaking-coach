"""PC-J120 — per-IP throttle on POST /api/reading/test/share/{token}/attempts.

The share start is anonymous and every call inserts a reading_test_attempts
row, so one valid token could create rows without bound. Pinned here:
  • 10 starts per minute per client address pass; the 11th is 429 with
    Retry-After and a Vietnamese message, and touches no table or RPC.
  • A different address has its own budget.
  • The key is request_client_ip (X-Real-IP → last XFF hop → peer), so
    rotating caller-supplied XFF hops does not mint a fresh budget.
  • The budget refills once the window has passed.
  • The tracked-address dict is capped (overflow bucket past the cap).
  • The authenticated start route is not throttled.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from config import settings
import routers.reading_student as rs
from test_reading_access_share import _DB, _client, _shared_test

URL = "/api/reading/test/share/TOK/attempts"


class _CountingDB(_DB):
    """_DB that also counts every table/RPC touch."""

    def __init__(self, data):
        super().__init__(data)
        self.touches = 0

    def table(self, name):
        self.touches += 1
        return super().table(name)

    def rpc(self, name, params):
        self.touches += 1
        return super().rpc(name, params)


class _Clock:
    def __init__(self):
        self.now = 1000.0

    def monotonic(self):
        return self.now


@pytest.fixture
def env(monkeypatch):
    clock = _Clock()
    db = _CountingDB({"reading_tests": [_shared_test()], "reading_test_attempts": []})
    monkeypatch.setattr(rs, "_share_start_hits", {})
    monkeypatch.setattr(rs, "time", SimpleNamespace(monotonic=clock.monotonic))
    monkeypatch.setattr(rs, "supabase_admin", db)
    monkeypatch.setattr(settings, "READING_ANON_SALT", "salt-x")
    return SimpleNamespace(clock=clock, db=db, client=_client())


def _inserts(db):
    return [p for (t, p) in db.inserts if t == "reading_test_attempts"]


def _post(env, headers=None):
    return env.client.post(URL, headers=headers or {})


def test_eleventh_start_from_one_address_is_429_before_any_db_touch(env):
    headers = {"X-Real-IP": "198.51.100.7"}
    for _ in range(10):
        assert _post(env, headers).status_code == 200
    assert len(_inserts(env.db)) == 10
    touches = env.db.touches

    env.clock.now += 5
    r = _post(env, headers)

    assert r.status_code == 429
    assert r.headers["Retry-After"] == "56"
    detail = r.json()["detail"]
    assert detail["error"] == "rate_limit_exceeded"
    assert detail["limit"] == 10
    assert detail["retry_after"] == 56
    assert "Vui lòng thử lại" in detail["message"]
    assert env.db.touches == touches            # no read, no write, no RPC
    assert len(_inserts(env.db)) == 10


def test_other_address_keeps_its_own_budget(env):
    for _ in range(10):
        _post(env, {"X-Real-IP": "198.51.100.7"})
    assert _post(env, {"X-Real-IP": "198.51.100.7"}).status_code == 429
    assert _post(env, {"X-Real-IP": "198.51.100.8"}).status_code == 200
    assert len(_inserts(env.db)) == 11


def test_spoofed_forwarded_hops_do_not_mint_new_budgets(env):
    # Behind the real proxy X-Real-IP is set by the edge: rotating the
    # caller-supplied XFF chain must stay in the same bucket.
    for i in range(10):
        r = _post(env, {"X-Real-IP": "198.51.100.30",
                        "X-Forwarded-For": f"10.0.0.{i}, 203.0.113.{i}"})
        assert r.status_code == 200
    assert _post(env, {"X-Real-IP": "198.51.100.30",
                       "X-Forwarded-For": "10.9.9.9"}).status_code == 429

    # Without X-Real-IP the LAST hop is the key; earlier hops are ignored.
    for i in range(10):
        r = _post(env, {"X-Forwarded-For": f"1.1.1.{i}, 203.0.113.99"})
        assert r.status_code == 200
    assert _post(env, {"X-Forwarded-For": "2.2.2.2, 203.0.113.99"}).status_code == 429
    assert len(_inserts(env.db)) == 20


def test_budget_refills_after_the_window(env):
    headers = {"X-Real-IP": "198.51.100.7"}
    for _ in range(10):
        _post(env, headers)
    assert _post(env, headers).status_code == 429
    env.clock.now += 60
    assert _post(env, headers).status_code == 200
    assert len(_inserts(env.db)) == 11


def test_tracked_addresses_are_capped(env, monkeypatch):
    monkeypatch.setattr(rs, "_SHARE_START_MAX_TRACKED", 3)
    for i in range(3):
        assert _post(env, {"X-Real-IP": f"198.51.100.{i}"}).status_code == 200
    # Cap reached with live entries: new addresses share the overflow bucket.
    for i in range(10):
        assert _post(env, {"X-Real-IP": f"203.0.113.{i}"}).status_code == 200
    assert _post(env, {"X-Real-IP": "203.0.113.200"}).status_code == 429
    assert len(rs._share_start_hits) == 4
    assert rs._SHARE_START_OVERFLOW_KEY in rs._share_start_hits

    # Once entries go stale they are swept and a new address gets its own key.
    env.clock.now += 61
    assert _post(env, {"X-Real-IP": "192.0.2.1"}).status_code == 200
    assert set(rs._share_start_hits) == {"192.0.2.1"}


def test_authenticated_start_route_is_not_throttled(env, monkeypatch):
    headers = {"X-Real-IP": "198.51.100.7"}
    for _ in range(10):
        _post(env, headers)
    assert _post(env, headers).status_code == 429

    monkeypatch.setattr(rs, "_require_auth", AsyncMock(return_value={"id": "u-1"}))
    r = env.client.post("/api/reading/test/T1/attempts",
                        headers={**headers, "Authorization": "Bearer x"})
    assert r.status_code != 429

    # Structural: the throttle is called from the anonymous share start only.
    import inspect
    src = inspect.getsource(rs)
    assert src.count("_throttle_share_start(request)") == 1
    share = src[src.index("async def start_shared_reading_test_attempt("):]
    share = share[:share.index("\n@")]
    assert share.index("_throttle_share_start(request)") < share.index("_resolve_share(")
