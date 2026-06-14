"""tests/test_writing_prompt_bank.py — GET /api/writing/prompt-bank (R1 PR-1).

Public-read prompt library: no auth, flag-gated, browse-safe fields only,
filterable by the existing structured task_type. Handler called directly.
"""
from __future__ import annotations

import asyncio
import json

import pytest
from fastapi import HTTPException

from routers import writing_student as ws


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Req:
    """Minimal Request stand-in for cacheable_json (only .headers.get is used)."""
    headers: dict = {}


class _Q:
    def __init__(self, data, calls): self._data = data; self._calls = calls
    def select(self, *a, **k): return self
    def eq(self, col, val): self._calls.append((col, val)); return self
    def order(self, *a, **k): return self
    def execute(self): return type("R", (), {"data": self._data})()


class _DB:
    def __init__(self, data): self._data = data; self.calls = []
    def table(self, _n): return _Q(self._data, self.calls)


_ROWS = [
    {"id": "p1", "title": "Chart", "prompt_text": "Describe the chart.",
     "task_type": "task1_academic", "difficulty": "intermediate",
     "prompt_image_url": "https://img/1.png", "updated_at": "2026-06-14T10:00:00Z",
     "created_by": "admin-secret", "is_active": True},
    {"id": "p2", "title": "Opinion", "prompt_text": "Some agree…",
     "task_type": "task2", "difficulty": None, "prompt_image_url": None,
     "updated_at": "2026-06-13T10:00:00Z", "created_by": "x", "is_active": True},
]


def _enable(monkeypatch, on=True, data=None):
    monkeypatch.setattr(ws.settings, "WRITING_PROMPT_BANK_ENABLED", on)
    db = _DB(_ROWS if data is None else data)
    monkeypatch.setattr(ws, "supabase_admin", db)
    return db


def _body(resp):
    # cacheable_json returns a JSONResponse; flag-off returns a plain dict
    return json.loads(resp.body) if hasattr(resp, "body") else resp


def test_flag_off_returns_disabled(monkeypatch):
    _enable(monkeypatch, on=False)
    out = _run(ws.get_prompt_bank(_Req(), task_type=None))
    assert out == {"enabled": False, "prompts": []}


def test_flag_on_returns_browse_safe_prompts(monkeypatch):
    _enable(monkeypatch, on=True)
    body = _body(_run(ws.get_prompt_bank(_Req(), task_type=None)))
    assert body["enabled"] is True
    assert len(body["prompts"]) == 2
    p = body["prompts"][0]
    assert set(p) == {"id", "title", "prompt_text", "task_type", "difficulty", "prompt_image_url"}
    # task_type is the structured categorization (no inferred field)
    assert p["task_type"] == "task1_academic"
    # sensitive / internal fields are NOT leaked even though the row carried them
    assert "created_by" not in p and "is_active" not in p and "updated_at" not in p


def test_filters_active_and_by_task_type(monkeypatch):
    db = _enable(monkeypatch, on=True)
    _run(ws.get_prompt_bank(_Req(), task_type="task2"))
    assert ("is_active", True) in db.calls       # only active prompts
    assert ("task_type", "task2") in db.calls     # task_type filter applied


def test_bad_task_type_422(monkeypatch):
    _enable(monkeypatch, on=True)
    with pytest.raises(HTTPException) as e:
        _run(ws.get_prompt_bank(_Req(), task_type="task3"))
    assert e.value.status_code == 422


def test_no_auth_dependency():
    # The endpoint must NOT depend on get_current_student (mass-code 403 trap).
    import inspect
    sig = inspect.signature(ws.get_prompt_bank)
    for p in sig.parameters.values():
        assert "get_current_student" not in repr(p.default), "prompt-bank must be public-read"
