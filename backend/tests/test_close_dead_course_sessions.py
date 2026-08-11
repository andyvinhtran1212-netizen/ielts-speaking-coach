"""Đóng sổ phiên bài-theo-buổi đã chết — biến khoảng LƠ LỬNG thành BẢN GHI.

Học viên báo "em có làm lại vài chặng" mà web không ghi lại. Đúng: một phiên bỏ
giữa chừng có `ended_at` NULL, nên nó không phải bản ghi mà cũng chẳng ai đang
làm. Nó không hiện ở đâu cả.

Đo prod 06/08: 29 phiên như vậy mang 90 câu đã trả lời. Các CÂU không mất
(`course_answer_report` đọc mọi phiên 'run'); thứ mất là CÔNG SỨC — không chỗ
nào nói em ấy đã làm chặng này ba lần.

Nguy hiểm của lượt quét này nằm ở chiều ngược lại: một phiên vừa mở hai phút
trước cũng có `ended_at` NULL, vì em ấy ĐANG LÀM. Đóng nó là cướp bài khỏi tay
người đang viết. Phần lớn chốt dưới đây canh đúng chuyện đó.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from services import quiz_service as qs

ITEM = "item-1"


def _iso(minutes_ago):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


class _Q:
    def __init__(self, rows, cols="*"):
        self._rows, self._cols = list(rows), cols

    def eq(self, c, v):
        return _Q([r for r in self._rows if r.get(c) == v], self._cols)

    def in_(self, c, vs):
        return _Q([r for r in self._rows if r.get(c) in set(vs)], self._cols)

    def is_(self, c, _v):
        return _Q([r for r in self._rows if r.get(c) is None], self._cols)

    @property
    def not_(self):
        outer = self

        class _N:
            def is_(self, c, _v):
                return _Q([r for r in outer._rows if r.get(c) is not None], outer._cols)
        return _N()

    def order(self, *_a, **_k):
        return self

    def range(self, a, b):
        return _Q(self._rows[a:b + 1], self._cols)

    def execute(self):
        class R:
            pass
        r = R()
        want = ([c.strip() for c in self._cols.replace("\n", " ").split(",")]
                if self._cols != "*" else None)
        r.data = ([{k: x.get(k) for k in want} for x in self._rows] if want
                  else [dict(x) for x in self._rows])
        return r


class _DB:
    def __init__(self, t):
        self.t, self.writes = t, []

    def table(self, name):
        rows = self.t.get(name, [])
        db = self

        class T:
            def select(self, cols="*", **_k):
                return _Q(rows, cols)

            def update(self, patch):
                class _U:
                    def __init__(self):
                        self._only_null = False

                    def eq(self, c, v):
                        self._id = v
                        return self

                    def is_(self, c, _v):
                        self._only_null = True
                        return self

                    def execute(_self):
                        row = next((r for r in rows if r["id"] == _self._id), None)
                        # Luỹ đẳng: chỉ ghi khi CHƯA đóng, đúng như PostgREST.
                        if row is not None and not (_self._only_null and row.get("ended_at")):
                            db.writes.append({"id": _self._id, **patch})

                        class R:
                            data = []
                        return R()
                return _U()
        return T()


def _sess(sid, *, started, ended_at=None, item=ITEM, user="u1"):
    return {"id": sid, "user_id": user, "bank_id": "b1", "kind": "run",
            "ended_at": ended_at, "started_at": started, "created_at": started,
            "class_assignment_item_id": item}


def _att(sid, qids, *, when, correct=True):
    return [{"session_id": sid, "qid": q, "is_correct": correct, "created_at": when}
            for q in qids]


def _run(sessions, attempts, **kw):
    db = _DB({"quiz_sessions": sessions, "quiz_attempts": attempts})
    with patch.object(qs, "supabase_admin", db):
        return qs.close_dead_course_sessions(db, **kw), db


def test_a_stage_the_student_walked_away_from_becomes_a_RECORD():
    plan, _ = _run([_sess("s1", started=_iso(300)),
                    _sess("s2", started=_iso(200), ended_at=_iso(190))],
                   _att("s1", ["q0", "q1", "q2"], when=_iso(290)))
    assert len(plan) == 1 and plan[0]["session_id"] == "s1"
    assert plan[0]["total_questions"] == 3


def test_a_session_the_student_may_STILL_be_working_on_is_left_alone():
    """Đây là chiều nguy hiểm: đóng nó là cướp bài khỏi tay người đang viết."""
    plan, _ = _run([_sess("s1", started=_iso(20)),
                    _sess("s2", started=_iso(10), ended_at=_iso(5))],
                   _att("s1", ["q0"], when=_iso(3)))     # vừa gõ 3 phút trước
    assert plan == []


def test_idleness_counts_from_the_LAST_ANSWER_not_from_when_it_opened():
    """Một phiên mở từ sáng mà vẫn đang gõ thì vẫn sống."""
    plan, _ = _run([_sess("s1", started=_iso(600)),
                    _sess("s2", started=_iso(500), ended_at=_iso(490))],
                   _att("s1", ["q0"], when=_iso(5)))
    assert plan == []


def test_without_a_LATER_session_nothing_proves_they_walked_away():
    """Không có phiên nào sau nó thì rất có thể em ấy sẽ mở lại và làm tiếp —
    và đường khôi phục sẽ trả đúng phiên này về."""
    plan, _ = _run([_sess("s1", started=_iso(600))],
                   _att("s1", ["q0", "q1"], when=_iso(590)))
    assert plan == []


def test_an_empty_session_is_not_touched():
    """Không có câu nào thì chẳng có công sức gì để ghi lại."""
    plan, _ = _run([_sess("s1", started=_iso(600)),
                    _sess("s2", started=_iso(500), ended_at=_iso(490))], [])
    assert plan == []


def test_it_is_marked_ABANDONED_never_completed():
    """`completed` là thứ mọi phép đếm chặng và xét đạt lọc theo. Gọi một chặng
    bỏ dở là 'đã chốt' sẽ chốt sổ cho bài chưa làm xong."""
    _, db = _run([_sess("s1", started=_iso(300)),
                  _sess("s2", started=_iso(200), ended_at=_iso(190))],
                 _att("s1", ["q0"], when=_iso(290)), commit=True)
    assert len(db.writes) == 1
    assert db.writes[0]["ended_by"] == "abandoned"


def test_dry_run_is_the_DEFAULT_and_writes_nothing():
    """Một lượt quét ghi vào bảng của học viên không được là lượt chạy đầu tiên
    ai đó nhìn thấy."""
    plan, db = _run([_sess("s1", started=_iso(300)),
                     _sess("s2", started=_iso(200), ended_at=_iso(190))],
                    _att("s1", ["q0"], when=_iso(290)))
    assert len(plan) == 1 and db.writes == []


def test_the_write_only_fires_while_ended_at_is_still_NULL():
    """Hai lượt quét chạy chồng nhau, hay một lượt chạy lại, không được đè lên
    một phiên đã đóng — kể cả đóng bằng 'completed'."""
    import inspect
    src = inspect.getsource(qs.close_dead_course_sessions)
    assert '.is_("ended_at", "null")' in src


def test_the_totals_count_each_question_ONCE_and_keep_the_FIRST_answer():
    """Đẩy lại hàng đợi sau khi mất mạng có thể ghi trùng.

    Phải ghim CẢ HAI con số. Ghim mỗi `total_questions` là chốt xanh nhầm: nó
    đếm bằng tập nên trùng lặp tự biến mất, còn `total_correct` thì không —
    bỏ phép khử trùng đi và một câu sai-rồi-sửa-đúng sẽ tính thành đúng.

    Lượt ĐẦU mới là lần em ấy thật sự nghĩ, đúng luật `course_answer_report`.
    """
    plan, _ = _run([_sess("s1", started=_iso(300)),
                    _sess("s2", started=_iso(200), ended_at=_iso(190))],
                   [{"session_id": "s1", "qid": "q0", "is_correct": False,
                     "created_at": _iso(295)},
                    {"session_id": "s1", "qid": "q1", "is_correct": True,
                     "created_at": _iso(294)},
                    {"session_id": "s1", "qid": "q0", "is_correct": True,
                     "created_at": _iso(293)}])
    assert plan[0]["total_questions"] == 2
    assert plan[0]["total_correct"] == 1, "lượt đầu của q0 là SAI"


def test_sessions_of_ANOTHER_item_do_not_count_as_walking_away():
    """Em ấy mở bài giao KHÁC không có nghĩa đã bỏ bài này."""
    plan, _ = _run([_sess("s1", started=_iso(600)),
                    _sess("s2", started=_iso(500), ended_at=_iso(490), item="item-2")],
                   _att("s1", ["q0"], when=_iso(590)))
    assert plan == []
