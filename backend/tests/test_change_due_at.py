"""ĐỔI HẠN NỘP — đường trong sản phẩm cho việc ngày 07/08 phải chạy SQL tay.

Hai chốt được ghim ở đây, và cả hai đều học từ chính lần chạy tay ấy:

  · SO SÁNH RỒI ĐỔI — người gọi phải nêu hạn màn hình đang hiện, nếu không một
    lệnh ghi đè lặng lẽ sẽ thay giá trị mới hơn bằng giá trị cũ (codex #996);
  · NÓI RA SỐ HỒ SƠ BỊ VIẾT LẠI — "nộp trễ" là suy ra lúc đọc, nên dời hạn viết
    lại hồ sơ đúng-hạn của những người đã nộp, theo CẢ HAI chiều.
"""

from __future__ import annotations

import pytest

from services.class_assignment_service import (
    DueChangeRefused,
    change_assignment_due_at,
    compose_due_at,
    parse_due_time,
)

OLD = "2026-08-07T19:00:00+07:00"
NEW = "2026-08-09T19:00:00+07:00"


class _Resp:
    def __init__(self, data): self.data = data


class _Table:
    def __init__(self, name, rows, log):
        self._name, self._rows, self._log = name, rows, log
        self._f, self._patch, self._null = [], None, None

    def select(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def order(self, *_a, **_k): return self
    def range(self, *_a): return self

    def update(self, patch):
        self._patch = patch
        return self

    def eq(self, field, value):
        self._f.append((field, value))
        return self

    def is_(self, field, _null):
        self._f.append((field, None))
        return self

    def execute(self):
        hit = self._rows
        for f, v in self._f:
            hit = [r for r in hit if r.get(f) == v]
        if self._patch is None:
            return _Resp(hit)
        for r in hit:
            r.update(self._patch)
        self._log.append((self._name, dict(self._patch), len(hit)))
        return _Resp(hit)


def _db(asg, items, log=None):
    log = [] if log is None else log
    t = {"class_assignments": asg, "class_assignment_items": items}
    db = type("DB", (), {})()
    db.table = lambda n: _Table(n, t.get(n, []), log)
    db._log = log
    return db


def _asg(**over):
    return [{"id": "a1", "cohort_id": "c1", "due_at": OLD,
             "status": "published", "title": "Grammar 1", **over}]


def _items(*stamps):
    return [{"id": f"i{n}", "assignment_id": "a1", "submitted_at": s}
            for n, s in enumerate(stamps)]


def _change(db, **kw):
    kw.setdefault("assignment_id", "a1")
    kw.setdefault("cohort_id", "c1")
    kw.setdefault("new_due_at", NEW)
    kw.setdefault("expected_due_at", OLD)
    return change_assignment_due_at(db, **kw)


# ── Đường thường ────────────────────────────────────────────────────────────

def test_moving_a_deadline_nobody_is_late_for_just_works():
    # Đúng ca thật của lớp TUE-FRI hôm 07/08: 11 lượt nộp, tất cả trước 19:00.
    asg = _asg()
    out = _change(_db(asg, _items("2026-08-07T14:00:00+07:00",
                                  "2026-08-06T21:00:00+07:00")))
    assert out["due_at"] == NEW
    assert out["flips"] == {"to_ontime": 0, "to_late": 0}
    assert asg[0]["due_at"] == NEW


def test_the_deadline_can_be_cleared_entirely():
    asg = _asg()
    out = _change(_db(asg, _items()), new_due_at=None)
    assert out["due_at"] is None and asg[0]["due_at"] is None


def test_an_assignment_with_no_deadline_can_be_given_one():
    asg = _asg(due_at=None)
    out = _change(_db(asg, _items()), expected_due_at=None)
    assert out["due_at"] == NEW


# ── Viết lại hồ sơ: phải ĐẾM rồi mới hỏi ────────────────────────────────────

def test_pushing_the_deadline_later_would_erase_a_late_mark_and_is_refused():
    """Dời về sau biến lượt nộp trễ thành đúng hạn — xoá dấu trễ của họ."""
    db = _db(_asg(), _items("2026-08-08T10:00:00+07:00",      # trễ so với 07/08
                            "2026-08-07T10:00:00+07:00"))     # vốn đúng hạn
    with pytest.raises(DueChangeRefused) as e:
        _change(db)
    assert e.value.payload["needs_confirm"] is True
    assert e.value.payload["flips"] == {"to_ontime": 1, "to_late": 0}


def test_pulling_the_deadline_earlier_would_accuse_someone_and_is_refused():
    """Dời về trước biến lượt nộp đúng hạn thành trễ — buộc tội ngược thời gian."""
    db = _db(_asg(), _items("2026-08-07T18:00:00+07:00"))
    with pytest.raises(DueChangeRefused) as e:
        _change(db, new_due_at="2026-08-07T12:00:00+07:00")
    assert e.value.payload["flips"] == {"to_ontime": 0, "to_late": 1}


def test_a_refused_change_does_not_touch_the_row():
    asg = _asg()
    with pytest.raises(DueChangeRefused):
        _change(_db(asg, _items("2026-08-08T10:00:00+07:00")))
    assert asg[0]["due_at"] == OLD, "từ chối thì đừng ghi"


def test_confirming_lets_it_through_and_reports_what_it_rewrote():
    asg = _asg()
    out = _change(_db(asg, _items("2026-08-08T10:00:00+07:00")),
                  confirm_rewrites=True)
    assert asg[0]["due_at"] == NEW
    assert out["flips"] == {"to_ontime": 1, "to_late": 0}


def test_students_who_never_handed_in_are_not_counted_as_rewritten():
    # Hạn đổi thì "chưa nộp" vẫn là "chưa nộp" — đếm họ vào là báo động giả.
    out = _change(_db(_asg(), _items(None, None, "2026-08-07T09:00:00+07:00")))
    assert out["flips"] == {"to_ontime": 0, "to_late": 0}
    assert out["submitted_count"] == 1


# ── So sánh rồi đổi ─────────────────────────────────────────────────────────

def test_a_stale_screen_is_refused_instead_of_overwriting_a_newer_deadline():
    """Giữa lúc mở trang và lúc bấm, người khác đã đổi hạn. Ghi tiếp là thay
    một giá trị MỚI HƠN bằng cái cũ, im lặng (codex #996)."""
    asg = _asg(due_at="2026-08-10T19:00:00+07:00")
    with pytest.raises(DueChangeRefused, match="đã đổi từ lúc mở trang") as e:
        _change(_db(asg, _items()))
    assert e.value.payload["conflict"] is True
    assert asg[0]["due_at"] == "2026-08-10T19:00:00+07:00"


def test_the_same_instant_written_differently_is_not_a_conflict():
    # '+07:00' và 'Z' có thể là cùng một mốc; so chuỗi sẽ báo tranh chấp giả.
    asg = _asg(due_at="2026-08-07T12:00:00+00:00")
    out = _change(_db(asg, _items()), expected_due_at=OLD)
    assert out["due_at"] == NEW


def test_setting_the_deadline_it_already_has_is_refused_as_a_no_op():
    with pytest.raises(DueChangeRefused, match="giống hệt"):
        _change(_db(_asg(), _items()), new_due_at=OLD)


def test_an_assignment_from_another_class_is_not_found():
    with pytest.raises(DueChangeRefused, match="Không tìm thấy"):
        _change(_db(_asg(cohort_id="c-KHAC"), _items()))


# ── Giờ hạn dựng ở máy chủ, theo múi giờ Việt Nam ───────────────────────────

def test_the_deadline_is_composed_in_vietnam_time_not_the_browsers():
    # Một giáo viên đang ở nước ngoài không được vô tình đặt hạn theo múi giờ
    # của họ — cùng lý do `create_assignment` dựng giờ ở máy chủ.
    assert compose_due_at("2026-08-09", parse_due_time(None)).endswith("19:00:00+07:00")
    assert compose_due_at("2026-08-09", parse_due_time("21:30")).endswith("21:30:00+07:00")
    assert compose_due_at(None, parse_due_time("19:00")) is None
