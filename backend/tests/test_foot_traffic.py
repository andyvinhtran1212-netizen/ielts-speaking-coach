"""
tests/test_foot_traffic.py — Sprint 17.4 (Direction D) foot-traffic.

POST /api/analytics/events user attribution (auth → user_id; anonymous/failed →
NULL, never raises) + GET /admin/analytics/foot-traffic aggregation (total /
unique / anonymous / top pages sorted / daily, batched, graceful, admin-guarded).
"""

import asyncio

import pytest

from routers import analytics as analytics_module
from routers import admin as admin_module


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── POST /api/analytics/events — user attribution ────────────────────────────────

class _InsertStub:
    def __init__(self):
        self.inserted = []

    def table(self, _name): return self
    def insert(self, payload): self.inserted.append(payload); return self
    def execute(self): return type("R", (), {"data": []})()


def _payload():
    return analytics_module.AnalyticsEventPayload(
        event_name="page_view", event_data={"path": "/x"}, session_id="s1"
    )


def test_event_attributes_user_from_token(monkeypatch):
    async def _user(_authz): return {"id": "u1"}
    stub = _InsertStub()
    monkeypatch.setattr(analytics_module, "get_supabase_user", _user)
    monkeypatch.setattr(analytics_module, "supabase_admin", stub)
    out = _run(analytics_module.record_event(_payload(), authorization="Bearer x"))
    assert out == {"ok": True}
    assert stub.inserted[0]["user_id"] == "u1"


def test_event_anonymous_when_no_auth(monkeypatch):
    stub = _InsertStub()
    monkeypatch.setattr(analytics_module, "supabase_admin", stub)
    _run(analytics_module.record_event(_payload(), authorization=None))
    assert stub.inserted[0]["user_id"] is None


def test_event_attribution_never_raises_on_bad_token(monkeypatch):
    async def _boom(_authz): raise RuntimeError("bad token")
    stub = _InsertStub()
    monkeypatch.setattr(analytics_module, "get_supabase_user", _boom)
    monkeypatch.setattr(analytics_module, "supabase_admin", stub)
    out = _run(analytics_module.record_event(_payload(), authorization="Bearer bad"))
    assert out == {"ok": True}                       # tracking never fails the request
    assert stub.inserted[0]["user_id"] is None        # degrades to anonymous


# ── GET /admin/analytics/foot-traffic — aggregation ──────────────────────────────

class _Exec:
    def __init__(self, data): self.data = data


class _Q:
    def __init__(self, rows, calls): self._rows, self._calls = rows, calls
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def gte(self, *a, **k): return self
    def lte(self, *a, **k): return self
    def execute(self):
        self._calls.append("analytics_events")
        return _Exec(list(self._rows))


class _Stub:
    def __init__(self, rows, calls): self._rows, self._calls = rows, calls
    def table(self, _name): return _Q(self._rows, self._calls)


def _install_admin(monkeypatch, rows, calls=None):
    calls = calls if calls is not None else []
    async def _ok(_authz): return {"id": "admin"}
    monkeypatch.setattr(admin_module, "require_admin", _ok)
    monkeypatch.setattr(admin_module, "supabase_admin", _Stub(rows, calls))
    return calls


def test_foot_traffic_aggregates(monkeypatch):
    rows = [
        {"user_id": "u1", "event_data": {"path": "/home"}, "created_at": "2026-05-01T08:00:00Z"},
        {"user_id": "u1", "event_data": {"path": "/home"}, "created_at": "2026-05-01T09:00:00Z"},
        {"user_id": "u2", "event_data": {"path": "/speaking"}, "created_at": "2026-05-02T10:00:00Z"},
        {"user_id": None, "event_data": {"path": "/home"}, "created_at": "2026-05-02T11:00:00Z"},
    ]
    calls = _install_admin(monkeypatch, rows)
    out = _run(admin_module.foot_traffic(authorization="x"))
    assert out["total_views"] == 4
    assert out["unique_visitors"] == 2          # u1, u2
    assert out["anonymous_hits"] == 1
    assert out["top_pages"][0] == {"path": "/home", "views": 3}   # sorted desc
    assert {d["date"]: d["views"] for d in out["daily"]} == {"2026-05-01": 2, "2026-05-02": 2}
    assert calls.count("analytics_events") == 1   # ONE query (no N+1)


def test_foot_traffic_graceful_on_query_failure(monkeypatch):
    class _BoomStub:
        def table(self, _n):
            raise RuntimeError("db down")
    async def _ok(_authz): return {"id": "admin"}
    monkeypatch.setattr(admin_module, "require_admin", _ok)
    monkeypatch.setattr(admin_module, "supabase_admin", _BoomStub())
    out = _run(admin_module.foot_traffic(authorization="x"))
    assert out["total_views"] == 0 and out["top_pages"] == []   # zeroed, not a 500


def test_foot_traffic_admin_guarded(monkeypatch):
    from fastapi import HTTPException
    async def _deny(_authz): raise HTTPException(403, "forbidden")
    monkeypatch.setattr(admin_module, "require_admin", _deny)
    with pytest.raises(HTTPException) as ei:
        _run(admin_module.foot_traffic(authorization="x"))
    assert ei.value.status_code == 403
