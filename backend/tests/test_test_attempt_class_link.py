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


# ── HỌC TIẾP: đường duy nhất đi vòng qua chỗ đóng dấu ────────────────────
#
# Resuming skips attempt creation, and creation is where the link is stamped.
# So the resume lookup has to be scoped, or a student opening their homework is
# offered an unfinished free-practice attempt on the same paper, finishes it,
# submits it — and still owes the homework, with nothing anywhere recording
# that they did the work.


class _RecordingTable:
    def __init__(self, rows, seen):
        self._rows, self._seen = list(rows), seen

    def select(self, *_a, **_k): return self
    def eq(self, f, v):
        self._seen.append((f, v))
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self
    def is_(self, f, _v):
        self._seen.append((f, "null"))
        self._rows = [r for r in self._rows if r.get(f) is None]
        return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def execute(self): return _Resp(self._rows)


_FREE = {"id": "att-FREE", "user_id": "user-1", "test_id": "uuid-1",
         "status": "in_progress", "started_at": "2026-08-01T00:00:00+00:00",
         "answers": [], "class_assignment_item_id": None, "sitting_id": None}
_HOMEWORK = {**_FREE, "id": "att-HW", "class_assignment_item_id": "item-1"}


def _lookup_db(rows, seen):
    db = type("DB", (), {})()
    db.table = lambda _n: _RecordingTable(rows, seen)
    return db


def _reading_resume(rows, class_item):
    seen: list = []
    with patch.object(reading_mod, "supabase_admin", _lookup_db(rows, seen)):
        got = reading_mod._fetch_in_progress_payload(
            "user-1", "CAM19-T3", {"id": "uuid-1", "time_limit_minutes": 60},
            raise_on_missing=False, class_item=class_item,
        )
    return got, seen


def test_reading_homework_does_not_resume_a_free_practice_attempt():
    got, seen = _reading_resume([_FREE], "item-1")
    assert got is None
    assert ("class_assignment_item_id", "item-1") in seen


def test_reading_homework_resumes_its_own_attempt():
    got, _ = _reading_resume([_HOMEWORK], "item-1")
    assert got and got["attempt_id"] == "att-HW"


def test_opening_the_paper_from_the_library_may_still_resume_homework():
    """Deliberately one-way. The student is finishing work they started, and
    the link they already earned goes on standing — narrowing this side too
    would strand a half-finished hand-in."""
    got, seen = _reading_resume([_HOMEWORK], None)
    assert got and got["attempt_id"] == "att-HW"
    assert not any(f == "class_assignment_item_id" for f, _ in seen)


@pytest.mark.asyncio
async def test_listening_homework_does_not_resume_a_free_practice_attempt():
    seen: list = []
    with patch.object(listening_mod, "_require_auth",
                      AsyncMock(return_value={"id": "user-1"})), \
         patch.object(listening_mod, "supabase_admin", _lookup_db([_FREE], seen)):
        out = await listening_mod.get_in_progress_listening_attempt(
            "uuid-1", class_item="item-1")
    assert not (out or {}).get("attempt")
    assert ("class_assignment_item_id", "item-1") in seen


@pytest.mark.asyncio
async def test_listening_homework_resumes_its_own_attempt():
    seen: list = []
    with patch.object(listening_mod, "_require_auth",
                      AsyncMock(return_value={"id": "user-1"})), \
         patch.object(listening_mod, "supabase_admin", _lookup_db([_HOMEWORK], seen)):
        out = await listening_mod.get_in_progress_listening_attempt(
            "uuid-1", class_item="item-1")
    assert (out or {}).get("attempt", {}).get("attempt_id") == "att-HW"


@pytest.mark.asyncio
async def test_the_reading_boot_endpoint_passes_the_class_item_through():
    """Boot doubles as the resume lookup — it is what the page actually calls.
    Scoping the helper but not threading the value through it leaves the hole
    exactly where it was."""
    seen: dict = {}

    def _capture(*_a, **kw):
        seen.update(kw)
        return None

    with patch.object(reading_mod, "_require_auth",
                      AsyncMock(return_value={"id": "user-1"})), \
         patch.object(reading_mod, "_build_reading_test_detail",
                      lambda *_a, **_k: {"id": "uuid-1"}), \
         patch.object(reading_mod, "_fetch_in_progress_payload", _capture):
        await reading_mod.boot_reading_test("CAM19-T3", class_item="item-1")

    assert seen.get("class_item") == "item-1"


@pytest.mark.asyncio
async def test_the_standalone_reading_resume_endpoint_passes_it_through_too():
    seen: dict = {}

    def _capture(*_a, **kw):
        seen.update(kw)
        return None

    with patch.object(reading_mod, "_require_auth",
                      AsyncMock(return_value={"id": "user-1"})), \
         patch.object(reading_mod, "_fetch_published_test",
                      lambda _t: {"id": "uuid-1"}), \
         patch.object(reading_mod, "_fetch_in_progress_payload", _capture):
        await reading_mod.get_in_progress_reading_attempt("CAM19-T3",
                                                          class_item="item-1")

    assert seen.get("class_item") == "item-1"
