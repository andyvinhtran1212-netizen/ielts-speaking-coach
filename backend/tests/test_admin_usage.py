"""
tests/test_admin_usage.py — Sprint 17.2 (Direction B) usage-log endpoints.

GET /admin/usage/users (per-user rollup) + GET /admin/access-codes/{id}/usage
(per-code rollup). Pins: session/cost aggregation, last_active = max, batched
no-N+1, Pattern #29 graceful sub-query failure, per-code excludes inactive
assignments, 404, and the admin guard.
"""

import asyncio

import pytest

from routers import admin as admin_module


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Exec:
    def __init__(self, data):
        self.data = data


class _B:
    """Records each execute() call + applies .eq() filters to canned data so
    is_active/id filters behave. A table value may be a callable to raise."""

    def __init__(self, name, tables, calls):
        self._name, self._t, self._calls, self._eqs = name, tables, calls, []

    def select(self, *a, **k): return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def gte(self, *a, **k): return self
    def lte(self, *a, **k): return self

    def eq(self, col, val):
        self._eqs.append((col, val))
        return self

    def execute(self):
        self._calls.append(self._name)
        data = self._t.get(self._name, [])
        if callable(data):
            data = data()   # may raise → exercises Pattern #29 path
        rows = list(data)
        for col, val in self._eqs:
            rows = [r for r in rows if r.get(col) == val]
        return _Exec(rows)


class _Stub:
    def __init__(self, tables, calls):
        self._t, self._calls = tables, calls

    def table(self, name):
        return _B(name, self._t, self._calls)


def _install(monkeypatch, tables):
    calls: list = []

    async def _ok(_authz):
        return {"id": "admin", "role": "admin"}

    monkeypatch.setattr(admin_module, "require_admin", _ok)
    monkeypatch.setattr(admin_module, "supabase_admin", _Stub(tables, calls))
    return calls


# ── GET /admin/usage/users ──────────────────────────────────────────────────────

def test_usage_by_user_aggregates(monkeypatch):
    _install(monkeypatch, {
        "users": [{"id": "u1", "email": "a@x", "display_name": "A", "role": "student"},
                  {"id": "u2", "email": "b@x", "display_name": "B", "role": "student"}],
        "sessions": [{"user_id": "u1", "started_at": "2026-01-02T00:00:00Z"},
                     {"user_id": "u1", "started_at": "2026-01-05T00:00:00Z"},
                     {"user_id": "u2", "started_at": "2026-01-03T00:00:00Z"}],
        "ai_usage_logs": [{"user_id": "u1", "cost_usd_est": 0.01},
                          {"user_id": "u1", "cost_usd_est": 0.02},
                          {"user_id": "u2", "cost_usd_est": 0.005}],
    })
    out = {u["user_id"]: u for u in _run(admin_module.usage_by_user(authorization="x"))}
    assert out["u1"]["sessions"] == 2 and out["u1"]["ai_cost_usd"] == 0.03
    assert out["u1"]["last_active"] == "2026-01-05T00:00:00Z"   # max
    assert out["u2"]["sessions"] == 1 and out["u2"]["ai_cost_usd"] == 0.005


def test_usage_by_user_no_n_plus_1(monkeypatch):
    calls = _install(monkeypatch, {
        "users": [{"id": "u1"}, {"id": "u2"}, {"id": "u3"}],
        "sessions": [{"user_id": "u1", "started_at": "2026-01-01T00:00:00Z"}],
        "ai_usage_logs": [{"user_id": "u2", "cost_usd_est": 0.1}],
    })
    _run(admin_module.usage_by_user(authorization="x"))
    assert calls.count("sessions") == 1          # ONE batched query for all users
    assert calls.count("ai_usage_logs") == 1


def test_usage_by_user_graceful_on_sessions_failure(monkeypatch):
    def _boom():
        raise RuntimeError("sessions down")
    _install(monkeypatch, {
        "users": [{"id": "u1", "email": "a@x", "display_name": "A"}],
        "sessions": _boom,
        "ai_usage_logs": [{"user_id": "u1", "cost_usd_est": 0.03}],
    })
    out = _run(admin_module.usage_by_user(authorization="x"))
    # sessions degrades to None; cost still computed (Pattern #29).
    assert out[0]["sessions"] is None and out[0]["last_active"] is None
    assert out[0]["ai_cost_usd"] == 0.03


# ── GET /admin/access-codes/{id}/usage ───────────────────────────────────────────

def test_code_usage_rollup_excludes_inactive(monkeypatch):
    _install(monkeypatch, {
        "access_codes": [{"id": "c1", "code": "AAA", "session_limit": 10, "code_type": "mass", "cohort_id": None}],
        "user_code_assignments": [{"code_id": "c1", "user_id": "u1", "is_active": True, "assigned_at": "t"},
                                  {"code_id": "c1", "user_id": "u2", "is_active": False, "assigned_at": "t"}],  # excluded
        "users": [{"id": "u1", "email": "a@x", "display_name": "A"}],
        "sessions": [{"user_id": "u1", "started_at": "2026-01-01T00:00:00Z"},
                     {"user_id": "u1", "started_at": "2026-01-02T00:00:00Z"}],
        "ai_usage_logs": [{"user_id": "u1", "cost_usd_est": 0.04}],
    })
    out = _run(admin_module.code_usage("c1", authorization="x"))
    assert out["aggregate"] == {"assigned_user_count": 1, "total_sessions": 2, "total_ai_cost_usd": 0.04}
    assert [u["user_id"] for u in out["assigned_users"]] == ["u1"]   # inactive u2 excluded


def test_code_usage_404_when_missing(monkeypatch):
    from fastapi import HTTPException
    _install(monkeypatch, {"access_codes": []})
    with pytest.raises(HTTPException) as ei:
        _run(admin_module.code_usage("nope", authorization="x"))
    assert ei.value.status_code == 404


def test_usage_endpoints_admin_guarded(monkeypatch):
    from fastapi import HTTPException

    async def _deny(_authz):
        raise HTTPException(403, "forbidden")
    monkeypatch.setattr(admin_module, "require_admin", _deny)
    monkeypatch.setattr(admin_module, "supabase_admin", _Stub({}, []))
    for call in (admin_module.usage_by_user(authorization="x"),
                 admin_module.code_usage("c1", authorization="x")):
        with pytest.raises(HTTPException) as ei:
            _run(call)
        assert ei.value.status_code == 403
