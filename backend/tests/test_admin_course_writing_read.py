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
