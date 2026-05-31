"""tests/test_dashboard_trends.py — admin-dashboard-redesign.

Covers the new daily trends series (compute_dashboard_trends), the
grading_minutes SUM-RPC perf fix (+ graceful fallback), and the
GET /admin/dashboard/trends route (admin guard + Cache-Control).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from services import admin_dashboard
from routers import admin as admin_module


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


_TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%dT12:00:00+00:00")


class _Result:
    def __init__(self, count=None, data=None):
        self.count = count
        self.data = data


class _Chain:
    def __init__(self, result):
        self._result = result

    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def gte(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def is_(self, *a, **k): return self

    def execute(self):
        if isinstance(self._result, Exception):
            raise self._result
        return self._result


class _Stub:
    def __init__(self, results, rpc_result=None):
        self._results = results
        self._rpc_result = rpc_result
        self.table_calls = []
        self.rpc_calls = []

    def table(self, name):
        self.table_calls.append(name)
        return _Chain(self._results[name])

    def rpc(self, name, params=None):
        self.rpc_calls.append(name)
        if self._rpc_result is None:
            raise AttributeError("no rpc configured")
        return _Chain(self._rpc_result)


def _trend_results():
    return {
        "analytics_events": _Result(data=[
            {"user_id": "a", "created_at": _TODAY},
            {"user_id": "a", "created_at": _TODAY},
            {"user_id": "b", "created_at": _TODAY},
            {"user_id": None, "created_at": _TODAY},
        ]),
        "sessions": _Result(data=[
            {"completed_at": _TODAY}, {"completed_at": _TODAY},
        ]),
        "ai_usage_logs": _Result(data=[
            {"input_tokens": 100, "output_tokens": 50, "created_at": _TODAY},
            {"input_tokens": 30, "output_tokens": None, "created_at": _TODAY},
        ]),
    }


# ── trends shape + bucketing ─────────────────────────────────────────

def test_trends_shape_and_default_window(monkeypatch):
    monkeypatch.setattr(admin_dashboard, "supabase_admin", _Stub(_trend_results()))
    out = admin_dashboard.compute_dashboard_trends()
    assert out["days"] == 30
    assert set(out["series"].keys()) == {"visitors", "practices", "tokens"}
    # contiguous axis: exactly `days` daily buckets per series
    for key in ("visitors", "practices", "tokens"):
        assert len(out["series"][key]) == 30
        assert all("date" in p and "value" in p for p in out["series"][key])
    assert "computed_at" in out


def test_trends_window_clamps(monkeypatch):
    monkeypatch.setattr(admin_dashboard, "supabase_admin", _Stub(_trend_results()))
    assert admin_dashboard.compute_dashboard_trends(7)["days"] == 7
    assert len(admin_dashboard.compute_dashboard_trends(7)["series"]["visitors"]) == 7
    assert admin_dashboard.compute_dashboard_trends(90)["days"] == 90
    assert admin_dashboard.compute_dashboard_trends(45)["days"] == 30   # out-of-allowlist → default


def test_trends_bucketing(monkeypatch):
    monkeypatch.setattr(admin_dashboard, "supabase_admin", _Stub(_trend_results()))
    out = admin_dashboard.compute_dashboard_trends(7)
    vis = out["series"]["visitors"]
    prac = out["series"]["practices"]
    tok = out["series"]["tokens"]
    # all today's rows land in the last bucket
    assert vis[-1]["value"] == 3          # viewers-anonymous: 2 distinct auth (a,b) + 1 anon hit
    assert prac[-1]["value"] == 2         # 2 completed sessions
    assert tok[-1]["value"] == 180        # (100+50) + (30+0) tokens
    # earlier buckets are zero-filled (contiguous)
    assert vis[0]["value"] == 0


def test_trends_series_failure_is_zero_filled(monkeypatch):
    results = _trend_results()
    results["analytics_events"] = RuntimeError("events table down")
    monkeypatch.setattr(admin_dashboard, "supabase_admin", _Stub(results))
    out = admin_dashboard.compute_dashboard_trends(7)
    # failed series degrades to a contiguous zero series (never a 500)
    assert len(out["series"]["visitors"]) == 7
    assert all(p["value"] == 0 for p in out["series"]["visitors"])
    # other series still computed
    assert out["series"]["practices"][-1]["value"] == 2


# ── grading_minutes SUM-RPC perf fix ─────────────────────────────────

def test_grading_minutes_uses_rpc_when_available(monkeypatch):
    from tests.test_dashboard_overview import _default_results
    stub = _Stub(_default_results(), rpc_result=_Result(data=123.4))
    monkeypatch.setattr(admin_dashboard, "supabase_admin", stub)
    out = admin_dashboard.compute_dashboard_overview()
    assert out["grading_minutes"] == 123.4
    assert "fn_total_grading_minutes" in stub.rpc_calls
    # the RPC returns a single number — the unbounded responses scan is skipped
    assert "responses" not in stub.table_calls


def test_grading_minutes_falls_back_when_rpc_absent(monkeypatch):
    from tests.test_dashboard_overview import _default_results
    stub = _Stub(_default_results(), rpc_result=None)   # rpc() raises → fallback
    monkeypatch.setattr(admin_dashboard, "supabase_admin", stub)
    out = admin_dashboard.compute_dashboard_overview()
    assert out["grading_minutes"] == 3.0                 # (120+0+60)/60 via fallback
    assert "responses" in stub.table_calls


# ── route guard + cache header ───────────────────────────────────────

def test_trends_route_admin_guard(monkeypatch):
    async def _deny(_authz):
        raise HTTPException(status_code=403, detail="forbidden")
    monkeypatch.setattr(admin_module, "require_admin", _deny)
    with pytest.raises(HTTPException) as exc:
        _run(admin_module.dashboard_trends(authorization=None))
    assert exc.value.status_code == 403


def test_trends_route_sets_cache_header(monkeypatch):
    async def _ok(_authz): return {"id": "admin"}
    monkeypatch.setattr(admin_module, "require_admin", _ok)
    monkeypatch.setattr(
        admin_dashboard, "compute_dashboard_trends",
        lambda days=30: {"days": days, "series": {}, "computed_at": "x"},
    )
    resp = _run(admin_module.dashboard_trends(authorization="x", days=7))
    assert resp.headers.get("Cache-Control") == "max-age=300"
