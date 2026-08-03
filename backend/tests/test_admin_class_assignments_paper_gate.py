"""routers/admin_class_assignments — which papers a class may be given (GĐ 5).

`status = published` is NOT the same as "a student can open this". Papers marked
`exam_only` (mig 170) are reserved for mock sittings: the student Reading and
Listening endpoints answer 404 to anyone without one. Most of the Cambridge
library is flagged that way.

Giving one as class homework produces the worst kind of failure — the ledger
records the whole class as owing work, the teacher sees "chưa nộp" mounting, and
every student who clicks it gets "không tìm thấy đề". Nothing in that loop tells
anyone the assignment itself was impossible.

Checked in the backend because the picker is convenience, not the gate: an admin
can hold the modal open across a publish/reserve change, and the request can be
replayed.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from routers import admin_class_assignments as mod


class _Resp:
    def __init__(self, data): self.data = data


class _Table:
    def __init__(self, rows): self._rows = list(rows)

    def select(self, *_a, **_k): return self
    def eq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self
    def limit(self, *_a): return self

    def update(self, patch):
        self._patch = dict(patch)
        return self

    def execute(self):
        if getattr(self, "_patch", None) is not None:
            for r in self._rows:
                r.update(self._patch)
        return _Resp(self._rows)


def _db(paper):
    rows = [paper] if paper else []
    db = type("DB", (), {})()
    db.table = lambda name: _Table(rows if name in ("reading_tests", "listening_tests")
                                   else [{"id": "c1"}])
    return db


def _body(skill="reading"):
    return mod.AssignmentCreate(
        skill=skill, title="Bài tập đọc", content_id="uuid-1", due_date="2026-08-10",
    )


def _playable(**over):
    """A listening paper the student endpoint would actually serve."""
    row = {"id": "uuid-1", "title": "Đề nghe 1", "status": "published",
           "exam_only": False, "assembled_audio_storage_path": "a/b.mp3",
           "full_audio_storage_path": None}
    row.update(over)
    return row


async def _create(paper, skill="reading"):
    with patch.object(mod, "require_admin", AsyncMock(return_value={"id": "adm"})), \
         patch.object(mod, "_require_cohort", lambda _c: None), \
         patch.object(mod, "supabase_admin", _db(paper)), \
         patch.object(mod, "create_class_assignment",
                      lambda *a, **k: {"assignment": {"id": "a1"}, "student_count": 3,
                                       "unactivated_count": 0}):
        return await mod.create_assignment("c1", _body(skill), None)


@pytest.mark.asyncio
async def test_an_ordinary_published_paper_can_be_given():
    out = await _create({"id": "uuid-1", "title": "Đề luyện 1",
                         "status": "published", "exam_only": False})
    assert out["student_count"] == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("skill", ["reading", "listening"])
async def test_a_paper_reserved_for_mock_sittings_is_refused(skill):
    with pytest.raises(Exception) as exc:
        await _create({"id": "uuid-1", "title": "Cam 18 Test 1",
                       "status": "published", "exam_only": True}, skill)
    assert getattr(exc.value, "status_code", None) == 400
    assert "thi thử" in str(getattr(exc.value, "detail", ""))


@pytest.mark.asyncio
async def test_an_unpublished_paper_is_still_refused():
    with pytest.raises(Exception) as exc:
        await _create({"id": "uuid-1", "title": "Nháp", "status": "draft",
                       "exam_only": False})
    assert getattr(exc.value, "status_code", None) == 400


@pytest.mark.asyncio
async def test_a_paper_that_does_not_exist_is_a_404_not_a_silent_give():
    with pytest.raises(Exception) as exc:
        await _create(None)
    assert getattr(exc.value, "status_code", None) == 404


def test_a_reading_or_listening_task_must_name_a_paper():
    """Without content_id there is nothing to open and nothing to match a
    hand-in against — the item would sit unsubmittable forever."""
    with pytest.raises(Exception):
        mod.AssignmentCreate(skill="reading", title="x", due_date="2026-08-10")


# ── đề nghe: xuất bản chưa chắc bật lên nghe được ───────────────────────


@pytest.mark.asyncio
async def test_a_listening_paper_with_no_audio_is_refused():
    """Clearing the assembled audio (section audio replaced) leaves the row
    published while the student endpoint answers 422 — the same
    owed-but-unopenable trap as exam_only."""
    with pytest.raises(Exception) as exc:
        await _create(_playable(assembled_audio_storage_path=None,
                                full_audio_storage_path=None), "listening")
    assert getattr(exc.value, "status_code", None) == 400
    assert "audio" in str(getattr(exc.value, "detail", "")).lower()


@pytest.mark.asyncio
@pytest.mark.parametrize("col", ["assembled_audio_storage_path",
                                 "full_audio_storage_path"])
async def test_either_audio_path_is_enough(col):
    """The student endpoint accepts either — refusing a paper it would serve is
    as wrong as accepting one it would not."""
    row = _playable(assembled_audio_storage_path=None, full_audio_storage_path=None)
    row[col] = "x/y.mp3"
    out = await _create(row, "listening")
    assert out["student_count"] == 3


@pytest.mark.asyncio
async def test_a_reading_paper_is_not_asked_for_audio():
    """Reading has no audio columns at all; requiring them would refuse every
    reading paper."""
    out = await _create({"id": "uuid-1", "title": "Đề đọc", "status": "published",
                         "exam_only": False}, "reading")
    assert out["student_count"] == 3


# ── xoá bài giao: hàm SQL tự đọc bằng chứng, router không vá trước ───────


class _RpcDB:
    """Records the order of operations."""

    def __init__(self, assignment):
        self.calls: list[str] = []
        self._assignment = assignment

    def table(self, name):
        self.calls.append(f"table:{name}")
        return _Table([self._assignment] if name == "class_assignments" else [])

    def rpc(self, fn, _params):
        self.calls.append(f"rpc:{fn}")
        return type("R", (), {"execute": lambda _s: _Resp(True)})()


@pytest.mark.asyncio
async def test_delete_asks_the_locking_rpc_and_nothing_else():
    """The guard reads the attempt link itself, inside the same transaction as
    the DELETE (mig 181). An earlier design needed a best-effort repair pass
    here first, because the ledger could be stale in a way only a scan could
    fix — following a foreign key under a row lock removes that need, and with
    it the window between the two calls where a hand-in could still be lost."""
    from routers import admin_class_assignments as m

    db = _RpcDB({"id": "asg-1", "cohort_id": "c1", "skill": "reading",
                 "content_id": "t1", "status": "published"})
    with patch.object(m, "require_admin", AsyncMock(return_value={"id": "adm"})), \
         patch.object(m, "supabase_admin", db):
        await m.delete_assignment("c1", "asg-1", None)

    assert db.calls == ["rpc:fn_delete_class_assignment_if_unsubmitted"]


class _CaptureTable:
    def __init__(self, store):
        self._store = store

    def update(self, patch): self._store.append(dict(patch)); return self
    def eq(self, *_a): return self
    def execute(self): return _Resp([{"id": "asg-1"}])


async def _patch_status(new_status):
    from routers import admin_class_assignments as m

    seen: list[dict] = []
    db = type("DB", (), {})()
    db.table = lambda _n: _CaptureTable(seen)
    with patch.object(m, "require_admin", AsyncMock(return_value={"id": "adm"})), \
         patch.object(m, "supabase_admin", db):
        await m.update_assignment("c1", "asg-1",
                                  m.AssignmentPatch(status=new_status), None)
    return seen[0]


@pytest.mark.asyncio
@pytest.mark.parametrize("new_status", ["archived", "published"])
async def test_changing_status_writes_only_the_status(new_status):
    """Archiving and reopening no longer move any cutoff, because there is no
    cutoff: whether an attempt counts is answered by its link, not by when it
    was submitted relative to the give."""
    written = await _patch_status(new_status)
    assert written == {"status": new_status}
