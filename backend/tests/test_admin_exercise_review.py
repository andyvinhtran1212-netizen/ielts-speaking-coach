"""
Admin review-tool tests for vocabulary_exercises.

These exercise the publish/reject helper and the bulk-action handler with a
fake Supabase client so the tests run without DB or auth.

Run: pytest backend/tests/test_admin_exercise_review.py -v
"""

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from routers import exercises as exr


# ── A tiny stand-in for supabase_admin.table('...').update(...).eq(...).execute()
class _FakeRes:
    def __init__(self, data): self.data = data


class _FakeQuery:
    def __init__(self, table_name: str, store: dict):
        self.table_name = table_name
        self.store = store
        self._update: dict | None = None
        self._eq: tuple[str, Any] | None = None
        self._in: tuple[str, list] | None = None

    def update(self, payload):
        self._update = payload
        return self

    def eq(self, col, value):
        self._eq = (col, value)
        return self

    def in_(self, col, values):
        self._in = (col, values)
        return self

    def execute(self):
        rows = list(self.store.get(self.table_name, []))
        if self._eq:
            col, value = self._eq
            rows = [r for r in rows if r.get(col) == value]
        if self._in:
            col, values = self._in
            rows = [r for r in rows if r.get(col) in values]
        if self._update is not None:
            for r in rows:
                r.update(self._update)
        return _FakeRes(rows)


class _FakeClient:
    def __init__(self, store):
        self.store = store

    def table(self, name):
        return _FakeQuery(name, self.store)


def _make_store(rows):
    return {"vocabulary_exercises": list(rows)}


def _patch_admin(monkeypatch, store):
    fake = _FakeClient(store)
    monkeypatch.setattr(exr, "supabase_admin", fake)


REVIEWER = "00000000-0000-0000-0000-000000000099"


def test_admin_set_status_publish_marks_reviewed(monkeypatch):
    rows = [{"id": "ex-1", "status": "draft"}]
    store = _make_store(rows)
    _patch_admin(monkeypatch, store)

    out = exr._admin_set_status("ex-1", "published", REVIEWER)
    assert out["status"] == "published"
    assert out["reviewed_by"] == REVIEWER
    assert "reviewed_at" in out
    assert store["vocabulary_exercises"][0]["status"] == "published"


def test_admin_set_status_reject_works(monkeypatch):
    rows = [{"id": "ex-2", "status": "draft"}]
    _patch_admin(monkeypatch, _make_store(rows))

    out = exr._admin_set_status("ex-2", "rejected", REVIEWER)
    assert out["status"] == "rejected"


def test_admin_set_status_404_when_not_found(monkeypatch):
    _patch_admin(monkeypatch, _make_store([]))
    with pytest.raises(HTTPException) as exc:
        exr._admin_set_status("missing", "published", REVIEWER)
    assert exc.value.status_code == 404


def test_generate_and_insert_batch_inserts_drafts(monkeypatch):
    """Stub generate_d1_exercises to drive the on_chunk_validated callback
    and verify the orchestrator collects insert + chunk stats correctly."""
    inserted: list[list[dict]] = []

    class _InsertQuery:
        def insert(self, rows):
            inserted.append(list(rows))
            class _R: data = list(rows)
            return type("_X", (), {"execute": staticmethod(lambda: _R())})()

    class _InsertClient:
        def table(self, _name): return _InsertQuery()

    monkeypatch.setattr(exr, "supabase_admin", _InsertClient())

    def _fake_gen(words, count=None, on_chunk_validated=None, **_kw):
        items = [
            {"word": w, "answer": w, "sentence": f"This ___ matters {w}.",
             "distractors": ["x", "y", "z"]}
            for w in words[:count or len(words)]
        ]
        if on_chunk_validated and items:
            on_chunk_validated(items)
        return items

    monkeypatch.setattr(exr, "generate_d1_exercises", _fake_gen)

    result = exr._generate_and_insert_batch(["alpha", "beta"], count=2, admin_id=REVIEWER)
    assert result["inserted_count"]    == 2
    assert result["total_chunks"]      == 1     # 2 words → ceil(2/10) = 1 chunk
    assert result["successful_chunks"] == 1
    assert result["failed_chunks"]     == 0
    assert len(inserted) == 1
    rows = inserted[0]
    assert all(r["status"] == "draft" for r in rows)
    assert all(r["exercise_type"] == "D1" for r in rows)
    assert all(r["created_by"] == REVIEWER for r in rows)


def test_generate_and_insert_batch_returns_zero_when_gemini_empty(monkeypatch):
    """Gemini OK but no validated items → inserted=0, but still 1 chunk.
    NOT a GeminiBatchError."""
    monkeypatch.setattr(
        exr, "generate_d1_exercises",
        lambda *a, on_chunk_validated=None, **k: [],
    )
    result = exr._generate_and_insert_batch(["x"], count=1, admin_id=REVIEWER)
    assert result["inserted_count"]    == 0
    assert result["total_chunks"]      == 1
    assert result["successful_chunks"] == 0


def test_generate_and_insert_batch_propagates_gemini_error(monkeypatch):
    """A real Gemini failure (e.g. 404 model name on every chunk) must
    bubble up so the admin endpoint can surface it instead of silently
    returning zero drafts."""
    from services.d1_content_gen import GeminiBatchError

    def _boom(*a, on_chunk_validated=None, **k):
        raise GeminiBatchError("All 1 chunk(s) failed. Last error: 404 model")

    monkeypatch.setattr(exr, "generate_d1_exercises", _boom)
    with pytest.raises(GeminiBatchError):
        exr._generate_and_insert_batch(["x"], count=1, admin_id=REVIEWER)
