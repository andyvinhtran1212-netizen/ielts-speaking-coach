"""B1 / review Mục 1 — full-test finalization must not complete a session whose
grading is still incomplete after the grace window.

`_bg_finalize_full_test` used to call `_complete_session_internal` (which
AGGREGATES band scores) for EVERY session once the poll/grace window elapsed —
even when responses were still ungraded. The band was then computed from partial
data and shown to the user as a real score.

Fix: only complete a session that is actually fully graded; mark the rest
`analysis_failed` so the band is NOT aggregated from incomplete data. These
tests pin both branches without waiting on the real 90s+120s timers.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from routers import sessions as sessions_module


_OK = "sess-ok"      # fully graded
_BAD = "sess-bad"    # grading never completes


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Builder:
    def __init__(self, parent, table):
        self._p = parent; self._t = table; self._payload = None; self._eq = []

    def update(self, payload, *_a, **_k):
        self._payload = payload; return self

    def eq(self, col, val):
        self._eq.append((col, val)); return self

    def execute(self):
        if self._t == "sessions" and self._payload is not None:
            self._p.session_updates.append({"payload": self._payload, "eq": list(self._eq)})
        class _R:
            data: Any = []
        return _R()


class _Rec:
    def __init__(self):
        self.session_updates: list[dict] = []

    def table(self, name):
        return _Builder(self, name)


@pytest.fixture
def patched(monkeypatch):
    rec = _Rec()
    completed: list[str] = []

    async def _instant_sleep(*_a, **_k):
        return None

    # readiness: a session is "ready" iff every id in the batch is _OK.
    def _fake_check(ids):
        return all(i == _OK for i in ids)

    def _fake_complete(sid):
        completed.append(sid)

    monkeypatch.setattr(asyncio, "sleep", _instant_sleep)
    monkeypatch.setattr(sessions_module, "_check_all_responses_graded", _fake_check)
    monkeypatch.setattr(sessions_module, "_complete_session_internal", _fake_complete)
    monkeypatch.setattr(sessions_module, "supabase_admin", rec)
    return rec, completed


def _failed_ids(rec):
    return [
        u["eq"][0][1] for u in rec.session_updates
        if u["payload"].get("status") == "analysis_failed"
    ]


def test_incomplete_session_marked_failed_not_completed(patched):
    """Mixed batch: the graded session completes; the ungraded one is marked
    analysis_failed and is NOT passed to band aggregation."""
    rec, completed = patched
    _run(sessions_module._bg_finalize_full_test([_OK, _BAD]))

    assert completed == [_OK], "only the fully-graded session may aggregate a band"
    assert _BAD in _failed_ids(rec), "the ungraded session must be marked analysis_failed"
    assert _OK not in _failed_ids(rec)


def test_all_graded_completes_without_failed(patched):
    """Happy path: everything graded → both complete, nothing marked failed."""
    rec, completed = patched
    _run(sessions_module._bg_finalize_full_test([_OK, _OK]))

    assert completed == [_OK, _OK]
    assert _failed_ids(rec) == [], "no session should be analysis_failed when all graded"
