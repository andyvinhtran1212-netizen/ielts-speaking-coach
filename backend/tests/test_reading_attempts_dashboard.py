"""tests/test_reading_attempts_dashboard.py — reading-access-tracking Part C.

services.admin_reading_dashboard.compute_reading_attempts_dashboard +
routers.admin.dashboard_reading_attempts. Pins:
  • auth-vs-anonymous split + distinct counts (auth exact, anon approximate),
  • band distribution, skill performance (weakest first), time stats,
  • per-test usage, recent attempts (who/test/band/time),
  • PRIVACY: the salted anon_src hash is NEVER present in the response,
  • window clamp (7/30/90), truncation flag, Pattern #29 graceful degradation,
  • route-level admin guard.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from fastapi import HTTPException

from services import admin_reading_dashboard as svc
from routers import admin as admin_module


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Queue-based supabase stub (same table called multiple times) ──────

class _Result:
    def __init__(self, count=None, data=None):
        self.count = count
        self.data = data


class _Chain:
    def __init__(self, result):
        self._result = result

    def select(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def gte(self, *a, **k): return self
    def order(self, *a, **k): return self
    def in_(self, *a, **k): return self

    def execute(self):
        if isinstance(self._result, Exception):
            raise self._result
        return self._result


class _Stub:
    """`queues` maps table → [result, result, …] returned in call order."""
    def __init__(self, queues):
        self._queues = {k: list(v) for k, v in queues.items()}
        self.table_calls = []

    def table(self, name):
        self.table_calls.append(name)
        q = self._queues.get(name) or []
        res = q.pop(0) if q else _Result(count=0, data=[])
        return _Chain(res)


# H1/H2 are salted anon_src hashes — MUST never appear in the response.
_ANON_SRC_A = "deadbeefcafe0001"
_ANON_SRC_B = "deadbeefcafe0002"

_SK = {"detail": {"correct": 3, "total": 5}, "inference": {"correct": 1, "total": 4}}


def _rows():
    return [
        # 2 attempts from U1, 1 from U2 → 3 auth, 2 distinct users
        {"id": "a1", "test_id": "t1", "user_id": "U1", "anon_src": None,
         "score": 30, "band_estimate": 7.0, "skill_breakdown": _SK,
         "time_spent_seconds": 1800, "submitted_at": "2026-05-30T10:00:00+00:00"},
        {"id": "a2", "test_id": "t1", "user_id": "U1", "anon_src": None,
         "score": 24, "band_estimate": 6.0, "skill_breakdown": _SK,
         "time_spent_seconds": 2400, "submitted_at": "2026-05-29T10:00:00+00:00"},
        {"id": "a3", "test_id": "t2", "user_id": "U2", "anon_src": None,
         "score": 26, "band_estimate": 6.5, "skill_breakdown": {"detail": {"correct": 2, "total": 5}},
         "time_spent_seconds": 0, "submitted_at": "2026-05-28T10:00:00+00:00"},
        # 2 anon attempts from src A, 1 from src B → 3 anon, 2 distinct sources
        {"id": "a4", "test_id": "t1", "user_id": None, "anon_src": _ANON_SRC_A,
         "score": 20, "band_estimate": 5.5, "skill_breakdown": {"inference": {"correct": 0, "total": 4}},
         "time_spent_seconds": 3000, "submitted_at": "2026-05-27T10:00:00+00:00"},
        {"id": "a5", "test_id": "t1", "user_id": None, "anon_src": _ANON_SRC_A,
         "score": 28, "band_estimate": 6.5, "skill_breakdown": {},
         "time_spent_seconds": 1500, "submitted_at": "2026-05-26T10:00:00+00:00"},
        {"id": "a6", "test_id": "t2", "user_id": None, "anon_src": _ANON_SRC_B,
         "score": 32, "band_estimate": 7.5, "skill_breakdown": {"detail": {"correct": 4, "total": 5}},
         "time_spent_seconds": 2100, "submitted_at": "2026-05-25T10:00:00+00:00"},
    ]


def _queues(window_count=6):
    return {
        "reading_test_attempts": [
            _Result(count=42),               # all-time submitted
            _Result(count=window_count),     # window count
            _Result(data=_rows()),           # rows
        ],
        "reading_tests": [
            _Result(data=[{"id": "t1", "test_id": "T1", "title": "Test One"},
                          {"id": "t2", "test_id": "T2", "title": "Test Two"}]),
        ],
        "users": [_Result(data=[{"id": "U1", "email": "u1@x"}, {"id": "U2", "email": "u2@x"}])],
    }


def _patch(monkeypatch, queues):
    monkeypatch.setattr(svc, "supabase_admin", _Stub(queues))


# ── Aggregation correctness ───────────────────────────────────────────

def test_auth_vs_anon_split_and_distinct_counts(monkeypatch):
    _patch(monkeypatch, _queues())
    out = svc.compute_reading_attempts_dashboard(30)
    t = out["totals"]
    assert out["ok"] is True
    assert t["submitted_all_time"] == 42
    assert t["submitted_window"] == 6
    assert t["auth_attempts"] == 3 and t["anon_attempts"] == 3
    assert t["auth_distinct_users"] == 2          # U1, U2 (exact)
    assert t["anon_distinct_sources"] == 2        # src A, src B (approximate)
    assert t["truncated"] is False


def test_skill_performance_aggregates_weakest_first(monkeypatch):
    _patch(monkeypatch, _queues())
    out = svc.compute_reading_attempts_dashboard(30)
    skills = {s["skill_tag"]: s for s in out["skill_performance"]}
    # detail: 3+3+2+4 correct / 5+5+5+5 total = 12/20
    assert skills["detail"]["correct"] == 12 and skills["detail"]["total"] == 20
    assert skills["detail"]["accuracy"] == 0.6
    # inference: 1+1+0 correct / 4+4+4 total = 2/12
    assert skills["inference"]["correct"] == 2 and skills["inference"]["total"] == 12
    # weakest (lowest accuracy) sorts first
    assert out["skill_performance"][0]["skill_tag"] == "inference"


def test_band_distribution_and_time_stats(monkeypatch):
    _patch(monkeypatch, _queues())
    out = svc.compute_reading_attempts_dashboard(30)
    dist = {d["band"]: d["count"] for d in out["band_distribution"]}
    assert dist == {5.5: 1, 6.0: 1, 6.5: 2, 7.0: 1, 7.5: 1}
    # sorted ascending by band
    assert [d["band"] for d in out["band_distribution"]] == sorted(dist)
    # time: only the 5 rows with seconds>0 count (a3 has 0)
    assert out["time_stats"]["count"] == 5


def test_per_test_usage_grouped_and_sorted(monkeypatch):
    _patch(monkeypatch, _queues())
    out = svc.compute_reading_attempts_dashboard(30)
    by_id = {p["test_id"]: p for p in out["per_test"]}
    assert by_id["t1"]["attempts"] == 4 and by_id["t1"]["auth"] == 2 and by_id["t1"]["anon"] == 2
    assert by_id["t1"]["title"] == "Test One"
    assert by_id["t2"]["attempts"] == 2
    # sorted by attempts desc → t1 first
    assert out["per_test"][0]["test_id"] == "t1"


def test_recent_attempts_who_and_anonymity(monkeypatch):
    _patch(monkeypatch, _queues())
    out = svc.compute_reading_attempts_dashboard(30)
    recent = out["recent"]
    assert len(recent) == 6
    auth_row = next(r for r in recent if not r["is_anonymous"])
    anon_row = next(r for r in recent if r["is_anonymous"])
    assert auth_row["who"] in ("u1@x", "u2@x")
    assert anon_row["who"] == "Ẩn danh"


def test_privacy_anon_src_hash_never_in_response(monkeypatch):
    _patch(monkeypatch, _queues())
    out = svc.compute_reading_attempts_dashboard(30)
    blob = json.dumps(out, ensure_ascii=False)
    assert _ANON_SRC_A not in blob and _ANON_SRC_B not in blob, \
        "salted anon_src hash must NEVER be surfaced to the client"


# ── Window clamp / truncation / degradation ───────────────────────────

def test_window_clamps_to_allowed_values(monkeypatch):
    _patch(monkeypatch, _queues()); assert svc.compute_reading_attempts_dashboard(7)["window_days"] == 7
    _patch(monkeypatch, _queues()); assert svc.compute_reading_attempts_dashboard(90)["window_days"] == 90
    _patch(monkeypatch, _queues()); assert svc.compute_reading_attempts_dashboard(45)["window_days"] == 30


def test_truncation_flag_when_window_count_exceeds_fetched(monkeypatch):
    _patch(monkeypatch, _queues(window_count=9999))   # 9999 > 6 fetched rows
    out = svc.compute_reading_attempts_dashboard(30)
    assert out["totals"]["truncated"] is True


def test_graceful_degradation_on_query_outage(monkeypatch):
    queues = _queues()
    queues["reading_test_attempts"] = [RuntimeError("db down")]   # first call raises
    _patch(monkeypatch, queues)
    out = svc.compute_reading_attempts_dashboard(30)
    assert out["ok"] is False
    assert out["totals"]["submitted_all_time"] is None
    assert out["band_distribution"] == [] and out["recent"] == []


# ── Route-level admin guard ────────────────────────────────────────────

def test_route_requires_admin(monkeypatch):
    def _deny(_auth):
        raise HTTPException(status_code=403, detail="forbidden")
    monkeypatch.setattr(admin_module, "require_admin", _deny)
    with pytest.raises(HTTPException) as exc:
        _run(admin_module.dashboard_reading_attempts(authorization=None))
    assert exc.value.status_code == 403


def test_route_returns_payload_with_cache_header_for_admin(monkeypatch):
    async def _ok(_auth):
        return {"id": "admin", "role": "admin"}
    monkeypatch.setattr(admin_module, "require_admin", _ok)
    monkeypatch.setattr(
        admin_module.admin_reading_dashboard, "compute_reading_attempts_dashboard",
        lambda days=30: {"ok": True, "window_days": days, "marker": "X"})
    resp = _run(admin_module.dashboard_reading_attempts(authorization="x", days=7))
    assert resp.headers.get("Cache-Control") == "max-age=300"
    assert json.loads(bytes(resp.body)) == {"ok": True, "window_days": 7, "marker": "X"}
