"""Hai mặt đọc phải cho CÙNG con số, kể cả khi client nói dối.

Chốt này CHẠY THẬT cả hai hàm với một cơ sở dữ liệu giả, thay vì quét chữ trong
mã. Lý do rất cụ thể: bản vá trước ghim bằng `'int(a.get("answer_given")) ==
want' in src` — và nó XANH trong khi bản vá hoàn toàn vô hiệu, vì cột
`answer_given` không hề có trong `select`. Quét chữ không nhìn thấy một cột
thiếu; chạy thật thì thấy ngay.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from services import quiz_service as qs

BANK = "bank-1"
ASG = "asg-1"
USER = "u1"
ITEM = "it-1"


class _Q:
    """Truy vấn giả: đủ để phục vụ `_report_pages` và các lượt `.select()`."""

    def __init__(self, rows, count_only=False, cols="*"):
        self._rows = list(rows)
        self._count_only = count_only
        self._cols = cols

    def eq(self, col, val):
        return _Q([r for r in self._rows if r.get(col) == val],
                  self._count_only, self._cols)

    def in_(self, col, vals):
        return _Q([r for r in self._rows if r.get(col) in set(vals)],
                  self._count_only, self._cols)

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a):
        return self

    def range(self, a, b):
        return _Q(self._rows[a:b + 1], self._count_only, self._cols)

    def execute(self):
        class R:
            pass
        r = R()
        r.data = _project(self._rows, self._cols)
        r.count = len(self._rows)
        return r


def _project(rows, cols):
    """Chỉ trả những cột được NÊU TÊN — y như PostgREST.

    Bộ giả đầu tiên của tôi trả nguyên dòng, và vì thế nó KHÔNG phát hiện được
    một cột thiếu trong `select`. Đó đúng là lỗi bản vá trước mắc phải
    (`answer_given` không có trong select nên `_ok()` luôn rơi về cờ client), và
    một bộ giả dễ dãi hơn thật thì che mất đúng loại lỗi mình đang đi tìm.
    """
    if not cols or "*" in cols:
        return [dict(r) for r in rows]
    want = [c.strip() for c in cols.replace("\n", " ").split(",") if c.strip()]
    return [{k: r.get(k) for k in want} for r in rows]


class _DB:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        rows = self.tables.get(name, [])

        class T:
            def select(self, cols="*", **kw):
                # LỌC trên dòng đầy đủ, nhưng TRẢ VỀ bản đã chiếu: PostgREST cũng
                # lọc được theo cột không nằm trong `select`.
                return _Q(rows, kw.get("count") == "exact", cols)
        return T()


def _attempt(qid, given, client_says, *, item_key, ms=10_000, at="2026-08-01T00:00:00Z"):
    return {"session_id": "s1", "user_id": USER, "qid": qid, "item_key": item_key,
            "is_correct": client_says, "answer_given": given,
            "response_time_ms": ms, "created_at": at}


def _db(attempts, questions):
    # `bank_id` phải có trên TỪNG câu: mọi lượt đọc đề đều lọc theo nó, và thiếu
    # nó thì bảng đề đọc ra RỖNG — lúc ấy `_ok()` lặng lẽ rơi về cờ client và
    # phép kiểm này đo một đường không chạy. (Chính bộ dữ liệu giả đầu tiên của
    # tôi mắc lỗi ấy.)
    questions = [{"bank_id": BANK, **q} for q in questions]
    return _DB({
        "class_assignment_items": [{"id": ITEM, "student_id": "st-1",
                                    "assignment_id": ASG}],
        "students": [{"id": "st-1", "user_id": USER}],
        "quiz_sessions": [{"id": "s1", "user_id": USER, "bank_id": BANK,
                           "kind": "run", "class_assignment_item_id": ITEM,
                           "ended_at": "2026-08-01T01:00:00Z", "duration_sec": 600,
                           "total_questions": 99, "total_correct": 99,
                           "created_at": "2026-08-01T00:00:00Z"}],
        "quiz_attempts": attempts,
        "quiz_questions": questions,
        "quiz_banks": [{"id": BANK, "title": "Buổi thử"}],
    })


@pytest.fixture
def _no_gate():
    with patch.object(qs, "_bank_meta_or_404", lambda *_a, **_k: {"title": "Buổi thử",
                                                                 "skill_area": "course"}):
        yield


def _both(db):
    with patch.object(qs, "supabase_admin", db):
        table = qs.course_attempt_report(bank_id=BANK, assignment_id=ASG)
        one = qs.course_answer_report(user_id=USER, bank_id=BANK, assignment_id=ASG)
    return table, one


def test_a_lying_client_flag_is_ignored_by_BOTH_surfaces(_no_gate):
    """Đáp án thật là 0, học viên gửi `answer_given="1"` kèm `is_correct=true`.
    Cả hai mặt đọc phải chấm SAI."""
    db = _db(
        [_attempt("q1", "1", True, item_key="trục A")],
        [{"qid": "q1", "type": "mcq", "answer": 0, "item_key": "trục A",
          "options": ["A", "B"], "prompt": "p", "order": 1}],
    )
    table, one = _both(db)
    assert one["questions"][0]["is_correct"] is False, "báo cáo từng em phải chấm sai"
    row = table["students"][0]
    assert (row["correct"], row["questions"]) == (0, 1), \
        f"bảng lớp phải chấm sai, đang là {row['correct']}/{row['questions']}"
    assert (row["correct"], row["questions"]) == (one["totals"]["correct"],
                                                  one["totals"]["answered"])


def test_a_lying_item_key_does_not_move_the_class_axis(_no_gate):
    """Câu thuộc trục "Mệnh đề quan hệ", client khai "Từ vựng". Bảng của giáo
    viên không được đổi theo lời khai ấy."""
    db = _db(
        [_attempt("q1", "1", False, item_key="Từ vựng")],
        [{"qid": "q1", "type": "mcq", "answer": 0, "item_key": "Mệnh đề quan hệ",
          "options": ["A", "B"], "prompt": "p", "order": 1}],
    )
    table, one = _both(db)
    assert table["axes"][0]["axis"] == "Mệnh đề quan hệ"
    assert one["questions"][0]["item_key"] == "Mệnh đề quan hệ"


def test_a_correct_answer_is_still_correct(_no_gate):
    """Đừng chấm sai tất cả cho chắc."""
    db = _db(
        [_attempt("q1", "0", False, item_key="trục A")],   # client khai SAI
        [{"qid": "q1", "type": "mcq", "answer": 0, "item_key": "trục A",
          "options": ["A", "B"], "prompt": "p", "order": 1}],
    )
    table, one = _both(db)
    assert one["questions"][0]["is_correct"] is True
    assert table["students"][0]["correct"] == 1


def test_only_the_FIRST_attempt_counts_on_both_surfaces(_no_gate):
    """Làm lại một chặng không được tính câu ấy hai lần."""
    db = _db(
        [_attempt("q1", "0", True, item_key="trục A", at="2026-08-01T00:00:00Z"),
         _attempt("q1", "1", False, item_key="trục A", at="2026-08-01T00:05:00Z")],
        [{"qid": "q1", "type": "mcq", "answer": 0, "item_key": "trục A",
          "options": ["A", "B"], "prompt": "p", "order": 1}],
    )
    table, one = _both(db)
    assert one["totals"]["answered"] == 1
    assert table["students"][0]["questions"] == 1
    assert one["questions"][0]["is_correct"] is True, "lượt ĐẦU là lượt đúng"
