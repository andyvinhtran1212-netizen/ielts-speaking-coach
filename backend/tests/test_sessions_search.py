"""
Tests for the Phase 2.5 extension of GET /sessions.

The route still uses `supabase_admin` (with explicit `user_id` filter) so
RLS isn't tested here — the cross-user isolation is enforced by the
existing live RLS suite.  These tests pin the new query-building logic +
the dual-shape contract:

  - No new params  → bare list (legacy behaviour).
  - Any new param  → paginated dict.

The stubbed PostgREST builder records every chainable call so we can
assert the right columns / values were filtered + ordered.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from routers import sessions as sessions_module


def _run(coro):
    """Fresh loop per call — TestClient closes the shared one mid-suite."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Recording stub Supabase client ───────────────────────────────────────────


class _RecordingBuilder:
    """Records every chainable call made by the route handler."""

    def __init__(self, recorder, data, count):
        self._rec = recorder
        self._data = data
        self._count = count

    def select(self, *args, **kwargs):
        self._rec["select"] = {"args": args, "kwargs": kwargs}
        return self

    def eq(self, col, val):
        self._rec.setdefault("eq", []).append((col, val))
        return self

    def ilike(self, col, val):
        self._rec.setdefault("ilike", []).append((col, val))
        return self

    def gte(self, col, val):
        self._rec.setdefault("gte", []).append((col, val))
        return self

    def lte(self, col, val):
        self._rec.setdefault("lte", []).append((col, val))
        return self

    def order(self, col, desc=False, nullsfirst=False, **_kw):
        self._rec.setdefault("order", []).append({
            "col": col, "desc": desc, "nullsfirst": nullsfirst,
        })
        return self

    def limit(self, n):
        self._rec["limit"] = n
        return self

    def range(self, start, end):
        self._rec["range"] = (start, end)
        return self

    def execute(self):
        class _R:
            pass
        r = _R()
        r.data = list(self._data) if self._data else []
        r.count = self._count
        return r


class _RecordingClient:
    def __init__(self, data, count, recorder):
        self._data = data
        self._count = count
        self._rec = recorder

    def table(self, _name):
        return _RecordingBuilder(self._rec, self._data, self._count)


def _patch(monkeypatch, *, data=None, count=None):
    rec: dict = {}

    async def _fake_user(_authz):
        return {"id": "user-uuid-test"}

    monkeypatch.setattr(sessions_module, "get_supabase_user", _fake_user)
    monkeypatch.setattr(
        sessions_module,
        "supabase_admin",
        _RecordingClient(data or [], count, rec),
    )
    return rec


def _call(authorization="Bearer x", **overrides):
    """Call list_sessions directly with explicit defaults for every Query
    parameter — calling the handler outside FastAPI bypasses default
    resolution, so we pass plain values here."""
    kwargs = dict(
        authorization=authorization,
        status=None, part=None, limit=20,
        search=None, sort="newest",
        date_from=None, date_to=None,
        page=None, page_size=20,
    )
    kwargs.update(overrides)
    return _run(sessions_module.list_sessions(**kwargs))


# ── Backwards-compatible (legacy) shape ──────────────────────────────────────


def test_legacy_no_params_returns_bare_list(monkeypatch):
    rec = _patch(monkeypatch, data=[{"id": "s1"}, {"id": "s2"}])
    out = _call()
    assert isinstance(out, list)
    assert len(out) == 2
    # No count="exact" — pagination wasn't requested.
    assert rec["select"]["kwargs"] == {}
    # Still sorted by started_at DESC.
    assert rec["order"][0] == {"col": "started_at", "desc": True, "nullsfirst": False}
    # Default limit=20.
    assert rec["limit"] == 20


def test_legacy_status_and_part_filters_still_work(monkeypatch):
    rec = _patch(monkeypatch, data=[])
    _call(status="completed", part=2)
    assert ("status", "completed") in rec["eq"]
    assert ("part", 2) in rec["eq"]


