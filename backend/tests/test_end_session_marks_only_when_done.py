"""Chốt sổ bài giao khi XONG BÀI, không phải khi xong MỘT chặng.

Hai học viên thật đã dính lỗi cũ:
  · em Phương Anh Nguyễn — 9/9 chặng, 0 câu tự luận, sổ ghi `graded` 80
  · em Minh Ngoc Võ      — 3/9 chặng, chưa đạt,      sổ ghi `graded` 60

Vá lần một chỉ chắn bộ đề CÓ tự luận nên ca thứ hai vẫn lọt. Đây là vá tận gốc.

Chốt CHẠY THẬT với cơ sở dữ liệu giả — và bộ giả CHIẾU ĐÚNG CỘT như PostgREST,
vì một bộ giả dễ dãi hơn thật thì che mất đúng loại lỗi mình đang đi tìm (bài
học PR #952: một bản vá vô hiệu vì thiếu cột trong `select` mà chốt quét chữ
vẫn xanh).
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from services import quiz_service as qs

BANK = "bank-1"
ITEM = "it-1"


def _project(rows, cols):
    if not cols or "*" in cols:
        return [dict(r) for r in rows]
    want = [c.strip() for c in cols.replace("\n", " ").split(",") if c.strip()]
    return [{k: r.get(k) for k in want} for r in rows]


class _Q:
    def __init__(self, rows, cols="*", count_only=False):
        self._rows, self._cols, self._count = list(rows), cols, count_only

    def eq(self, c, v):
        return _Q([r for r in self._rows if r.get(c) == v], self._cols, self._count)

    def in_(self, c, vs):
        return _Q([r for r in self._rows if r.get(c) in set(vs)], self._cols, self._count)

    @property
    def not_(self):
        outer = self

        class _Not:
            def is_(self, c, _v):
                # `not_.is_(col, "null")` = cột KHÁC NULL.
                return _Q([r for r in outer._rows if r.get(c) is not None],
                          outer._cols, outer._count)
        return _Not()

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a):
        return self

    def range(self, a, b):
        return _Q(self._rows[a:b + 1], self._cols, self._count)

    def execute(self):
        class R:
            pass
        r = R()
        r.data = _project(self._rows, self._cols)
        r.count = len(self._rows)
        return r


class _DB:
    def __init__(self, tables):
        self.t = tables

    def table(self, name):
        rows = self.t.get(name, [])

        class T:
            def select(self, cols="*", **kw):
                return _Q(rows, cols, kw.get("count") == "exact")
        return T()


def _db(*, questions, sessions, attempts=()):
    return _DB({
        "quiz_questions": [{"bank_id": BANK, **q} for q in questions],
        "quiz_sessions": list(sessions),
        "quiz_attempts": list(attempts),
    })


def _sess(sid, *, kind="run", ended_by="completed", item=ITEM):
    return {"id": sid, "kind": kind, "class_assignment_item_id": item,
            "ended_by": ended_by, "ended_at": "2026-08-01T00:00:00Z"}


def _covers(sid, qids):
    return [{"session_id": sid, "qid": q} for q in qids]


def _mcq(n):
    return [{"qid": f"q{i}", "type": "mcq"} for i in range(n)]


@pytest.fixture(autouse=True)
def _quiet():
    yield


def _done(db):
    with patch.object(qs, "supabase_admin", db):
        return qs._course_work_is_done({"bank_id": BANK}, ITEM)


def test_one_stage_out_of_two_is_NOT_done():
    """Ca em Minh Ngoc Võ: 3/9 chặng mà sổ ghi "đã nộp" điểm 60."""
    db = _db(questions=_mcq(20), sessions=[_sess("s1")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)]))
    assert _done(db) is False


def test_every_question_answered_IS_done():
    db = _db(questions=_mcq(20), sessions=[_sess("s1"), _sess("s2")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)])
             + _covers("s2", [f"q{i}" for i in range(10, 20)]))
    assert _done(db) is True


def test_TWO_sessions_on_the_SAME_stage_are_not_two_stages():
    """Một chặng sinh nhiều phiên là chuyện thường: tải lại trang, mở hai tab,
    làm lại chặng. Em Minh Ngoc Võ có 7 phiên cho 3 chặng.

    Đếm dòng phiên thì hai phiên cùng phủ câu 1–10 đã đủ "2 chặng" và bài bị
    chốt trong khi câu 11–20 chưa ai làm (codex cục bộ 06/08)."""
    db = _db(questions=_mcq(20), sessions=[_sess("s1"), _sess("s2")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)])
             + _covers("s2", [f"q{i}" for i in range(10)]))
    assert _done(db) is False


def test_a_paused_session_is_not_a_finished_stage():
    """`ended_at` có mặt cả khi học viên chỉ TẠM DỪNG — phải hỏi `ended_by`."""
    db = _db(questions=_mcq(20),
             sessions=[_sess("s1"), _sess("s2", ended_by="paused")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)])
             + _covers("s2", [f"q{i}" for i in range(10, 20)]))
    assert _done(db) is False


def test_a_bank_with_writing_is_never_done_here():
    """Ca em Phương Anh Nguyễn: xong hết chặng vẫn còn mười câu chưa động tới."""
    db = _db(questions=_mcq(20) + [{"qid": "w1", "type": "writing"}],
             sessions=[_sess("s1"), _sess("s2")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)])
             + _covers("s2", [f"q{i}" for i in range(10, 20)]))
    assert _done(db) is False


def test_the_writing_check_reads_the_SAME_fetch_not_a_cache():
    """Bộ nhập cập nhật lại ĐÚNG `bank_id` rồi thay bộ câu hỏi. Một giá trị nhớ
    từ trước re-import sai theo cả hai chiều: nhớ "có" thì bài kẹt vĩnh viễn khi
    phần viết bị bỏ; nhớ "không" thì chốt sổ trước phần viết vừa thêm."""
    import inspect
    src = inspect.getsource(qs._course_work_is_done)
    assert "_course_bank_shape(bank_id)" in src
    assert "bank_has_writing" not in src, "đừng hỏi qua đường có cache"


def test_retake_sessions_do_not_count():
    db = _db(questions=_mcq(20),
             sessions=[_sess("s1"), _sess("s2", kind="retake")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)])
             + _covers("s2", [f"q{i}" for i in range(10, 20)]))
    assert _done(db) is False


def test_sessions_of_ANOTHER_assignment_item_do_not_count():
    """Giao lại cùng bộ bài là một lượt khác (mig 192)."""
    db = _db(questions=_mcq(20),
             sessions=[_sess("s1"), _sess("s2", item="it-KHAC")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)])
             + _covers("s2", [f"q{i}" for i in range(10, 20)]))
    assert _done(db) is False


def test_a_short_bank_needs_only_its_own_questions():
    """Bộ đề 5 câu chỉ có MỘT chặng — đừng bắt nó chờ chín chặng không tồn tại."""
    db = _db(questions=_mcq(5), sessions=[_sess("s1")],
             attempts=_covers("s1", [f"q{i}" for i in range(5)]))
    assert _done(db) is True


def test_an_unreadable_bank_is_not_treated_as_done():
    """Fail closed: submitted_at bất biến, nên đoán xong sớm không vá được.

    Việc chưa đóng dấu có thể đối chiếu lại khi dữ liệu đọc được; đóng
    dấu ngay ở chặng đầu thì làm sai vĩnh viễn mốc nộp của học viên.
    """
    class _Boom(_DB):
        def table(self, name):
            if name == "quiz_questions":
                raise RuntimeError("mạng đứt")
            return super().table(name)
    assert _done(_Boom({})) is False


def test_a_failed_attempt_read_is_not_treated_as_done():
    class _Boom(_DB):
        def table(self, name):
            if name == "quiz_attempts":
                raise RuntimeError("mạng đứt")
            return super().table(name)
    db = _Boom({"quiz_questions": [{"bank_id": BANK, **q} for q in _mcq(20)],
                "quiz_sessions": [_sess("s1")]})
    assert _done(db) is False


def test_nothing_finished_yet_is_NOT_done():
    db = _db(questions=_mcq(20), sessions=[], attempts=[])
    assert _done(db) is False


def test_end_session_asks_before_marking():
    """Ghim ĐƯỜNG, không chỉ ghim hàm: một `_course_work_is_done` không ai gọi
    thì vô dụng."""
    import inspect
    src = inspect.getsource(qs.end_session)
    i = src.index("            mark_item_submitted(")
    assert "course_bank_is_multisection(" in src[:i], (
        "bank nhiều phần phải dành quyền chốt cho refresh_course_completion")
    assert "_course_work_is_done(" in src[:i], "phải hỏi TRƯỚC khi chốt sổ"
