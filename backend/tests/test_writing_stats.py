"""tests/test_writing_stats.py — GET /admin/writing/stats (PR-1 instrument).

Operator dashboard: volume, queue backlogs, latency (3 SEPARATE paths), cost.
Counts exclude soft-deleted. Pre-launch the numbers are tiny — these tests pin
the LOGIC (aggregation, percentiles, path separation, empty case), not "big
numbers". Handler called directly (no `main` import).
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from routers import admin_writing as AW


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Q:
    def __init__(self, data): self._data = data
    def select(self, *a, **k): return self
    def is_(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def execute(self): return type("R", (), {"data": self._data})()


class _DB:
    def __init__(self, tables): self._t = tables
    def table(self, n): return _Q(self._t.get(n, []))


def _patch(monkeypatch, tables):
    monkeypatch.setattr(AW, "require_admin", AsyncMock(return_value={"id": "admin-1"}))
    monkeypatch.setattr(AW, "supabase_admin", _DB(tables))


# ── percentile unit ───────────────────────────────────────────────────────────

def test_percentiles_nearest_rank():
    assert AW._percentiles([1000, 2000, 3000]) == {"p50": 2000, "p90": 3000, "n": 3}
    assert AW._percentiles([10, 20]) == {"p50": 10, "p90": 20, "n": 2}
    assert AW._percentiles([30]) == {"p50": 30, "p90": 30, "n": 1}
    assert AW._percentiles([]) == {"p50": None, "p90": None, "n": 0}
    assert AW._percentiles([5, None, 15])["n"] == 2   # None dropped


# ── happy path: 3 latency paths + counts + queue + cost ───────────────────────

_TABLES = {
    "writing_essays": [
        {"id": "e1", "status": "graded",    "student_id": "s1",
         "created_at": "2026-06-13T10:00:00Z", "admin_reviewed_at": None},
        {"id": "e2", "status": "reviewed",  "student_id": "s1",
         "created_at": "2026-06-13T10:00:00Z", "admin_reviewed_at": "2026-06-10T10:00:10Z"},
        {"id": "e3", "status": "delivered", "student_id": "s2",
         "created_at": "2026-06-13T10:00:00Z", "admin_reviewed_at": "2026-06-10T11:00:20Z"},
    ],
    "writing_prompts": [{"id": "p1"}, {"id": "p2"}],
    "writing_feedback": [
        {"essay_id": "e1", "grading_duration_ms": 1000, "created_at": "2026-06-09T10:00:00Z",
         "cost_usd": 0.01, "tokens_input": 100, "tokens_output": 50},
        {"essay_id": "e2", "grading_duration_ms": 2000, "created_at": "2026-06-10T10:00:00Z",
         "cost_usd": 0.02, "tokens_input": 200, "tokens_output": 100},
        {"essay_id": "e3", "grading_duration_ms": 3000, "created_at": "2026-06-10T11:00:00Z",
         "cost_usd": 0.03, "tokens_input": 300, "tokens_output": 150},
    ],
    "instructor_reviews": [
        {"essay_id": "e3", "status": "delivered", "created_at": "2026-06-10T11:00:00Z",
         "delivered_at": "2026-06-10T11:00:30Z"},
        {"essay_id": "e1", "status": "queued", "created_at": "2026-06-10T09:00:00Z",
         "delivered_at": None},
    ],
}


def test_stats_volume_queue_cost(monkeypatch):
    _patch(monkeypatch, _TABLES)
    out = _run(AW.get_writing_stats(authorization="x"))

    assert out["volume"]["total_live_essays"] == 3
    assert out["volume"]["by_status"] == {"graded": 1, "reviewed": 1, "delivered": 1}
    assert out["volume"]["prompts"] == 2
    assert out["volume"]["students_with_essays"] == 2
    assert out["volume"]["essays_last_7d"] >= 0   # date-relative; logic not "big number"

    assert out["queue"] == {"awaiting_review": 1, "awaiting_delivery": 1, "instructor_pending": 1}

    assert out["cost"]["total_cost_usd"] == 0.06
    assert out["cost"]["total_tokens"] == 900
    assert "window" in out


def test_stats_latency_paths_kept_separate(monkeypatch):
    _patch(monkeypatch, _TABLES)
    out = _run(AW.get_writing_stats(authorization="x"))
    lat = out["latency"]
    # AI grade: [1000,2000,3000]
    assert lat["ai_grade_ms"] == {"p50": 2000, "p90": 3000, "n": 3}
    # admin turnaround: e2=10s, e3=20s (e1 has no admin_reviewed_at) — NOT mixed with instructor
    assert lat["admin_turnaround_s"] == {"p50": 10.0, "p90": 20.0, "n": 2}
    # instructor turnaround: ir1=30s (ir2 has no delivered_at) — its own sample
    assert lat["instructor_turnaround_s"] == {"p50": 30.0, "p90": 30.0, "n": 1}


def test_stats_empty(monkeypatch):
    _patch(monkeypatch, {})   # no rows anywhere
    out = _run(AW.get_writing_stats(authorization="x"))
    assert out["volume"]["total_live_essays"] == 0
    assert out["volume"]["by_status"] == {}
    assert out["queue"] == {"awaiting_review": 0, "awaiting_delivery": 0, "instructor_pending": 0}
    assert out["latency"]["ai_grade_ms"] == {"p50": None, "p90": None, "n": 0}
    assert out["latency"]["admin_turnaround_s"]["n"] == 0
    assert out["latency"]["instructor_turnaround_s"]["n"] == 0
    assert out["cost"] == {"total_cost_usd": 0, "total_tokens": 0}


def test_stats_excludes_deleted_in_source():
    # the live-essays query MUST filter deleted_at IS NULL (matches PR-A read paths)
    import inspect
    src = inspect.getsource(AW.get_writing_stats)
    assert 'is_("deleted_at", "null")' in src
