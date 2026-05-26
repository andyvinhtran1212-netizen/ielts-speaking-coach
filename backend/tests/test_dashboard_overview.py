"""tests/test_dashboard_overview.py — Sprint 18.2 (Direction B).

services.admin_dashboard.compute_dashboard_overview — 6-metric ops overview:
all keys present, visitors window default/param, calendar-month cost boundary,
duration NULL-coalesce, Pattern #29 graceful per-metric failure, fixed query
count (no N+1) + route-level admin guard.
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


# ── Chainable per-table stub ─────────────────────────────────────────

class _Result:
    def __init__(self, count=None, data=None):
        self.count = count
        self.data = data


class _Chain:
    def __init__(self, result):
        self._result = result
        self.gte_args = []
        self.eq_args = []

    def select(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def eq(self, *a, **k): self.eq_args.append(a); return self
    def gte(self, *a, **k): self.gte_args.append(a); return self

    def execute(self):
        if isinstance(self._result, Exception):
            raise self._result
        return self._result


class _Stub:
    """supabase_admin replacement. `results` maps table name → _Result|Exception.
    Chains are created lazily + retained so tests can inspect filter args."""
    def __init__(self, results):
        self._results = results
        self.chains = {}
        self.table_calls = []

    def table(self, name):
        self.table_calls.append(name)
        chain = _Chain(self._results[name])
        self.chains[name] = chain
        return chain


def _default_results():
    return {
        "users": _Result(count=42),
        "user_code_assignments": _Result(count=10),
        "analytics_events": _Result(data=[
            {"user_id": "a"}, {"user_id": "a"}, {"user_id": "b"}, {"user_id": None},
        ]),
        "sessions": _Result(count=7),
        "responses": _Result(data=[
            {"duration_seconds": 120.0}, {"duration_seconds": None}, {"duration_seconds": 60},
        ]),
        "ai_usage_logs": _Result(data=[
            {"cost_usd_est": 0.01}, {"cost_usd_est": None}, {"cost_usd_est": 0.02},
        ]),
    }


def _install(monkeypatch, results=None):
    stub = _Stub(results or _default_results())
    monkeypatch.setattr(admin_dashboard, "supabase_admin", stub)
    return stub


# ── #1 all six metrics present + correct ─────────────────────────────

def test_dashboard_overview_returns_6_metrics(monkeypatch):
    _install(monkeypatch)
    out = admin_dashboard.compute_dashboard_overview()
    assert out["total_users"] == 42
    assert out["active_codes"] == 10
    assert out["distinct_visitors"] == {"count": 2, "window_days": 30}   # a, b (NULL excluded)
    assert out["total_practices"] == 7
    assert out["grading_minutes"] == 3.0                                  # (120+0+60)/60
    assert out["monthly_cost_usd"] == 0.03                                # 0.01 + 0 + 0.02
    assert "computed_at" in out


# ── #2 / #3 visitors window ──────────────────────────────────────────

def test_dashboard_overview_visitors_window_default_30(monkeypatch):
    _install(monkeypatch)
    out = admin_dashboard.compute_dashboard_overview()
    assert out["distinct_visitors"]["window_days"] == 30


def test_dashboard_overview_visitors_window_param(monkeypatch):
    _install(monkeypatch)
    assert admin_dashboard.compute_dashboard_overview(7)["distinct_visitors"]["window_days"] == 7
    assert admin_dashboard.compute_dashboard_overview(90)["distinct_visitors"]["window_days"] == 90
    # Out-of-allowlist value coerces to the default.
    assert admin_dashboard.compute_dashboard_overview(45)["distinct_visitors"]["window_days"] == 30


# ── #4 calendar-month cost boundary ──────────────────────────────────

def test_dashboard_overview_calendar_month_cost(monkeypatch):
    stub = _install(monkeypatch)
    admin_dashboard.compute_dashboard_overview()
    gte = stub.chains["ai_usage_logs"].gte_args
    assert gte, "monthly cost must be windowed by created_at"
    col, value = gte[0]
    assert col == "created_at"
    expected = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    assert value.startswith(expected.strftime("%Y-%m-%dT00:00:00"))


# ── #5 duration NULL-coalesce ────────────────────────────────────────

def test_dashboard_overview_grading_minutes_null_coalesce(monkeypatch):
    results = _default_results()
    results["responses"] = _Result(data=[{"duration_seconds": None}, {"duration_seconds": 90}])
    _install(monkeypatch, results)
    out = admin_dashboard.compute_dashboard_overview()
    assert out["grading_minutes"] == 1.5    # NULL treated as 0 → 90/60


# ── #6 Pattern #29 graceful per-metric failure ───────────────────────

def test_dashboard_overview_graceful_subquery_failure(monkeypatch):
    results = _default_results()
    results["responses"] = RuntimeError("responses table down")
    _install(monkeypatch, results)
    out = admin_dashboard.compute_dashboard_overview()
    assert out["grading_minutes"] is None        # failed metric degrades to None
    assert out["total_users"] == 42              # others still computed
    assert out["monthly_cost_usd"] == 0.03


# ── #7 fixed query count (no N+1) ────────────────────────────────────

def test_dashboard_overview_no_n_plus_1(monkeypatch):
    stub = _install(monkeypatch)
    admin_dashboard.compute_dashboard_overview()
    # Exactly one table() call per metric — independent of row counts.
    assert len(stub.table_calls) == 6
    assert sorted(set(stub.table_calls)) == sorted([
        "users", "user_code_assignments", "analytics_events",
        "sessions", "responses", "ai_usage_logs",
    ])


# ── #8 route-level admin guard ───────────────────────────────────────

def test_dashboard_overview_admin_guard(monkeypatch):
    async def _deny(_authz):
        raise HTTPException(status_code=403, detail="forbidden")
    monkeypatch.setattr(admin_module, "require_admin", _deny)
    with pytest.raises(HTTPException) as exc:
        _run(admin_module.dashboard_overview(authorization=None))
    assert exc.value.status_code == 403


def test_dashboard_route_passes_window_through(monkeypatch):
    async def _ok(_authz): return {"id": "admin"}
    monkeypatch.setattr(admin_module, "require_admin", _ok)
    captured = {}
    def _compute(*, visitors_window_days):
        captured["w"] = visitors_window_days
        return {"ok": True}
    monkeypatch.setattr(admin_dashboard, "compute_dashboard_overview", _compute)
    out = _run(admin_module.dashboard_overview(authorization="x", visitors_window=7))
    assert captured["w"] == 7 and out == {"ok": True}
