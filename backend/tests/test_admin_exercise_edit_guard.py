"""Báo cáo săn lỗi B2-03: bài tập đã xuất bản không được sửa trực tiếp."""
import asyncio

import pytest
from fastapi import HTTPException

from routers import exercises as ex


class _Q:
    def __init__(self, rows):
        self.rows, self.filters, self.patch = rows, [], None

    def update(self, patch):
        self.patch = patch
        return self

    def select(self, *_a):
        return self

    def eq(self, c, v):
        self.filters.append(lambda r: r.get(c) == v)
        return self

    def in_(self, c, vs):
        self.filters.append(lambda r: r.get(c) in vs)
        return self

    def limit(self, _n):
        return self

    def execute(self):
        hit = [r for r in self.rows if all(f(r) for f in self.filters)]
        if self.patch is not None:
            for r in hit:
                r.update(self.patch)
        return type("R", (), {"data": [dict(r) for r in hit]})()


class _DB:
    def __init__(self, rows):
        self.rows = rows

    def table(self, _n):
        return _Q(self.rows)


async def _admin(_a):
    return {"id": "admin-1"}


def _edit(monkeypatch, rows, exercise_id="e1"):
    monkeypatch.setattr(ex, "supabase_admin", _DB(rows))
    monkeypatch.setattr(ex, "require_admin", _admin)
    body = ex.AdminPatchExerciseRequest(content_payload={"answer": "new"})
    return asyncio.run(ex.admin_edit_exercise(exercise_id, body, authorization="Bearer t"))


def test_published_exercise_is_refused_and_unchanged(monkeypatch):
    row = {"id": "e1", "status": "published", "content_payload": {"answer": "old"}}
    with pytest.raises(HTTPException) as caught:
        _edit(monkeypatch, [row])
    assert caught.value.status_code == 409
    assert row["content_payload"] == {"answer": "old"}


@pytest.mark.parametrize("status", ["draft", "rejected"])
def test_draft_or_rejected_exercise_is_edited(monkeypatch, status):
    row = {"id": "e1", "status": status, "content_payload": {"answer": "old"}}
    assert _edit(monkeypatch, [row])["content_payload"] == {"answer": "new"}


def test_unknown_exercise_is_404(monkeypatch):
    with pytest.raises(HTTPException) as caught:
        _edit(monkeypatch, [], "nope")
    assert caught.value.status_code == 404
