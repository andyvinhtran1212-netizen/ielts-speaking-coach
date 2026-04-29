"""
Tests for GET /api/vocabulary/bank/recent-updates.

Pattern mirrors test_vocab_export: stub the user-scoped Supabase client and
the auth dependency so we can drive the handler offline.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from routers import vocabulary_bank as vb


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Stub Supabase client with the chain we use in the handler ────────────────


class _StubBuilder:
    def __init__(self, data):
        self._data = data

    def select(self, *_a, **_k): return self
    def eq(self, *_a, **_k):     return self
    def order(self, *_a, **_k):  return self
    def limit(self, n):
        # Simulate the upstream paging cap so we don't pretend the DB returned
        # more rows than asked for.
        self._data = self._data[:n]
        return self

    def execute(self):
        class _R:
            pass
        r = _R()
        r.data = list(self._data) if self._data else []
        return r


class _StubClient:
    def __init__(self, data):
        self._data = data
    def table(self, *_a, **_k):
        return _StubBuilder(self._data)


def _patch(monkeypatch, rows, *, flag_enabled: bool = True):
    async def _fake_auth(_authz):
        return {"id": "user-uuid-recent"}
    monkeypatch.setattr(vb, "_require_auth", _fake_auth)
    monkeypatch.setattr(vb, "_vocab_bank_enabled", lambda _uid: flag_enabled)
    monkeypatch.setattr(vb, "_user_sb", lambda _token: _StubClient(rows))
    monkeypatch.setattr(vb, "_fire_event", lambda *_a, **_k: None)
    return "Bearer fake-jwt"


# ── Fixtures ─────────────────────────────────────────────────────────────────


def _row(headword, session_id, ts, source_type="used_well"):
    return {
        "id": f"v-{headword}",
        "headword": headword,
        "source_type": source_type,
        "session_id": session_id,
        "created_at": ts,
        "is_archived": False,
    }


# ── Tests ────────────────────────────────────────────────────────────────────


def test_recent_updates_groups_by_session(monkeypatch):
    """Multiple vocab from same session collapse into a single event with count."""
    rows = [
        _row("alpha", "sess-A", "2026-04-29T12:00:00+00:00"),
        _row("beta",  "sess-A", "2026-04-29T12:00:01+00:00"),
        _row("gamma", "sess-A", "2026-04-29T12:00:02+00:00"),
    ]
    authz = _patch(monkeypatch, rows)
    res = _run(vb.get_recent_vocab_updates(limit=10, authorization=authz))

    assert "events" in res
    events = res["events"]
    assert len(events) == 1
    e = events[0]
    assert e["session_id"] == "sess-A"
    assert e["vocab_count"] == 3
    # Preview is capped at 3 headwords.
    assert sorted(e["vocab_preview"]) == ["alpha", "beta", "gamma"]


def test_recent_updates_sorted_by_timestamp(monkeypatch):
    """Most recent session event appears first."""
    rows = [
        _row("old",     "sess-old", "2026-04-20T08:00:00+00:00"),
        _row("middle",  "sess-mid", "2026-04-25T08:00:00+00:00"),
        _row("newest",  "sess-new", "2026-04-29T08:00:00+00:00"),
    ]
    authz = _patch(monkeypatch, rows)
    res = _run(vb.get_recent_vocab_updates(limit=10, authorization=authz))

    sids = [e["session_id"] for e in res["events"]]
    assert sids == ["sess-new", "sess-mid", "sess-old"]


def test_recent_updates_respects_limit(monkeypatch):
    """?limit=2 returns at most 2 events even when more sessions exist."""
    rows = [
        _row("a", f"sess-{i}", f"2026-04-{20+i:02d}T08:00:00+00:00")
        for i in range(5)
    ]
    authz = _patch(monkeypatch, rows)
    res = _run(vb.get_recent_vocab_updates(limit=2, authorization=authz))
    assert len(res["events"]) == 2


def test_recent_updates_manual_bucket_has_null_session(monkeypatch):
    """Rows with no session_id collapse into one event with session_id=None."""
    rows = [
        _row("manual1", None, "2026-04-29T10:00:00+00:00"),
        _row("manual2", None, "2026-04-29T11:00:00+00:00"),
    ]
    authz = _patch(monkeypatch, rows)
    res = _run(vb.get_recent_vocab_updates(limit=10, authorization=authz))
    assert len(res["events"]) == 1
    assert res["events"][0]["session_id"] is None
    assert res["events"][0]["vocab_count"] == 2


def test_recent_updates_empty(monkeypatch):
    """User with no vocab rows → events is an empty list (not 404)."""
    authz = _patch(monkeypatch, [])
    res = _run(vb.get_recent_vocab_updates(limit=10, authorization=authz))
    assert res == {"events": []}


def test_recent_updates_feature_flag_off(monkeypatch):
    """Flag-disabled user receives 403, not the data."""
    from fastapi import HTTPException
    authz = _patch(monkeypatch, [], flag_enabled=False)
    with pytest.raises(HTTPException) as exc:
        _run(vb.get_recent_vocab_updates(limit=10, authorization=authz))
    assert exc.value.status_code == 403
