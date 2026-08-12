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
        self._name, self._t, self._calls, self._eqs, self._ins = name, tables, calls, [], []
        self._start, self._end = None, None

    def select(self, *a, **k): return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def in_(self, col, values):
        self._ins.append((col, set(values)))
        return self
    def gte(self, *a, **k): return self
    def lte(self, *a, **k): return self

    def range(self, start, end):
        self._start, self._end = start, end
        return self

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
        for col, values in self._ins:
            rows = [r for r in rows if r.get(col) in values]
        if self._start is not None:
            rows = rows[self._start:self._end + 1]
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


def test_usage_by_user_pages_past_postgrest_cap(monkeypatch):
    users = [{"id": f"u{i}", "email": f"u{i}@x"} for i in range(1001)]
    calls = _install(monkeypatch, {
        "users": users,
        "sessions": [],
        "ai_usage_logs": [],
    })
    out = _run(admin_module.usage_by_user(authorization="x"))
    assert len(out) == 1001
    assert calls.count("users") == 2


def test_usage_by_user_pages_session_and_cost_sources_past_cap(monkeypatch):
    sessions = [
        {"id": f"s{i:04}", "user_id": "u1", "started_at": f"2026-01-{(i % 28) + 1:02}T00:00:00Z"}
        for i in range(1001)
    ]
    costs = [
        {"id": f"a{i:04}", "user_id": "u1", "cost_usd_est": 0.0001}
        for i in range(1001)
    ]
    calls = _install(monkeypatch, {
        "users": [{"id": "u1", "email": "a@x"}],
        "sessions": sessions,
        "ai_usage_logs": costs,
    })
    out = _run(admin_module.usage_by_user(authorization="x"))
    assert out[0]["sessions"] == 1001
    assert out[0]["last_active"] == "2026-01-28T00:00:00Z"
    assert out[0]["ai_cost_usd"] == 0.1001
    assert calls.count("sessions") == 2
    assert calls.count("ai_usage_logs") == 2


def test_usage_by_user_merges_multiple_user_id_chunks(monkeypatch):
    users = [{"id": f"u{i:03}", "email": f"u{i:03}@x"} for i in range(250)]
    calls = _install(monkeypatch, {
        "users": users,
        "sessions": [
            {"id": f"s{i:03}", "user_id": user["id"], "started_at": "2026-01-01T00:00:00Z"}
            for i, user in enumerate(users)
        ],
        "ai_usage_logs": [
            {"id": f"a{i:03}", "user_id": user["id"], "cost_usd_est": 0.001}
            for i, user in enumerate(users)
        ],
    })
    out = {row["user_id"]: row for row in _run(admin_module.usage_by_user(authorization="x"))}
    assert len(out) == 250
    assert out["u000"]["sessions"] == 1 and out["u000"]["ai_cost_usd"] == 0.001
    assert out["u249"]["sessions"] == 1 and out["u249"]["ai_cost_usd"] == 0.001
    assert calls.count("sessions") == 2
    assert calls.count("ai_usage_logs") == 2


def test_usage_by_user_graceful_on_sessions_failure(monkeypatch):
    def _boom():
        raise RuntimeError("sessions down")
    _install(monkeypatch, {
        "users": [{"id": "u1", "email": "a@x", "display_name": "A", "role": "student"}],
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
        "users": [{"id": "u1", "email": "a@x", "display_name": "A", "role": "student"}],
        "sessions": [{"user_id": "u1", "started_at": "2026-01-01T00:00:00Z"},
                     {"user_id": "u1", "started_at": "2026-01-02T00:00:00Z"}],
        "ai_usage_logs": [{"user_id": "u1", "cost_usd_est": 0.04}],
    })
    out = _run(admin_module.code_usage("c1", authorization="x"))
    assert out["aggregate"] == {"assigned_user_count": 1, "total_sessions": 2, "total_ai_cost_usd": 0.04}
    assert [u["user_id"] for u in out["assigned_users"]] == ["u1"]   # inactive u2 excluded
    assert out["assigned_users"][0]["role"] == "student"


def test_code_usage_preserves_degraded_aggregate_as_unknown(monkeypatch):
    def _boom():
        raise RuntimeError("sessions down")
    _install(monkeypatch, {
        "access_codes": [{"id": "c1", "code": "AAA"}],
        "user_code_assignments": [{"id": "a1", "code_id": "c1", "user_id": "u1", "is_active": True}],
        "users": [{"id": "u1", "email": "a@x"}],
        "sessions": _boom,
        "ai_usage_logs": [{"user_id": "u1", "cost_usd_est": 0.04}],
    })
    out = _run(admin_module.code_usage("c1", authorization="x"))
    assert out["assigned_users"][0]["sessions"] is None
    assert out["aggregate"]["total_sessions"] is None
    assert out["aggregate"]["total_ai_cost_usd"] == 0.04


def test_code_usage_merges_assignment_and_user_id_chunks(monkeypatch):
    users = [
        {"id": f"u{i:03}", "email": f"u{i:03}@x", "role": "student"}
        for i in range(201)
    ]
    calls = _install(monkeypatch, {
        "access_codes": [{"id": "c1", "code": "AAA"}],
        "user_code_assignments": [
            {"id": f"a{i:03}", "code_id": "c1", "user_id": user["id"], "is_active": True}
            for i, user in enumerate(users)
        ],
        "users": users,
        "sessions": [
            {"id": f"s{i:03}", "user_id": user["id"], "started_at": "2026-01-01T00:00:00Z"}
            for i, user in enumerate(users)
        ],
        "ai_usage_logs": [
            {"id": f"l{i:03}", "user_id": user["id"], "cost_usd_est": 0.001}
            for i, user in enumerate(users)
        ],
    })
    out = _run(admin_module.code_usage("c1", authorization="x"))
    assert out["aggregate"] == {
        "assigned_user_count": 201,
        "total_sessions": 201,
        "total_ai_cost_usd": 0.201,
    }
    assert len(out["assigned_users"]) == 201
    assert calls.count("users") == 2
    assert calls.count("sessions") == 2
    assert calls.count("ai_usage_logs") == 2


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
