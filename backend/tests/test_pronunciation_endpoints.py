"""B9 (#44) — pronunciation endpoints had no integration tests. Pin the auth +
session/response ownership guards (the security contract) for both routes. The
Azure assessment path is not exercised here — these cover the IDOR/ownership
checks that run before any provider call."""
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
    def __init__(self, data):
        self._data = data

    def select(self, *_a, **_k): return self
    def eq(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def execute(self):
        class _R:
            pass
        r = _R(); r.data = self._data
        return r


class _DB:
    def __init__(self, tables):
        self._t = tables

    def table(self, name):
        return _Q(self._t.get(name, []))


def _auth_ok(monkeypatch):
    async def _user(_a):
        return {"id": "u1"}
    monkeypatch.setattr(pron, "get_supabase_user", _user)


def test_response_pron_404_when_session_not_owned(monkeypatch):
    _auth_ok(monkeypatch)
    monkeypatch.setattr(pron, "supabase_admin", _DB({"sessions": []}))   # not owned
    with pytest.raises(HTTPException) as ei:
        _run(pron.assess_response_pronunciation("s1", "r1", authorization="Bearer x"))
    assert ei.value.status_code == 404


def test_response_pron_404_when_response_not_in_session(monkeypatch):
    _auth_ok(monkeypatch)
    monkeypatch.setattr(pron, "supabase_admin",
                        _DB({"sessions": [{"id": "s1"}], "responses": []}))
    with pytest.raises(HTTPException) as ei:
        _run(pron.assess_response_pronunciation("s1", "r1", authorization="Bearer x"))
    assert ei.value.status_code == 404


def test_full_pron_requires_auth(monkeypatch):
    async def _deny(_a):
        raise HTTPException(401, "no token")
    monkeypatch.setattr(pron, "get_supabase_user", _deny)
    with pytest.raises(HTTPException) as ei:
        _run(pron.assess_full_test_pronunciation("s1", authorization=None))
    assert ei.value.status_code == 401
