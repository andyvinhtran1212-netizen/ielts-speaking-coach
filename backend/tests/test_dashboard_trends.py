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


# PC-J70: compute_dashboard_trends buckets rows against the clock it reads at
# call time, so the fixture rows must be stamped from that same clock. A
# module-level `datetime.now()` was read at collection; a CI run that crossed
# 00:00Z between collection and execution put every row in "yesterday"
# (Tests 40790862745). Pin the service clock and stamp rows from the pin.
_NOW = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)


def _freeze_clock(monkeypatch, now):
    class _FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now if tz is None else now.astimezone(tz)

    monkeypatch.setattr(admin_dashboard, "datetime", _FrozenDatetime)


@pytest.fixture
def frozen_now(monkeypatch):
    _freeze_clock(monkeypatch, _NOW)
    return _NOW


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


class _RpcStub(_Stub):
    """_Stub + a name-dispatching rpc() to exercise the daily-bucket RPCs (mig 139)."""
    def __init__(self, results, rpc_map):
        super().__init__(results)
        self._rpc_map = rpc_map

    def rpc(self, name, params=None):
        self.rpc_calls.append(name)
        if name not in self._rpc_map:
            raise AttributeError(f"no rpc {name}")
        return _Chain(self._rpc_map[name])


def _trend_results(ts=None):
    ts = ts or _NOW.isoformat()
    return {
        "analytics_events": _Result(data=[
            {"user_id": "a", "created_at": ts},
            {"user_id": "a", "created_at": ts},
            {"user_id": "b", "created_at": ts},
            {"user_id": None, "created_at": ts},
        ]),
        "sessions": _Result(data=[
            {"completed_at": ts}, {"completed_at": ts},
        ]),
        "ai_usage_logs": _Result(data=[
            {"input_tokens": 100, "output_tokens": 50, "created_at": ts},
            {"input_tokens": 30, "output_tokens": None, "created_at": ts},
        ]),
    }


# ── trends shape + bucketing ─────────────────────────────────────────

def test_trends_shape_and_default_window(monkeypatch, frozen_now):
    monkeypatch.setattr(admin_dashboard, "supabase_admin", _Stub(_trend_results()))
    out = admin_dashboard.compute_dashboard_trends()
    assert out["days"] == 30
    assert set(out["series"].keys()) == {"visitors", "practices", "tokens"}
    # contiguous axis: exactly `days` daily buckets per series
    for key in ("visitors", "practices", "tokens"):
        assert len(out["series"][key]) == 30
        assert all("date" in p and "value" in p for p in out["series"][key])
    assert "computed_at" in out


def test_trends_window_clamps(monkeypatch, frozen_now):
    monkeypatch.setattr(admin_dashboard, "supabase_admin", _Stub(_trend_results()))
    assert admin_dashboard.compute_dashboard_trends(7)["days"] == 7
    assert len(admin_dashboard.compute_dashboard_trends(7)["series"]["visitors"]) == 7
    assert admin_dashboard.compute_dashboard_trends(90)["days"] == 90
    assert admin_dashboard.compute_dashboard_trends(45)["days"] == 30   # out-of-allowlist → default


def test_trends_bucketing(monkeypatch, frozen_now):
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
    # the service read the pinned clock, not the wall clock
    assert out["computed_at"] == frozen_now.isoformat()
    assert vis[-1]["date"] == frozen_now.strftime("%Y-%m-%d")


@pytest.mark.parametrize(
    "now, rows, expected",
    [
        # last instant of 28/10 UTC: all of 28/10 is still "today"
        (
            datetime(2026, 10, 28, 23, 59, 59, 999999, tzinfo=timezone.utc),
            ["2026-10-28T00:00:00+00:00", "2026-10-28T23:59:59.999999+00:00",
             "2026-10-27T23:59:59.999999+00:00"],
            [("2026-10-27", 1), ("2026-10-28", 2)],
        ),
        # first instant of 29/10 UTC: 28/10 has just become "yesterday"
        (
            datetime(2026, 10, 29, 0, 0, 0, tzinfo=timezone.utc),
            ["2026-10-29T00:00:00+00:00", "2026-10-28T23:59:59.999999+00:00",
             "2026-10-28T00:00:00+00:00"],
            [("2026-10-28", 2), ("2026-10-29", 1)],
        ),
    ],
    ids=["just-before-midnight", "just-after-midnight"],
)
def test_trends_bucketing_at_utc_midnight_boundary(monkeypatch, now, rows, expected):
    """PC-J70 regression — on either side of 00:00Z, rows stamped at the
    service's "now" land in the last bucket and a row one microsecond across
    midnight lands in the adjacent one."""
    _freeze_clock(monkeypatch, now)
    results = _trend_results(now.isoformat())
    results["sessions"] = _Result(data=[{"completed_at": ts} for ts in rows])
    monkeypatch.setattr(admin_dashboard, "supabase_admin", _Stub(results))
    out = admin_dashboard.compute_dashboard_trends(7)
    prac = out["series"]["practices"]
    assert [(p["date"], p["value"]) for p in prac[-2:]] == expected
    assert sum(p["value"] for p in prac) == len(rows)
    assert out["series"]["visitors"][-1] == {"date": expected[-1][0], "value": 3}
    assert out["series"]["tokens"][-1] == {"date": expected[-1][0], "value": 180}
    assert out["computed_at"] == now.isoformat()


def test_trends_series_use_daily_rpc_when_available(monkeypatch, frozen_now):
    """mig 139 — the 3 trend series come from daily-bucket RPCs (server-side
    GROUP BY) so a >1000-row window isn't truncated. When present, the capped
    table scans are skipped."""
    today = frozen_now.strftime("%Y-%m-%d")
    rpc_map = {
        "fn_dashboard_daily_visitors":  _Result(data=[{"day": today, "value": 4200}]),
        "fn_dashboard_daily_practices": _Result(data=[{"day": today, "value": 1500}]),
        "fn_dashboard_daily_tokens":    _Result(data=[{"day": today, "value": 7_000_000}]),
    }
    stub = _RpcStub(_trend_results(), rpc_map)
    monkeypatch.setattr(admin_dashboard, "supabase_admin", stub)
    out = admin_dashboard.compute_dashboard_trends(7)
    assert out["series"]["visitors"][-1]["value"] == 4200
    assert out["series"]["practices"][-1]["value"] == 1500
    assert out["series"]["tokens"][-1]["value"] == 7_000_000
    # earlier days zero-filled (contiguous)
    assert out["series"]["visitors"][0]["value"] == 0
    # RPC path skips the capped table scans entirely
    assert stub.table_calls == []


def test_trends_series_failure_is_zero_filled(monkeypatch, frozen_now):
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
        lambda days=30: {
            "days": days,
            "series": {"visitors": [], "practices": [], "tokens": []},
            "computed_at": "2026-09-14T00:00:00+00:00",
        },
    )
    resp = _run(admin_module.dashboard_trends(authorization="x", days=7))
    assert resp.headers.get("Cache-Control") == "max-age=300"
