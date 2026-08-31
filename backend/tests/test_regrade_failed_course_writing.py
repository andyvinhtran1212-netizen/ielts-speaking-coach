"""Chấm lại lượt nộp tự luận còn bất kỳ câu nào chưa chấm được.

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


def test_a_PARTIALLY_failed_submission_is_regraded_as_one_consistent_result():
    """Ba câu thật không biến mười hai câu lỗi thành một kết quả 3/15."""
    plan, db = _run([_sub("s1", [True] + [None] * 9)], grade_result=True, commit=True)
    assert len(plan) == 1 and plan[0]["failed_before"] == 9
    assert len(db.writes) == 1 and db.writes[0]["clean"] == 10


def test_a_regrade_that_ALSO_fails_writes_nothing():
    """Ghi đè một bản hỏng bằng một bản hỏng khác chỉ làm mất dấu vết lần đầu."""
    plan, db = _run([_sub("s1", [None] * 10)], grade_result=None, commit=True)
    assert len(plan) == 1 and plan[0]["fixed"] is False
    assert db.writes == []


def test_a_regrade_with_even_ONE_unresolved_item_writes_nothing():
    db = _DB([_sub("s1", [True] + [None] * 2)])

    async def partial(batch):
        rows = [{**b, "ok": True, "corrected": "x", "issues": []} for b in batch]
        rows[-1]["ok"] = None
        return rows, "model-mới"

    with patch.object(qs.course_writing_grader, "grade", partial):
        plan = asyncio.run(qs.regrade_failed_course_writing(db, commit=True))
    assert plan[0]["fixed"] is False
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


def test_targeted_regrade_only_reads_the_requested_submission():
    db = _DB([_sub("s1", [None]), _sub("s2", [None])])

    async def grade(batch):
        return [{**b, "ok": True} for b in batch], "m"

    with patch.object(qs.course_writing_grader, "grade", grade):
        plan = asyncio.run(qs.regrade_failed_course_writing(
            db, commit=True, submission_id="s2"))
    assert [p["id"] for p in plan] == ["s2"]
    assert [w["id"] for w in db.writes] == ["s2"]


def _writing_only(fn):
    """Khai HÌNH DẠNG BỘ ĐỀ tường minh cho các chốt về đồng bộ điểm.

    Bộ giả ở tệp này trả cùng một bảng cho mọi tên, nên `_course_bank_shape`
    không đọc được gì thật — và `bank_has_mcq` khi ấy trả True (chiều an toàn),
    làm những chốt này đỏ vì một lý do KHÔNG liên quan tới thứ chúng kiểm.
    Chúng nói về việc ĐỒNG BỘ điểm, không về việc dò hình dạng bộ đề.
    """
    return patch.object(qs, "bank_has_mcq", lambda _b: False)


def test_the_class_ledger_score_is_synced_too():
    """Lượt nộp hỏng đã ghi 0 vào `class_assignment_items.score`, và cả trang
    học viên lẫn bảng giáo viên đọc CỘT ẤY. Sửa mỗi bản chấm thì chi tiết nói
    9/10 còn sổ vẫn nói 0 — hai màn hình cãi nhau về cùng một em (codex #970).
    """
    row = _sub("s1", [None] * 10)
    row["class_assignment_item_id"] = "it-1"
    with _writing_only(None):
        _, db = _run([row], grade_result=True, commit=True)
    scores = [w for w in db.writes if "score" in w]
    assert scores and scores[0] == {"id": "it-1", "score": 100.0}, db.writes


def test_a_MIXED_bank_keeps_the_quiz_score_when_the_essay_is_regraded():
    """Bộ đề có trắc nghiệm ⇒ điểm của mục là kết quả trắc nghiệm
    (`course_verdict` ghi, `passed_at` xét trên số ấy). Chấm lại bài viết không
    được động vào nó — đây là người ghi THỨ TƯ trong cùng một họ lỗi, và chốt
    điểm-danh cũ hụt nó vì nó chia cho `len(graded)` chứ không cho `total`."""
    row = _sub("s1", [None] * 10)
    row["class_assignment_item_id"] = "it-1"
    with patch.object(qs, "bank_has_mcq", lambda _b: True):
        _, db = _run([row], grade_result=True, commit=True)
    assert [w for w in db.writes if "score" in w] == [], \
        "chấm lại bài viết đã ghi đè kết quả trắc nghiệm"


def test_a_submission_with_no_class_item_skips_the_ledger_write():
    """Bài tự luyện không gắn mục bài giao — không có sổ nào để đồng bộ."""
    row = _sub("s1", [None] * 10)
    row["class_assignment_item_id"] = None
    _, db = _run([row], grade_result=True, commit=True)
    assert [w for w in db.writes if "score" in w] == []


def test_a_failed_submission_write_does_NOT_sync_the_score():
    """Ghi bản chấm hỏng thì điểm cũ phải ở nguyên: đồng bộ một con số cho một
    bản chấm không tồn tại còn tệ hơn để nguyên."""
    class _Boom(_DB):
        def table(self, n):
            t = super().table(n)
            if n == "course_writing_submissions":
                orig = t.update
                def update(patch):
                    class _U:
                        def eq(self, *_a): return self
                        def execute(self): raise RuntimeError("ghi hỏng")
                    return _U()
                t.update = update
            return t
    row = _sub("s1", [None] * 10)
    row["class_assignment_item_id"] = "it-1"
    db = _Boom([row])
    async def fake_grade(batch):
        return ([{**b, "ok": True} for b in batch], "m")
    with patch.object(qs.course_writing_grader, "grade", fake_grade):
        plan = asyncio.run(qs.regrade_failed_course_writing(db, commit=True))
    assert plan[0]["fixed"] is False
    assert [w for w in db.writes if "score" in w] == []
