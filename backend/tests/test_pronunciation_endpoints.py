"""B9 (#44) — pronunciation endpoints had no integration tests. Pin the auth +
session/response ownership guards (the IDOR contract) for both routes. The Azure
assessment path is not exercised — these cover the ownership checks that run
before any provider call.

The fake query builder APPLIES every .eq(col, val) predicate AND records it, so a
regression that drops `.eq("user_id", user_id)` (or `.eq("session_id", ...)`) is
caught two ways: the canned row stops being filtered out (data-driven), and the
explicit predicate assertion fails (PR #599 review).
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from routers import pronunciation as pron


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Q:
    def __init__(self, rows, recorder):
        self._rows = rows
        self._filters = []
        self._rec = recorder

    def select(self, *_a, **_k): return self

    def eq(self, col, val):
        self._filters.append((col, val))
        self._rec.append((col, val))
        return self

    def limit(self, *_a, **_k): return self

    def execute(self):
        data = [r for r in self._rows if all(r.get(c) == v for c, v in self._filters)]
        return type("_R", (), {"data": data})()


class _DB:
    """Applies + records .eq predicates per table so ownership filters are
    actually exercised and assertable."""
    def __init__(self, tables):
        self._t = tables
        self.eq_calls: dict[str, list] = {}

    def table(self, name):
        self.eq_calls.setdefault(name, [])
        return _Q(self._t.get(name, []), self.eq_calls[name])


def _auth_ok(monkeypatch, uid="u1"):
    async def _user(_a):
        return {"id": uid}
    monkeypatch.setattr(pron, "get_supabase_user", _user)


def test_response_pron_404_when_session_owned_by_another_user(monkeypatch):
    _auth_ok(monkeypatch, uid="u1")
    # the session exists but belongs to OTHER — the user_id predicate must filter it out
    db = _DB({"sessions": [{"id": "s1", "user_id": "OTHER"}]})
    monkeypatch.setattr(pron, "supabase_admin", db)

    with pytest.raises(HTTPException) as ei:
        _run(pron.assess_response_pronunciation("s1", "r1", authorization="Bearer x"))
    assert ei.value.status_code == 404
    # the ownership predicate was actually applied
    assert ("id", "s1") in db.eq_calls["sessions"]
    assert ("user_id", "u1") in db.eq_calls["sessions"]


def test_response_pron_404_when_response_belongs_to_another_session(monkeypatch):
    _auth_ok(monkeypatch, uid="u1")
    db = _DB({
        "sessions":  [{"id": "s1", "user_id": "u1"}],          # session passes
        "responses": [{"id": "r1", "session_id": "OTHER-SESSION"}],  # but response isn't in s1
    })
    monkeypatch.setattr(pron, "supabase_admin", db)

    with pytest.raises(HTTPException) as ei:
        _run(pron.assess_response_pronunciation("s1", "r1", authorization="Bearer x"))
    assert ei.value.status_code == 404
    # the response query is scoped to BOTH the response id and its session
    assert ("id", "r1") in db.eq_calls["responses"]
    assert ("session_id", "s1") in db.eq_calls["responses"]


def test_full_pron_requires_auth(monkeypatch):
    async def _deny(_a):
        raise HTTPException(401, "no token")
    monkeypatch.setattr(pron, "get_supabase_user", _deny)
    with pytest.raises(HTTPException) as ei:
        _run(pron.assess_full_test_pronunciation("s1", authorization=None))
    assert ei.value.status_code == 401
