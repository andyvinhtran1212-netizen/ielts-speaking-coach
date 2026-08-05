"""Mặt ĐỌC bài tự luận cho admin.

Dữ liệu vốn đã ghi đủ từ lúc chấm; thứ thiếu là một mặt đọc — trước đó giáo
viên chỉ thấy MỘT con số phần trăm và không biết học viên viết gì, sai gì.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from routers import admin_class_assignments as adm


class _Resp:
    def __init__(self, data): self.data = data


class _Table:
    def __init__(self, rows): self._rows = list(rows)
    def select(self, *_a, **_k): return self
    def eq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self
    def in_(self, f, vals):
        self._rows = [r for r in self._rows if r.get(f) in vals]
        return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def range(self, s, e): self._rows = self._rows[s:e + 1]; return self
    def execute(self): return _Resp(self._rows)


def _db(**tables):
    db = type("DB", (), {})()
    db.table = lambda n: _Table(tables.get(n, []))
    return db


_ASG = {"id": "a1", "cohort_id": "co1", "title": "Grammar 1", "skill": "course"}
_ITEM = {"id": "it1", "student_id": "s1", "assignment_id": "a1"}
_STUDENT = {"id": "s1", "full_name": "An", "student_code": "A1"}
_SUB = {"class_assignment_item_id": "it1", "total": 2, "clean": 1,
        "model": "gemini-2.5-flash-lite", "graded_at": "2026-08-05T10:00:00Z",
        "items": [{"qid": "E1", "prompt": "Viết lại", "explain": "mẫu",
                   "answer": "The buildings very modern.",
                   "corrected": "The buildings are very modern.",
                   "ok": False, "issues": [{"type": "grammar", "before": "",
                                            "after": "are", "note": "Thiếu be."}]}]}


async def _read(*, asg=_ASG, items=(_ITEM,), subs=(_SUB,), cohort="co1"):
    db = _db(class_assignments=[asg] if asg else [],
             class_assignment_items=list(items),
             students=[_STUDENT],
             course_writing_submissions=list(subs))
    with patch.object(adm, "require_admin", AsyncMock(return_value=None)), \
         patch.object(adm, "_require_cohort", lambda _c: None), \
         patch.object(adm, "supabase_admin", db):
        return await adm.student_course_writing(cohort, "a1", "s1", None)


@pytest.mark.asyncio
async def test_returns_the_whole_marking_not_just_a_score():
    out = await _read()
    assert out["student"]["name"] == "An"
    g = out["submission"]["items"][0]
    assert g["answer"] == "The buildings very modern."
    assert g["corrected"] == "The buildings are very modern."
    assert g["issues"][0]["note"] == "Thiếu be."
    assert g["explain"] == "mẫu", "đáp án mẫu lấy từ bản chụp"
    assert out["submission"]["model"], "model nào chấm — để truy vết"


@pytest.mark.asyncio
async def test_not_submitted_is_null_not_an_empty_marking():
    # "Chưa nộp" và "đã nộp mà rỗng" là hai chuyện; trang phải nói được cả hai.
    out = await _read(subs=())
    assert out["submission"] is None


@pytest.mark.asyncio
async def test_an_assignment_of_another_class_is_not_readable():
    """Thiếu chốt này thì id của lớp khác vẫn đọc được qua đường của lớp mình."""
    with pytest.raises(HTTPException) as e:
        await _read(asg={**_ASG, "cohort_id": "co-KHAC"})
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_a_learner_with_no_item_in_this_assignment_is_refused():
    with pytest.raises(HTTPException) as e:
        await _read(items=())
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_reads_by_assignment_item_not_by_bank():
    """Giao lại cùng bộ bài là một lượt khác — trộn hai lượt sẽ cho giáo viên
    đọc bài của lần giao TRƯỚC (cùng lý do mig 192)."""
    old = {**_SUB, "class_assignment_item_id": "it-CU", "clean": 99}
    out = await _read(subs=(old,))
    assert out["submission"] is None, "bài của mục khác không được lôi sang"


# ── Bảng tổng kết KHÔNG được tự mâu thuẫn (codex cục bộ) ────────────────────

def _tally_db(items, subs):
    return _db(
        class_assignments=[{**_ASG, "kind": "lesson", "status": "published",
                            "due_at": "2999-01-01T00:00:00+00:00",
                            "content_config": {}}],
        class_assignment_items=list(items),
        students=[{**_STUDENT, "user_id": "u1"}],
        course_writing_submissions=list(subs),
    )


async def _tally(items, subs, *, mark=None):
    calls = []
    def fake_mark(db, *, item_id, artifact_kind, artifact_id, score=None, now=None):
        calls.append((item_id, artifact_kind))
        if mark == "boom":
            raise RuntimeError("db down")
        return True
    with patch.object(adm, "require_admin", AsyncMock(return_value=None)), \
         patch.object(adm, "_require_cohort", lambda _c: None), \
         patch.object(adm, "supabase_admin", _tally_db(items, subs)), \
         patch.object(adm, "reconcile_ledger_from_sessions", lambda *a: None), \
         patch.object(adm, "reconcile_test_attempts", lambda *a: None), \
         patch.object(adm, "mark_item_submitted", fake_mark):
        return await adm.assignment_tally("co1", "a1", None), calls


@pytest.mark.asyncio
async def test_a_graded_writing_without_a_ledger_stamp_is_repaired_not_displayed_as_missing():
    """Chốt sổ lúc nộp là best-effort và có nuốt lỗi, nên một bài ĐÃ CHẤM vẫn có
    thể thiếu `submitted_at`. Không vá thì dòng ấy hiện "chưa nộp" mà lại có nút
    "Xem tự luận" — hai thứ mâu thuẫn trên cùng một dòng."""
    out, calls = await _tally(
        [{"id": "it1", "assignment_id": "a1", "student_id": "s1",
          "submitted_at": None, "score": None, "state": "opened",
          "artifact_kind": None, "artifact_id": None,
          "passed_at": None, "mastery": None}],
        [{"class_assignment_item_id": "it1"}])
    row = out["students"][0]
    assert row["has_writing"] is True
    assert row["status"] in ("submitted", "late"), "bài đã chấm LÀ một lượt nộp"
    assert out["counts"]["submitted"] == 1, "số đếm phải kể cả bài vừa vá"
    assert calls and calls[0][1] == "course_writing", "phải vá SỔ, không phải vá hiển thị"


@pytest.mark.asyncio
async def test_an_item_without_writing_is_left_alone():
    out, calls = await _tally(
        [{"id": "it1", "assignment_id": "a1", "student_id": "s1",
          "submitted_at": None, "score": None, "state": "opened",
          "artifact_kind": None, "artifact_id": None,
          "passed_at": None, "mastery": None}], [])
    assert out["students"][0]["has_writing"] is False
    assert calls == [], "không có bài thì đừng đóng dấu gì"


@pytest.mark.asyncio
async def test_a_failed_repair_says_stale_instead_of_lying_quietly():
    out, _ = await _tally(
        [{"id": "it1", "assignment_id": "a1", "student_id": "s1",
          "submitted_at": None, "score": None, "state": "opened",
          "artifact_kind": None, "artifact_id": None,
          "passed_at": None, "mastery": None}],
        [{"class_assignment_item_id": "it1"}], mark="boom")
    assert out["homework_stale"] is True
