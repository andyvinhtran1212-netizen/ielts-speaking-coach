"""Chấm lại lượt nộp tự luận mà bộ chấm đã hỏng HOÀN TOÀN.

Lượt nộp tự luận chỉ có MỘT. Bộ chấm hỏng thì dòng vẫn được ghi với mọi câu
`ok=None` — bài còn nguyên nhưng lượt đã tiêu, và không đường nào chấm lại.
Ngày 06/08 model `gemini-2.5-flash-lite` bị ngừng cấp và NĂM học viên mất lượt
duy nhất của mình.
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

from services import quiz_service as qs


class _Q:
    def __init__(self, rows, cols="*"):
        self._rows, self._cols = list(rows), cols

    def eq(self, c, v): return _Q([r for r in self._rows if r.get(c) == v], self._cols)
    def order(self, *_a, **_k): return self
    def range(self, a, b): return _Q(self._rows[a:b + 1], self._cols)

    def execute(self):
        class R: pass
        r = R(); r.data = [dict(x) for x in self._rows]; return r


class _DB:
    def __init__(self, rows):
        self.rows, self.writes = rows, []

    def table(self, _n):
        db = self
        class T:
            def select(self, cols="*", **_k): return _Q(db.rows, cols)
            def update(self, patch):
                class _U:
                    def eq(self, _c, v): self._id = v; return self
                    def execute(_s):
                        db.writes.append({"id": _s._id, **patch})
                        class R: data = []
                        return R()
                return _U()
        return T()


def _sub(sid, oks):
    return {"id": sid, "user_id": "u1", "bank_id": "b1", "total": len(oks),
            "clean": sum(1 for o in oks if o is True), "graded_at": "2026-08-06T00:00:00+00:00",
            "items": [{"qid": f"w{i}", "prompt": "đề", "answer": "câu em viết",
                       "explain": "", "ok": o} for i, o in enumerate(oks)]}


def _run(rows, *, grade_result, commit=False):
    db = _DB(rows)
    async def fake_grade(batch):
        return ([{**b, "ok": grade_result, "corrected": "x", "issues": []} for b in batch],
                "model-mới")
    with patch.object(qs.course_writing_grader, "grade", fake_grade):
        return asyncio.run(qs.regrade_failed_course_writing(db, commit=commit)), db


def test_a_fully_failed_submission_is_regraded():
    plan, db = _run([_sub("s1", [None] * 10)], grade_result=True, commit=True)
    assert len(plan) == 1 and plan[0]["clean"] == 10
    assert len(db.writes) == 1 and db.writes[0]["clean"] == 10


def test_a_submission_that_graded_even_ONE_question_is_left_alone():
    """Một bản chấm thật, dù chỉ một câu. Chấm lại nó là ghi đè kết quả của học
    viên bằng một lượt gọi model khác."""
    plan, db = _run([_sub("s1", [True] + [None] * 9)], grade_result=True, commit=True)
    assert plan == [] and db.writes == []


def test_a_regrade_that_ALSO_fails_writes_nothing():
    """Ghi đè một bản hỏng bằng một bản hỏng khác chỉ làm mất dấu vết lần đầu."""
    plan, db = _run([_sub("s1", [None] * 10)], grade_result=None, commit=True)
    assert len(plan) == 1 and plan[0]["fixed"] is False
    assert db.writes == []


def test_dry_run_is_the_default_and_writes_nothing():
    plan, db = _run([_sub("s1", [None] * 10)], grade_result=True)
    assert len(plan) == 1 and db.writes == []


def test_it_regrades_the_SAVED_answers_not_new_input():
    """Đây là sửa một lượt CHẤM hỏng, không phải mở lại một lượt NỘP."""
    seen = {}
    db = _DB([_sub("s1", [None] * 2)])
    async def fake_grade(batch):
        seen["answers"] = [b["answer"] for b in batch]
        return ([{**b, "ok": True} for b in batch], "m")
    with patch.object(qs.course_writing_grader, "grade", fake_grade):
        asyncio.run(qs.regrade_failed_course_writing(db, commit=True))
    assert seen["answers"] == ["câu em viết", "câu em viết"]


def test_an_empty_items_list_is_skipped():
    plan, _ = _run([{"id": "s1", "user_id": "u1", "items": [], "total": 0, "clean": 0}],
                   grade_result=True)
    assert plan == []
