"""
Tests for POST /api/vocabulary/bank/{id}/skip.

Day 2 Wave 2 dogfood follow-up: the triage view's 🗑️ Bỏ qua button was
local-only — reload brought the row back.  Endpoint here flips the new
`is_skipped` column (migration 030) so the decision persists across
sessions and every downstream surface filters on it.

Pattern mirrors test_vocab_accept_suggestion / test_vocab_mark_fixed:
stub the user-scoped Supabase client + auth dependency so the handler
runs offline.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from routers import vocabulary_bank as vb


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Stub that records the update so we can assert on the write ──────────────


class _StubBuilder:
    def __init__(self, parent, table):
        self._parent = parent
        self._table = table
        self._mode = None
        self._payload = None

    def select(self, *_a, **_k):
        self._mode = "select"
        return self

    def update(self, payload):
        self._mode = "update"
        self._payload = dict(payload)
        return self

    def eq(self, *_a, **_k):     return self
    def limit(self, *_a, **_k):  return self

    def execute(self):
        class _R: pass
        r = _R()
        if self._mode == "update":
            self._parent.updates.setdefault(self._table, []).append(self._payload)
            r.data = []
            return r
        r.data = list(self._parent.rows.get(self._table, []))
        return r


class _StubClient:
    def __init__(self):
        self.rows: dict[str, list[dict]] = {}
        self.updates: dict[str, list] = {}

    def table(self, name):
        return _StubBuilder(self, name)


def _patch(monkeypatch, *,
           is_skipped: bool = False,
           user_owns: bool = True,
           flag_enabled: bool = True):
    client = _StubClient()
    if user_owns:
        client.rows["user_vocabulary"] = [
            {"id": "vocab-skip", "is_skipped": is_skipped}
        ]

    async def _fake_auth(_authz):
        return {"id": "user-uuid-skip"}

    monkeypatch.setattr(vb, "_require_auth", _fake_auth)
    monkeypatch.setattr(vb, "_vocab_bank_enabled", lambda _uid: flag_enabled)
    monkeypatch.setattr(vb, "_user_sb", lambda _token: client)
    monkeypatch.setattr(vb, "_fire_event", lambda *_a, **_k: None)
    return client, "Bearer fake-jwt"


# ── Happy path ──────────────────────────────────────────────────────────────


def test_skip_marks_is_skipped_true(monkeypatch):
    client, authz = _patch(monkeypatch, is_skipped=False)
    res = _run(vb.skip_vocab(vocab_id="vocab-skip", authorization=authz))
    assert res == {"ok": True, "vocab_id": "vocab-skip", "already_skipped": False}
    assert {"is_skipped": True} in client.updates.get("user_vocabulary", [])


# ── Idempotency ─────────────────────────────────────────────────────────────


def test_skip_idempotent_for_already_skipped(monkeypatch):
    """Re-skipping is a no-op write but a success response."""
    client, authz = _patch(monkeypatch, is_skipped=True)
    res = _run(vb.skip_vocab(vocab_id="vocab-skip", authorization=authz))
    assert res == {"ok": True, "vocab_id": "vocab-skip", "already_skipped": True}
    # No second UPDATE — the row was already in the desired state.
    assert "user_vocabulary" not in client.updates


# ── Auth + ownership gates ──────────────────────────────────────────────────


def test_skip_404_when_row_missing_or_not_owned(monkeypatch):
    """RLS-filtered or non-existent row → 404, not silent success."""
    _, authz = _patch(monkeypatch, user_owns=False)
    with pytest.raises(HTTPException) as exc:
        _run(vb.skip_vocab(vocab_id="vocab-missing", authorization=authz))
    assert exc.value.status_code == 404


def test_skip_403_when_feature_flag_off(monkeypatch):
    """Flag-disabled user receives 403, never reaches the DB stub."""
    _, authz = _patch(monkeypatch, flag_enabled=False)
    with pytest.raises(HTTPException) as exc:
        _run(vb.skip_vocab(vocab_id="vocab-skip", authorization=authz))
    assert exc.value.status_code == 403


# ── Filter pin: every user-facing read excludes is_skipped=true ─────────────
#
# The contract these tests pin is "PR-A surfaces filter is_skipped=false".
# A regression here would mean a refactor quietly dropped the filter on
# one of the listings, re-exposing skipped vocab.  We don't simulate column
# predicates in the stub (rows passed in are already curated), but we DO
# inspect the builder chain by recording the eq() calls so a removed filter
# fails this test even when the data path still happens to be empty.


class _FilterRecordingBuilder:
    """Records every (col, val) eq() call for assertion.  Otherwise behaves
    like the export stub — passes select/order/limit through, returns
    canned rows on execute()."""
    def __init__(self, parent, data):
        self._parent = parent
        self._data = data

    def select(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def eq(self, col, val):
        self._parent.eq_calls.append((col, val))
        return self

    def execute(self):
        class _R: pass
        r = _R()
        r.data = list(self._data) if self._data else []
        r.count = None
        return r


class _FilterRecordingClient:
    def __init__(self, data=None):
        self._data = data or []
        self.eq_calls = []
    def table(self, *_a, **_k):
        return _FilterRecordingBuilder(self, self._data)


def _filter_patch(monkeypatch):
    client = _FilterRecordingClient(data=[
        {"id": "v1", "headword": "alpha", "mastery_status": "learning",
         "source_type": "manual", "session_id": None, "created_at": "2026-04-30T00:00:00+00:00"},
    ])

    async def _fake_auth(_authz):
        return {"id": "user-uuid-filter"}
    monkeypatch.setattr(vb, "_require_auth", _fake_auth)
    monkeypatch.setattr(vb, "_vocab_bank_enabled", lambda _uid: True)
    monkeypatch.setattr(vb, "_user_sb", lambda _token: client)
    monkeypatch.setattr(vb, "_fire_event", lambda *_a, **_k: None)
    return client, "Bearer fake-jwt"


def test_listing_filters_is_skipped_false(monkeypatch):
    """GET /api/vocabulary/bank applies eq('is_skipped', False)."""
    client, authz = _filter_patch(monkeypatch)
    _run(vb.list_vocab(status=None, source_type=None, authorization=authz))
    assert ("is_skipped", False) in client.eq_calls


def test_stats_filters_is_skipped_false(monkeypatch):
    client, authz = _filter_patch(monkeypatch)
    _run(vb.get_vocab_stats(authorization=authz))
    assert ("is_skipped", False) in client.eq_calls


def test_recent_updates_filters_is_skipped_false(monkeypatch):
    client, authz = _filter_patch(monkeypatch)
    _run(vb.get_recent_vocab_updates(limit=10, authorization=authz))
    assert ("is_skipped", False) in client.eq_calls


def test_recent_session_lookup_filters_is_skipped_false(monkeypatch):
    client, authz = _filter_patch(monkeypatch)
    _run(vb.get_recent_vocab(session_id="sess-1", authorization=authz))
    assert ("is_skipped", False) in client.eq_calls


def test_detail_filters_is_skipped_false(monkeypatch):
    client, authz = _filter_patch(monkeypatch)
    _run(vb.get_vocab_detail(vocab_id="v1", authorization=authz))
    assert ("is_skipped", False) in client.eq_calls


def test_export_filters_is_skipped_false(monkeypatch):
    client, authz = _filter_patch(monkeypatch)
    # Export's docstring is explicit that skipped rows are excluded; pin it
    # so a future "lossless backup" refactor can't silently re-include them.
    _run(vb.export_user_vocabulary(format="json", authorization=authz))
    assert ("is_skipped", False) in client.eq_calls
