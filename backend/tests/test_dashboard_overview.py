"""tests/test_dashboard_overview.py — Sprint 18.2 (Direction B).

services.admin_dashboard.compute_dashboard_overview — 6-metric ops overview:
all keys present, visitors window default/param, calendar-month cost boundary,
duration NULL-coalesce, Pattern #29 graceful per-metric failure, fixed query
count (no N+1) + route-level admin guard.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

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
    def is_(self, *a, **k): return self   # attention counts filter delivered_at/dismissed_at IS NULL

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
        # dashboard-counter-audit: "Mã đã kích hoạt" now counts activated
        # access_codes (is_used=true), not active user_code_assignments.
        "access_codes": _Result(count=10),
        "analytics_events": _Result(data=[
            {"user_id": "a"}, {"user_id": "a"}, {"user_id": "b"}, {"user_id": None},
        ]),
        "sessions": _Result(count=7),
        "responses": _Result(data=[
            {"duration_seconds": 120.0}, {"duration_seconds": None}, {"duration_seconds": 60},
        ]),
        "ai_usage_logs": _Result(data=[
            {"input_tokens": 100, "output_tokens": 50},
            {"input_tokens": None, "output_tokens": 20},   # NULL coalesces to 0
            {"input_tokens": 30, "output_tokens": None},
        ]),
        # admin-dashboard-redesign — "Cần chú ý" cheap COUNT metrics.
        "error_logs": _Result(count=3),
        "writing_essays": _Result(count=5),
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
    # viewers-anonymous: total = 2 distinct auth (a,b) + 1 anonymous hit (NULL user_id).
    assert out["distinct_visitors"] == {
        "count": 3, "authenticated": 2, "anonymous": 1, "window_days": 30,
    }
    assert out["total_practices"] == 7
    assert out["grading_minutes"] == 3.0                                  # (120+0+60)/60
    # dashboard-tweaks — tokens called (prompt+completion), windowed; NULL→0.
    assert out["tokens_called"] == {"count": 200, "window_days": 30}        # (100+50)+(0+20)+(30+0)
    # admin-dashboard-redesign — "Cần chú ý" counts (cheap COUNT(exact)).
    assert out["attention"] == {"errors_undismissed": 3, "writing_pending": 5}
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


# ── #4 tokens windowed by the SELECTOR (dashboard-tweaks; was calendar-month) ──

def test_dashboard_overview_tokens_windowed_by_selector(monkeypatch):
    stub = _install(monkeypatch)
    admin_dashboard.compute_dashboard_overview(7)
    gte = stub.chains["ai_usage_logs"].gte_args
    assert gte, "tokens must be windowed by created_at"
    col, value = gte[0]
    assert col == "created_at"
    # Windowed by the 7-day selector (NOT the calendar month).
    expected = datetime.now(timezone.utc) - timedelta(days=7)
    assert value.startswith(expected.strftime("%Y-%m-%dT"))


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
    assert out["tokens_called"]["count"] == 200


# ── #7 fixed query count (no N+1) ────────────────────────────────────

def test_dashboard_overview_no_n_plus_1(monkeypatch):
    stub = _install(monkeypatch)
    admin_dashboard.compute_dashboard_overview()
    # One table() call per metric — independent of row counts. 6 core metrics
    # + 2 "Cần chú ý" COUNT metrics (admin-dashboard-redesign). grading_minutes
    # tries the SUM RPC first and falls back to a responses scan here (the stub
    # has no .rpc), so `responses` is still counted exactly once.
    assert len(stub.table_calls) == 8
    assert sorted(set(stub.table_calls)) == sorted([
        "users", "access_codes", "analytics_events",
        "sessions", "responses", "ai_usage_logs",
        "error_logs", "writing_essays",
    ])


# ── dashboard-counter-audit: activated-codes counts access_codes.is_used ──

def test_active_codes_counts_activated_access_codes_not_assignments(monkeypatch):
    """Regression: "Mã đã kích hoạt" must count ACTIVATED access_codes
    (is_used=true) — the canonical activated set, matching the admin codes page
    (44) — NOT active user_code_assignments, which drops codes reassigned /
    removed / revoked into inactive rows (the 23-vs-44 undercount bug)."""
    stub = _install(monkeypatch)
    admin_dashboard.compute_dashboard_overview()
    assert "access_codes" in stub.table_calls
    assert "user_code_assignments" not in stub.table_calls, (
        "must not count active assignments — that misses legacy/removed/revoked "
        "activated codes (23 vs 44)"
    )
    assert ("is_used", True) in stub.chains["access_codes"].eq_args


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
