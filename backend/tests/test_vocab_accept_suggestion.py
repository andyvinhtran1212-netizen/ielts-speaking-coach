"""
Tests for POST /api/vocabulary/bank/{id}/accept.

Day 2 dogfood added a one-click promote flow for `upgrade_suggested`
entries.  The endpoint flips source_type → 'manual' so suggestions stop
looking provisional in the UI.

Pattern follows the other vocab_bank router tests: stub the user-scoped
Supabase client + auth dependency so we can drive the handler offline.
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


# ── Stub that records the update payload so we can assert on it ──────────────


class _StubBuilder:
    def __init__(self, parent, table):
        self._parent = parent
        self._table = table
        self._select_data = None
        self._update_payload = None
        self._mode = None  # 'select' | 'update'

    def select(self, *_a, **_k):
        self._mode = "select"
        self._select_data = self._parent.rows.get(self._table, [])
        return self

    def update(self, payload):
        self._mode = "update"
        self._update_payload = dict(payload)
        return self

    def eq(self, *_a, **_k):     return self
    def limit(self, *_a, **_k):  return self

    def execute(self):
        class _R:
            pass
        r = _R()
        if self._mode == "update":
            self._parent.last_update[self._table] = self._update_payload
            r.data = []
            return r
        r.data = list(self._select_data) if self._select_data else []
        return r


class _StubClient:
    def __init__(self):
        self.rows = {}            # table → list[dict]
        self.last_update = {}     # table → last update payload
    def table(self, name):
        return _StubBuilder(self, name)


def _patch(monkeypatch, *, source_type="upgrade_suggested", user_owns=True, flag_enabled=True):
    """Wire up auth + user-scoped Supabase stub.  Returns (client, authz)."""
    client = _StubClient()
    if user_owns:
        client.rows["user_vocabulary"] = [{"id": "vocab-1", "source_type": source_type}]
    # else: empty rows → 404 path

    async def _fake_auth(_authz):
        return {"id": "user-uuid-accept"}
    monkeypatch.setattr(vb, "_require_auth", _fake_auth)
    monkeypatch.setattr(vb, "_vocab_bank_enabled", lambda _uid: flag_enabled)
    monkeypatch.setattr(vb, "_user_sb", lambda _token: client)
    monkeypatch.setattr(vb, "_fire_event", lambda *_a, **_k: None)
    return client, "Bearer fake-jwt"


# ── Tests ────────────────────────────────────────────────────────────────────


def test_accept_promotes_upgrade_suggested_to_manual(monkeypatch):
    """Happy path: upgrade_suggested → manual flip persisted."""
    client, authz = _patch(monkeypatch, source_type="upgrade_suggested")
    res = _run(vb.accept_suggestion(vocab_id="vocab-1", authorization=authz))
    assert res == {"ok": True, "source_type": "manual", "promoted": True}
    assert client.last_update.get("user_vocabulary") == {"source_type": "manual"}


def test_accept_idempotent_for_already_manual(monkeypatch):
    """Calling accept on a row already promoted returns success without re-writing."""
    client, authz = _patch(monkeypatch, source_type="manual")
    res = _run(vb.accept_suggestion(vocab_id="vocab-1", authorization=authz))
    assert res == {"ok": True, "source_type": "manual", "promoted": False}
    assert "user_vocabulary" not in client.last_update


def test_accept_rejects_ai_verdict_sources(monkeypatch):
    """`used_well` / `needs_review` are AI verdicts the user can't overwrite via accept."""
    for src in ("used_well", "needs_review"):
        _, authz = _patch(monkeypatch, source_type=src)
        with pytest.raises(HTTPException) as exc:
            _run(vb.accept_suggestion(vocab_id="vocab-1", authorization=authz))
        assert exc.value.status_code == 409


def test_accept_404_when_row_missing_or_not_owned(monkeypatch):
    """Missing row (or RLS-filtered: not owned) → 404."""
    _, authz = _patch(monkeypatch, user_owns=False)
    with pytest.raises(HTTPException) as exc:
        _run(vb.accept_suggestion(vocab_id="vocab-missing", authorization=authz))
    assert exc.value.status_code == 404


def test_accept_403_when_feature_flag_off(monkeypatch):
    """Flag-disabled user receives 403, never reaches the DB stub."""
    _, authz = _patch(monkeypatch, flag_enabled=False)
    with pytest.raises(HTTPException) as exc:
        _run(vb.accept_suggestion(vocab_id="vocab-1", authorization=authz))
    assert exc.value.status_code == 403
