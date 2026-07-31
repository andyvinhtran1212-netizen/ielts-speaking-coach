"""Reading MINI TEST — the list endpoint's 2-way test_type filter.

A mini is a full reading_test flagged test_type='mini'. Mig 158 — test_type
là cột thật (NOT NULL, CHECK full|mini; row legacy NULL đã backfill 'full'),
nên cả 2 nhánh lọc đều là eq trên cột — không còn or_ NULL-fallback:
  - test_type='mini'  → ONLY mini  (eq test_type 'mini')
  - test_type='full' / omitted → ONLY full (eq test_type 'full')

These capture the exact PostgREST filter the endpoint builds (verified live to
behave correctly), so the segregation can't silently regress.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from routers import reading_student as rs


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _RecQ:
    """Records eq()/or_() filter calls; every chain method returns self."""

    def __init__(self, rec):
        self.rec = rec

    def select(self, *a, **k): return self
    def eq(self, col, val): self.rec.append(("eq", col, val)); return self
    def or_(self, f): self.rec.append(("or", f)); return self
    def order(self, *a, **k): return self
    def range(self, *a, **k): return self

    def execute(self):
        class _R:
            data = []
            count = 0
        return _R()


class _RecSB:
    def __init__(self, rec):
        self.rec = rec

    def table(self, _name):
        return _RecQ(self.rec)


def _call(**kwargs):
    # Called directly (not via FastAPI), so pass concrete values for every
    # param — otherwise the Query(default=...) sentinels leak in as the actual
    # arguments (e.g. `module` would be a Query object, tripping its guard).
    params = {"module": None, "test_type": None, "limit": 30, "offset": 0}
    params.update(kwargs)
    rec: list = []
    with patch.object(rs, "supabase_admin", _RecSB(rec)), \
         patch.object(rs, "_require_auth", AsyncMock(return_value={"id": "u"})):
        _run(rs.list_reading_tests(authorization="Bearer x", **params))
    return rec


def test_mini_only_filter():
    rec = _call(test_type="mini")
    assert ("eq", "test_type", "mini") in rec
    assert not any(t[0] == "or" for t in rec)


def test_full_excludes_mini():
    rec = _call(test_type="full")
    assert ("eq", "test_type", "full") in rec
    assert ("eq", "test_type", "mini") not in rec
    assert not any(t[0] == "or" for t in rec)


def test_default_behaves_as_full():
    rec = _call()  # no test_type → Full Tests default
    assert ("eq", "test_type", "full") in rec
    assert ("eq", "test_type", "mini") not in rec


def test_invalid_test_type_rejected():
    with pytest.raises(HTTPException) as ei:
        _call(test_type="bogus")
    assert ei.value.status_code == 422


def test_status_published_always_applied():
    # Regression: the published gate must remain regardless of test_type.
    for kw in ({}, {"test_type": "mini"}, {"test_type": "full"}):
        rec = _call(**kw)
        assert ("eq", "status", "published") in rec