# ── New paginated shape ──────────────────────────────────────────────────────


def test_pagination_returns_dict_when_page_set(monkeypatch):
    rec = _patch(
        monkeypatch,
        data=[{"id": "s%d" % i} for i in range(10)],
        count=42,
    )
    out = _call(page=1)

    assert isinstance(out, dict)
    assert set(out.keys()) == {"sessions", "total", "page", "page_size", "total_pages"}
    assert out["total"] == 42
    assert out["page"] == 1
    assert out["page_size"] == 20
    # 42 / 20 = 3 pages (ceil).
    assert out["total_pages"] == 3
    # count="exact" was requested.
    assert rec["select"]["kwargs"] == {"count": "exact"}
    # Range computed correctly: page 1 → [0..19].
    assert rec["range"] == (0, 19)


def test_pagination_page2_offset(monkeypatch):
    rec = _patch(monkeypatch, data=[], count=42)
    _call(page=2, page_size=10)
    # Page 2, size 10 → range (10, 19).
    assert rec["range"] == (10, 19)


def test_search_uses_ilike_on_topic(monkeypatch):
    rec = _patch(monkeypatch, data=[], count=0)
    out = _call(search="  journey  ")
    assert isinstance(out, dict)  # search alone triggers paginated mode
    # Whitespace is trimmed; substring is wrapped with %.
    assert ("topic", "%journey%") in rec["ilike"]


def test_date_range_uses_started_at(monkeypatch):
    """Filter columns must match the real schema: sessions.started_at, not
    a non-existent created_at."""
    rec = _patch(monkeypatch, data=[], count=0)
    _call(date_from="2026-04-01", date_to="2026-04-30")
    assert ("started_at", "2026-04-01") in rec["gte"]
    assert ("started_at", "2026-04-30") in rec["lte"]


# ── Sort directions ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("sort_value, expected_col, expected_desc", [
    ("newest",     "started_at",  True),
    ("oldest",     "started_at",  False),
    ("score_desc", "overall_band", True),
    ("score_asc",  "overall_band", False),
])
def test_sort_resolves_to_correct_column_and_direction(
    monkeypatch, sort_value, expected_col, expected_desc,
):
    """score_* sorts MUST use sessions.overall_band, not a non-existent
    band_score column."""
    rec = _patch(monkeypatch, data=[], count=0)
    _call(sort=sort_value)
    last = rec["order"][-1]
    assert last["col"] == expected_col
    assert last["desc"] is expected_desc
    assert last["nullsfirst"] is False


def test_sort_non_default_triggers_pagination_shape(monkeypatch):
    """Even without `page=`, a non-default sort opts in to the paginated
    response shape so the UI can render page controls if it wants to."""
    _patch(monkeypatch, data=[], count=0)
    out = _call(sort="score_desc")
    assert isinstance(out, dict)


# ── Total-pages math ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("total, page_size, expected_pages", [
    (0,   20, 0),
    (1,   20, 1),
    (20,  20, 1),
    (21,  20, 2),
    (50,  20, 3),
    (100, 25, 4),
])
def test_total_pages_calculation(monkeypatch, total, page_size, expected_pages):
    _patch(monkeypatch, data=[], count=total)
    out = _call(page=1, page_size=page_size)
    assert out["total_pages"] == expected_pages


# ── Validation ───────────────────────────────────────────────────────────────


def test_invalid_sort_value_via_testclient():
    """Invalid sort is rejected at the FastAPI query-validation layer with 422
    before any DB call is made."""
    from fastapi.testclient import TestClient
    from main import app

    c = TestClient(app)
    r = c.get(
        "/sessions?sort=alphabetic",
        headers={"Authorization": "Bearer fake-jwt-shape-only"},
    )
    assert r.status_code == 422
    assert any(
        "sort" in (err.get("loc") or [])
        for err in r.json().get("detail", [])
    )
