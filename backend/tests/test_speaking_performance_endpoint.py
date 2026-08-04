"""Mặt đọc hiệu suất Speaking — chạy qua ĐÚNG endpoint, không gọi hàm con.

Điều dễ sai nhất ở đây không phải phép tính, mà là TRÁCH NHẦM HỌC VIÊN: một bài
giao đã bị lưu trữ (giáo viên giao nhầm, lớp nghỉ) mà vẫn đếm những em còn lại là
"bỏ bài" sẽ làm cờ "đang đuối" nổ oan.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from routers import admin_class_assignments as mod

_NOW = datetime.now(timezone.utc)
_PAST = (_NOW - timedelta(days=3)).isoformat()


class _Resp:
    def __init__(self, data): self.data = data


class _Table:
    def __init__(self, rows):
        self._rows = list(rows)

    def select(self, *_a, **_k): return self

    def eq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self

    def in_(self, f, vals):
        self._rows = [r for r in self._rows if r.get(f) in vals]
        return self

    def order(self, *_a, **_k): return self
    def limit(self, *_a): return self

    def range(self, s, e):
        self._rows = self._rows[s:e + 1]
        return self

    def execute(self): return _Resp(self._rows)


def _db(assignments, items, students, responses=()):
    tables = {
        "cohorts": [{"id": "co-1", "name": "Lớp A", "course_id": "c-1"}],
        "class_assignments": list(assignments),
        "class_assignment_items": list(items),
        "students": list(students),
        "responses": list(responses),
    }
    db = type("DB", (), {})()
    db.table = lambda n: _Table(tables.get(n, []))
    return db


def _asg(aid, status="published"):
    return {"id": aid, "title": aid, "kind": "daily", "status": status,
            "skill": "speaking", "cohort_id": "co-1",
            "due_at": _PAST, "created_at": _PAST}


def _item(aid, sid, submitted=False):
    return {"id": f"{aid}-{sid}", "assignment_id": aid, "student_id": sid,
            "submitted_at": _PAST if submitted else None,
            "score": 6.0 if submitted else None,
            "artifact_id": None, "artifact_kind": "session"}


_STU = [{"id": "st-1", "full_name": "Lan", "student_code": "A1", "user_id": "u1"}]


async def _run(db):
    with patch.object(mod, "supabase_admin", db), \
         patch.object(mod, "require_admin", new=lambda *_a, **_k: _async({"id": "admin"})):
        return await mod.speaking_performance("co-1", authorization="Bearer x")


def _async(v):
    async def _f(): return v
    return _f()


@pytest.mark.asyncio
async def test_two_missed_PUBLISHED_gives_raise_the_falling_behind_flag():
    """Chốt xuôi: không có nó thì test dưới xanh kể cả khi cờ bị tắt hoàn toàn."""
    db = _db([_asg("a1"), _asg("a2")],
             [_item("a1", "st-1"), _item("a2", "st-1")], _STU)
    out = await _run(db)
    codes = [f["code"] for f in out["items"][0]["student_flags"]]
    assert "falling_behind" in codes
    assert out["items"][0]["missing"] == 2


@pytest.mark.asyncio
async def test_an_ARCHIVED_give_does_not_count_as_the_student_missing_work():
    """Lưu trữ là cách ĐÓNG một bài giao khi xoá đã bị chặn — giao nhầm, đổi kế
    hoạch, lớp nghỉ. Đếm những em còn lại là "bỏ bài" ở đó là trách các em vì một
    quyết định của giáo viên."""
    db = _db([_asg("a1", status="archived"), _asg("a2", status="archived")],
             [_item("a1", "st-1"), _item("a2", "st-1")], _STU)
    out = await _run(db)
    assert out["items"][0]["student_flags"] == []
    assert out["items"][0]["missing"] == 0


@pytest.mark.asyncio
async def test_work_actually_DONE_on_an_archived_give_still_counts():
    """Bài đã nộp trong một bài giao đã lưu trữ vẫn là việc thật các em đã làm.
    Bỏ luôn điểm sẽ xoá mất lịch sử của em ấy."""
    db = _db([_asg("a1", status="archived")],
             [_item("a1", "st-1", submitted=True)], _STU)
    out = await _run(db)
    assert out["items"][0]["bands"] == [6.0]
    assert out["items"][0]["submitted"] == 1


@pytest.mark.asyncio
async def test_a_student_with_no_account_gets_no_pedagogical_flag():
    """Em ấy CHƯA TỪNG thấy bài nào, nên "bỏ bài" là nói sai về em."""
    stu = [{**_STU[0], "user_id": None}]
    db = _db([_asg("a1"), _asg("a2")],
             [_item("a1", "st-1"), _item("a2", "st-1")], stu)
    out = await _run(db)
    assert out["items"][0]["student_flags"] == []
    assert out["items"][0]["activated"] is False


@pytest.mark.asyncio
async def test_a_class_with_no_speaking_gives_returns_empty_not_an_error():
    out = await _run(_db([], [], _STU))
    assert out == {"items": [], "assignment_count": 0}
