"""Bài của MỘT em, đọc từ ngăn kéo sổ điểm danh — CHẠY HÀM THẬT.

Giáo viên bấm vào tên một em để hỏi "em này đã làm gì, cho tôi xem". Cho tới
nay ngăn kéo chỉ ra ba dòng dữ kiện và không hành động nào, nên câu hỏi ấy
không có đường trả lời.

── Vì sao chốt này DỰNG DB GIẢ VÀ GỌI HÀM ─────────────────────────────────────
Các chốt sẵn có cho router này soi CHỮ trong mã (`inspect.getsource`). Chữ đúng
mà logic sai — xếp nhầm thứ tự, lọc nhầm cột, hai mặt đọc suy trạng thái khác
nhau — thì chốt vẫn xanh. Ở đây cái sai sẽ là "màn này bảo em ấy chưa nộp, màn
kia bảo nộp trễ", nên phải nạp dữ liệu vào và đọc kết quả ra.

Ba bộ đối chiếu bị chặn: chúng đọc Supabase THẬT qua `supabase_admin` import
riêng của từng module, và mạng đứt thì bộ test TREO chứ không đỏ.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

import routers.admin_class_assignments as adm


# ── DB giả: đúng những bảng và phép lọc endpoint này dùng ───────────────────

class _Q:
    def __init__(self, rows, fail=False):
        self._rows = list(rows)
        self._fail = fail

    def select(self, *_a, **_k):
        return self

    def eq(self, field, value):
        self._rows = [r for r in self._rows if r.get(field) == value]
        return self

    def in_(self, field, values):
        vals = set(values)
        self._rows = [r for r in self._rows if r.get(field) in vals]
        return self

    def order(self, field, desc=False):
        # `_paged` xếp theo `id` để cửa sổ phân trang ổn định. Giả đúng thế —
        # một ô thử KHÔNG xếp sẽ để lọt lỗi phân trang trùng/thiếu dòng.
        self._rows.sort(key=lambda r: str(r.get(field, "")), reverse=desc)
        return self

    def range(self, start, end):
        self._rows = self._rows[start:end + 1]
        return self

    def limit(self, n):
        self._rows = self._rows[:n]
        return self

    def execute(self):
        if self._fail:
            raise RuntimeError("đọc hỏng")
        return type("R", (), {"data": self._rows})()


class _DB:
    def __init__(self, tables, fail_tables=()):
        self.tables = tables
        self.fail = set(fail_tables)

    def table(self, name):
        return _Q(self.tables.get(name, []), fail=name in self.fail)


COHORT = "co-1"
SID = "st-1"

# `cohort_id` là SỔ ĐIỂM DANH (WF-1) — thiếu nó trong ô thử thì phép lọc theo
# lớp không kiểm được gì.
STUDENT = {"id": SID, "full_name": "Hà Linh", "student_code": "hl01",
           "user_id": "u-1", "cohort_id": COHORT}


def _tables(**over):
    t = {
        "students": [STUDENT],
        "class_assignments": [
            {"id": "a-old", "cohort_id": COHORT, "title": "Buổi 1", "skill": "course",
             "due_at": "2026-08-01T12:00:00+00:00", "status": "published",
             "content_id": "bank-1", "content_config": {}},
            # `content_id` KHÁC None dù là bài Speaking: nếu ô thử để None ở
            # đây thì "chỉ bài theo buổi mới kèm kho câu hỏi" không kiểm được gì
            # — bỏ hẳn phép lọc `skill` vẫn ra None và chốt vẫn xanh.
            {"id": "a-new", "cohort_id": COHORT, "title": "Buổi 2", "skill": "speaking",
             "due_at": "2026-08-05T12:00:00+00:00", "status": "published",
             "content_id": "topic-9", "content_config": {}},
            {"id": "a-none", "cohort_id": COHORT, "title": "Không hạn", "skill": "reading",
             "due_at": None, "status": "published",
             "content_id": None, "content_config": {}},
            # Bài của LỚP KHÁC — không được lọt vào.
            {"id": "a-other", "cohort_id": "co-2", "title": "Lớp khác", "skill": "speaking",
             "due_at": "2026-08-09T12:00:00+00:00", "status": "published",
             "content_id": None, "content_config": {}},
        ],
        "class_assignment_items": [
            {"id": "i-old", "assignment_id": "a-old", "student_id": SID,
             "submitted_at": "2026-08-01T10:00:00+00:00", "score": 90, "state": "graded",
             "artifact_kind": "quiz_session", "artifact_id": "q-1",
             "passed_at": None, "mastery": {}},
            {"id": "i-new", "assignment_id": "a-new", "student_id": SID,
             "submitted_at": None, "score": None, "state": None,
             "artifact_kind": None, "artifact_id": None,
             "passed_at": None, "mastery": {}},
            {"id": "i-none", "assignment_id": "a-none", "student_id": SID,
             "submitted_at": "2026-08-06T10:00:00+00:00", "score": 7, "state": "graded",
             "artifact_kind": "reading_attempt", "artifact_id": "r-1",
             "passed_at": None, "mastery": {}},
            # Mục của EM KHÁC ở cùng bài — không được lọt vào.
            {"id": "i-other", "assignment_id": "a-old", "student_id": "st-2",
             "submitted_at": None, "score": None, "state": None,
             "artifact_kind": None, "artifact_id": None,
             "passed_at": None, "mastery": {}},
            # CHÍNH em ấy, nhưng ở bài của LỚP KHÁC. Đây là cảnh thật: mục bài
            # tập CỐ Ý sống sót khi học viên chuyển lớp, nên em ấy có mục ở lớp
            # cũ. Thiếu dòng này thì bỏ hẳn phép lọc `cohort_id` vẫn xanh, vì
            # bài lớp khác bị loại ở bước "không có mục" chứ không phải ở bước
            # lọc lớp — ô thử khi ấy chứng minh về một sản phẩm khác.
            {"id": "i-cross", "assignment_id": "a-other", "student_id": SID,
             "submitted_at": "2026-07-01T10:00:00+00:00", "score": 5, "state": "graded",
             "artifact_kind": "session", "artifact_id": "s-9",
             "passed_at": None, "mastery": {}},
        ],
        "course_writing_submissions": [
            {"class_assignment_item_id": "i-old"},
        ],
    }
    t.update(over)
    return t


def _call(tables=None, fail_tables=()):
    db = _DB(tables if tables is not None else _tables(), fail_tables)
    noop = lambda *a, **k: None  # noqa: E731
    with patch.object(adm, "supabase_admin", db), \
         patch.object(adm, "require_admin", AsyncMock(return_value=None)), \
         patch.object(adm, "_require_cohort", lambda *_a, **_k: None), \
         patch.object(adm, "reconcile_ledger_from_sessions", noop), \
         patch.object(adm, "reconcile_test_attempts", noop), \
         patch.object(adm, "reconcile_course_items", noop):
        return asyncio.run(adm.student_work(COHORT, SID, authorization="Bearer x"))


def _by_id(res):
    return {i["assignment_id"]: i for i in res["items"]}


# ── Trạng thái phải KHỚP bảng tổng kết ─────────────────────────────────────

def test_status_comes_from_the_same_rule_the_tally_uses():
    """Hai mặt đọc cùng nói về một dòng thì phải nói giống nhau.

    Đây là lỗi không kêu thành tiếng: một màn bảo "chưa nộp", màn kia bảo "nộp
    trễ", và không có gì đỏ lên. Nên chốt gọi CHÍNH hàm bảng tổng kết dùng và
    so với thứ endpoint này trả về, thay vì chép lại phép suy.
    """
    from datetime import datetime, timezone
    res = _call()
    items = _by_id(res)
    tables = _tables()
    checked = 0
    for it in tables["class_assignment_items"]:
        if it["student_id"] != SID:
            continue
        a = next(x for x in tables["class_assignments"] if x["id"] == it["assignment_id"])
        # Mục ở LỚP KHÁC cố ý không có trong kết quả — nó là phần của lớp cũ.
        if a["cohort_id"] != COHORT:
            continue
        due = adm._at(a.get("due_at"))
        sealed = bool(due and datetime.now(timezone.utc) > due)
        assert items[a["id"]]["status"] == adm._hand_in_status(it, STUDENT, due, sealed)
        checked += 1
    # Vòng lặp không so được dòng nào thì chốt này chỉ là một câu `pass` dài.
    assert checked == 3


def test_a_student_with_no_account_never_reads_as_lazy():
    """Chưa kích hoạt là CHƯA TỪNG thấy bài. Lẫn vào "chưa nộp" là nhắc nhầm."""
    t = _tables(students=[{**STUDENT, "user_id": None}])
    res = _call(t)
    assert {i["status"] for i in res["items"]} == {"no-account"}
    assert res["student"]["activated"] is False


# ── Phạm vi: đúng em, đúng lớp ─────────────────────────────────────────────

def test_only_this_class_and_only_this_student():
    res = _call()
    ids = set(_by_id(res))
    assert "a-other" not in ids, "bài của lớp khác lọt vào"
    assert ids == {"a-old", "a-new", "a-none"}


def test_an_assignment_with_no_item_for_this_student_is_left_out():
    """Bài giao chỉ THÊM người nhận, nên thiếu mục nghĩa là em ấy vào lớp sau
    khi bài được giao — vẽ nó thành "chưa nộp" là buộc tội oan."""
    t = _tables()
    t["class_assignment_items"] = [i for i in t["class_assignment_items"]
                                   if i["assignment_id"] != "a-new"]
    assert "a-new" not in _by_id(_call(t))


# ── Thứ tự: mới nhất trước, KHÔNG HẠN xuống cuối ───────────────────────────

def test_newest_deadline_first_and_undated_LAST():
    """Khoá ghép `(due_at is None, due_at)` cộng `reverse=True` đẩy nhóm
    không-hạn LÊN TRƯỚC vì `True > False` — đúng ngược ý, và là loại lỗi đọc mã
    không thấy (tôi đã viết đúng nó rồi tự bắt lại).

    Một khẳng định, một thứ tự. Chốt nhận `A or B` là chốt không nói gì.
    """
    assert [i["assignment_id"] for i in _call()["items"]] == ["a-new", "a-old", "a-none"]


# ── Đường mở bài ───────────────────────────────────────────────────────────

def test_the_open_link_carries_what_the_page_needs_to_pick_a_destination():
    """Mỗi kỹ năng mở ở một trang khác nhau, nên `artifact_kind` phải đi kèm —
    đoán từ hình dạng id là đoán sai."""
    it = _by_id(_call())["a-old"]
    assert it["artifact_kind"] == "quiz_session" and it["artifact_id"] == "q-1"
    assert it["bank_id"] == "bank-1", "bài theo buổi phải kèm kho câu hỏi"


def test_bank_id_is_only_for_course_tasks():
    """Kèm `bank_id` cho bài Speaking là mời trang mở tab "Bài từng em" trên một
    bài không có câu nào để đọc."""
    assert _by_id(_call())["a-new"]["bank_id"] is None


def test_has_writing_is_evidence_not_a_guess():
    items = _by_id(_call())
    assert items["a-old"]["has_writing"] is True
    assert items["a-new"]["has_writing"] is False


# ── Đọc hỏng phải NÓI RA ───────────────────────────────────────────────────

def test_a_failed_writing_read_marks_the_list_stale():
    """Im lặng ở đây biến "chưa đọc được" thành "em ấy chưa nộp tự luận": đường
    vào bài viết biến mất mà không ai biết vì sao."""
    res = _call(fail_tables=("course_writing_submissions",))
    assert res.get("homework_stale") is True
    assert all(i["has_writing"] is False for i in res["items"])


def test_a_failed_reconcile_marks_the_list_stale():
    """Không vá sổ thì một lượt ghi hỏng đọc ra thành "em ấy chưa làm bài" — và
    đây đúng là màn giáo viên mở ra để kết luận điều đó."""
    db = _DB(_tables())
    boom = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("vá hỏng"))  # noqa: E731
    with patch.object(adm, "supabase_admin", db), \
         patch.object(adm, "require_admin", AsyncMock(return_value=None)), \
         patch.object(adm, "_require_cohort", lambda *_a, **_k: None), \
         patch.object(adm, "reconcile_ledger_from_sessions", boom), \
         patch.object(adm, "reconcile_test_attempts", lambda *a, **k: None), \
         patch.object(adm, "reconcile_course_items", lambda *a, **k: None):
        res = asyncio.run(adm.student_work(COHORT, SID, authorization="Bearer x"))
    assert res.get("homework_stale") is True
    assert len(res["items"]) == 3, "vá hỏng KHÔNG được nuốt luôn danh sách"


def test_a_clean_read_does_not_cry_wolf():
    assert "homework_stale" not in _call()


# ── Không tìm thấy ─────────────────────────────────────────────────────────

def test_a_student_of_another_class_is_404_even_though_the_id_is_real():
    """Chỉ lọc theo id thì bất kỳ admin nào đoán được một id học viên đều đọc
    được bài của em ấy qua đường của lớp mình.

    Và cảnh thật gần hơn: mục bài tập CỐ Ý sống sót khi học viên chuyển lớp, nên
    một em đã rời đi vẫn còn dòng ở lớp này — không lọc thì màn này vẫn mở ra
    hồ sơ của em ấy dưới tên lớp mới (codex cục bộ 07/08).
    """
    from fastapi import HTTPException
    t = _tables(students=[{**STUDENT, "cohort_id": "co-KHAC"}])
    with pytest.raises(HTTPException) as e:
        _call(t)
    assert e.value.status_code == 404


def test_a_student_on_this_roster_is_let_through():
    """Chốt trên phải TỪ CHỐI đúng thứ cần từ chối, không từ chối tất cả."""
    res = _call(_tables(students=[{**STUDENT, "cohort_id": COHORT}]))
    assert res["student"]["id"] == SID and len(res["items"]) == 3


def test_an_unknown_student_is_404_not_an_empty_list():
    """Danh sách rỗng đọc ra "em ấy chưa được giao bài nào" — một khẳng định mà
    một id sai không chứng minh được."""
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        _call(_tables(students=[]))
    assert e.value.status_code == 404
