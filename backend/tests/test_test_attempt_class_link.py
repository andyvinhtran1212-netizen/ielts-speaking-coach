"""Hai điểm TẠO lượt làm đề phải đóng dấu mục bài tập lên hàng.

This is where the link is written, and it is the only place. If either endpoint
drops it, the attempt looks exactly like free practice: the class page keeps
showing the task as owed, the student has already done it, and no later read can
tell the difference — the repair pass follows the link and there is nothing
else for it to follow.

The stamp is written only AFTER validation, and the two orderings are not
interchangeable: a row written first and checked second is a row that exists.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from routers import listening as listening_mod
from routers import reading_student as reading_mod


class _Resp:
    def __init__(self, data): self.data = data


class _Table:
    def __init__(self, rows, sink):
        self._rows, self._sink = list(rows), sink

    def select(self, *_a, **_k): return self
    def eq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self
    def limit(self, *_a): return self
    def update(self, _p): return self

    def insert(self, payload):
        self._sink.append(dict(payload))
        return self

    def execute(self): return _Resp(self._rows)


def _db(rows=None):
    sink: list[dict] = []
    tables = rows or {}
    db = type("DB", (), {})()
    db.table = lambda n: _Table(tables.get(n, []), sink)
    db.inserted = sink
    return db


# ── Reading ─────────────────────────────────────────────────────────────


async def _start_reading(class_item, *, validator=None):
    db = _db()
    with patch.object(reading_mod, "_require_auth",
                      AsyncMock(return_value={"id": "user-1"})), \
         patch.object(reading_mod, "_fetch_published_test",
                      lambda _t: {"id": "uuid-1", "time_limit_minutes": 60,
                                  "metadata": {}}), \
         patch.object(reading_mod, "_assert_exam_content_allowed", lambda *_a: None), \
         patch.object(reading_mod, "_require_test_unlocked", lambda *_a: None), \
         patch.object(reading_mod, "_abandon_open_attempts", lambda *_a: None), \
         patch.object(reading_mod, "validate_class_item_for_test",
                      validator or (lambda *_a, **_k: None)), \
         patch.object(reading_mod, "supabase_admin", db):
        await reading_mod.start_reading_test_attempt("CAM19-T3", class_item=class_item)
    return db.inserted[0]


@pytest.mark.asyncio
async def test_a_reading_attempt_started_from_the_class_page_carries_the_item():
    row = await _start_reading("item-1")
    assert row["class_assignment_item_id"] == "item-1"


@pytest.mark.asyncio
async def test_free_practice_writes_no_link_at_all():
    """NULL, not an empty string: the repair path filters on the column, and a
    blank would sit in the index for every practice attempt ever made."""
    row = await _start_reading(None)
    assert "class_assignment_item_id" not in row


@pytest.mark.asyncio
async def test_a_rejected_reading_link_writes_no_attempt_row():
    """Validated BEFORE the insert. Checking afterwards leaves the row behind —
    and the row is the thing the ledger trusts."""
    def _refuse(*_a, **_k):
        raise reading_mod.TaskMismatchError("Đề đang làm không phải đề được giao.")

    with pytest.raises(Exception) as exc:
        await _start_reading("item-1", validator=_refuse)
    assert getattr(exc.value, "status_code", None) == 400


# ── Listening ───────────────────────────────────────────────────────────


async def _start_listening(class_item, *, validator=None):
    db = _db({"listening_tests": [{
        "id": "uuid-1", "status": "published", "exam_only": False,
        "full_audio_storage_path": "a/b.mp3",
        "assembled_audio_storage_path": None,
    }]})
    with patch.object(listening_mod, "_require_auth",
                      AsyncMock(return_value={"id": "user-1"})), \
         patch.object(listening_mod, "_assert_listening_exam_content_allowed",
                      lambda *_a: None), \
         patch.object(listening_mod, "validate_class_item_for_test",
                      validator or (lambda *_a, **_k: None)), \
         patch.object(listening_mod, "supabase_admin", db):
        await listening_mod.start_listening_test_attempt("uuid-1", class_item=class_item)
    return db.inserted[0]


@pytest.mark.asyncio
async def test_a_listening_attempt_started_from_the_class_page_carries_the_item():
    row = await _start_listening("item-1")
    assert row["class_assignment_item_id"] == "item-1"


@pytest.mark.asyncio
async def test_listening_free_practice_writes_no_link():
    row = await _start_listening(None)
    assert "class_assignment_item_id" not in row


@pytest.mark.asyncio
async def test_a_rejected_listening_link_writes_no_attempt_row():
    def _refuse(*_a, **_k):
        raise listening_mod.ItemNotFoundError("Bài tập không thuộc về học viên này")

    with pytest.raises(Exception) as exc:
        await _start_listening("item-1", validator=_refuse)
    assert getattr(exc.value, "status_code", None) == 400
