"""TRẢ BÀI — mở lại một mục đã nộp để học viên làm tiếp.

Ngày 07/08 em Lê Ngọc Hà Linh nộp nhầm phần tự luận sau bốn giây. Phần ấy chỉ
nộp được MỘT lần, và mở lại phải chạy SQL tay trên máy chủ thật. Đây là đường
trong sản phẩm cho đúng việc ấy.

Ba chốt được ghim ở đây, và cả ba đều là "làm thì hỏng chuyện" chứ không phải
"hệ thống lỗi":

  · quá hạn thì KHÔNG trả — trả xong em ấy vẫn không nộp được;
  · dạng bài mà sổ tự dựng lại từ phiên làm bài thì KHÔNG trả — cái nút sẽ nói
    dối, vì mục đóng lại ngay lần đầu có người mở trang;
  · điểm chỉ xoá khi CHÍNH lượt nộp ấy ghi nó.
"""

from __future__ import annotations

import pytest

from services import class_assignment_service as cas
from services.class_assignment_service import (
    ReturnNotPossible,
    return_item_to_student,
)


class _Resp:
    def __init__(self, data): self.data = data


class _Table:
    """Bảng giả nhớ được lệnh ghi — `update` chỉ chạm dòng còn khớp mọi `eq`."""

    def __init__(self, name, rows, log):
        self._name, self._rows, self._log = name, rows, log
        self._filters, self._patch, self._upsert = [], None, None

    def select(self, *_a, **_k): return self
    def limit(self, *_a): return self

    def update(self, patch):
        self._patch = patch
        return self

    def upsert(self, row, on_conflict=None):
        self._upsert = (row, on_conflict)
        return self

    def eq(self, field, value):
        self._filters.append((field, value))
        return self

    def _matching(self):
        out = self._rows
        for f, v in self._filters:
            out = [r for r in out if r.get(f) == v]
        return out

    def execute(self):
        if self._upsert is not None:
            row, key = self._upsert
            for r in self._rows:
                if key and r.get(key) == row.get(key):
                    r.update(row)
                    break
            else:
                self._rows.append(dict(row))
            self._log.append((self._name, "upsert", dict(row)))
            return _Resp([row])
        hit = self._matching()
        if self._patch is None:
            return _Resp(hit)
        for r in hit:
            r.update(self._patch)
        self._log.append((self._name, dict(self._patch), len(hit)))
        return _Resp(hit)


def _db(items, subs, log=None, drafts=None):
    log = [] if log is None else log
    tables = {"class_assignment_items": items, "course_writing_submissions": subs,
              "course_writing_drafts": drafts if drafts is not None else []}
    db = type("DB", (), {})()
    db.table = lambda n: _Table(n, tables.get(n, []), log)
    db._log = log
    db._tables = tables
    return db


def _item(**over):
    return {"id": "it1", "state": "graded", "submitted_at": "2026-08-07T01:22:06Z",
            "artifact_kind": "course_writing", "artifact_id": "w1",
            "opened_at": "2026-08-05T15:51:54Z", "score": 65.0, **over}


def _sub(**over):
    return {"id": "w1", "class_assignment_item_id": "it1",
            "user_id": "u1", "bank_id": "b1", "total": 10, "clean": 0,
            "items": [
                {"qid": "E1", "answer": "i find the new timetable confusing"},
                {"qid": "E2", "answer": "air pollution make him tired"},
            ], **over}


def test_returning_clears_the_hand_in_and_detaches_the_evidence():
    items, subs = [_item()], [_sub()]
    out = return_item_to_student(_db(items, subs), item_id="it1", clear_score=False)

    assert out["artifact_id"] == "w1"
    assert items[0]["submitted_at"] is None
    assert items[0]["state"] == "opened"
    assert items[0]["artifact_kind"] is None and items[0]["artifact_id"] is None
    # GỠ, không XOÁ: bài em ấy viết và bản chấm còn nguyên để tra lại.
    assert subs[0]["class_assignment_item_id"] is None
    assert subs[0]["total"] == 10 and subs[0]["clean"] == 0


def test_the_quiz_score_survives_a_returned_essay():
    """Bộ đề có trắc nghiệm thì điểm của mục LÀ kết quả trắc nghiệm (#994).

    Xoá nó khi trả bài viết là xoá đúng thứ em ấy đã làm được — và em Hà Linh
    đang mang 65% từ một lượt kiểm tra lại.
    """
    items = [_item()]
    return_item_to_student(_db(items, [_sub()]), item_id="it1", clear_score=False)
    assert items[0]["score"] == 65.0


def test_a_writing_only_score_is_cleared_with_the_submission_that_wrote_it():
    items = [_item(score=30.0)]
    return_item_to_student(_db(items, [_sub()]), item_id="it1", clear_score=True)
    assert items[0]["score"] is None, "để lại điểm của một bài đã trả là nói sai"


def test_a_never_submitted_item_is_refused():
    items = [_item(submitted_at=None, state="opened", artifact_kind=None,
                   artifact_id=None)]
    with pytest.raises(ReturnNotPossible, match="chưa nộp"):
        return_item_to_student(_db(items, []), item_id="it1", clear_score=False)


@pytest.mark.parametrize("kind", ["session", "reading_attempt",
                                  "listening_attempt", "quiz_session", None])
def test_kinds_whose_evidence_would_reopen_the_ledger_are_refused(kind):
    """Sổ tự vá lại từ bằng chứng bền.

    `reconcile_ledger_from_sessions` (Speaking), `reconcile_test_attempts`
    (Reading/Listening) và `reconcile_course_items` đều tìm "mục chưa nộp mà đã
    có bằng chứng" rồi đóng dấu lại. Trả một mục như thế là dựng một cái nút nói
    dối: mục đóng lại trong vài giây, không một lời báo.
    """
    items = [_item(artifact_kind=kind, artifact_id="x1")]
    with pytest.raises(ReturnNotPossible, match="Chưa trả được"):
        return_item_to_student(_db(items, []), item_id="it1", clear_score=False)
    assert items[0]["submitted_at"] == "2026-08-07T01:22:06Z", "từ chối thì đừng chạm sổ"


def test_a_hand_in_that_moved_between_read_and_write_stops_the_return():
    """So sánh rồi đổi. Một lượt vá sổ (hay một giáo viên khác) có thể đã đổi
    dòng này giữa lúc đọc và lúc ghi — khi ấy tiền đề sai, và phải dừng."""
    items = [_item()]

    class _Moving(_Table):
        def execute(self):
            # Đổi dấu nộp NGAY TRƯỚC lượt ghi, đúng cửa sổ mà chốt CAS canh.
            if self._patch is not None and self._name == "class_assignment_items":
                for r in self._rows:
                    r["submitted_at"] = "2026-08-07T09:00:00Z"
            return super().execute()

    db = type("DB", (), {})()
    db.table = lambda n: _Moving(
        n, {"class_assignment_items": items, "course_writing_submissions": [_sub()]}.get(n, []), [])
    with pytest.raises(ReturnNotPossible, match="vừa đổi ở nơi khác"):
        return_item_to_student(db, item_id="it1", clear_score=False)


def test_evidence_that_will_not_detach_is_reported_as_NOT_returned():
    """Dọn sổ TRƯỚC, gỡ bằng chứng SAU — và gỡ hụt thì nói thẳng.

    Lượt vá sổ kế tiếp sẽ đóng dấu lại bằng chính `graded_at` cũ, tức là quay về
    đúng trạng thái trước khi bấm. Báo "đã trả" lúc ấy là để giáo viên nhắn cho
    học viên một lời hứa mà hệ thống sắp nuốt lại.
    """
    items, subs = [_item()], [_sub(class_assignment_item_id="it-KHAC")]
    with pytest.raises(ReturnNotPossible, match="chưa trả bài"):
        return_item_to_student(_db(items, subs), item_id="it1", clear_score=False)


# ── Trả bài phải trả lại CẢ BÀI, không chỉ mở lại ô trống (codex #1000, P2) ──

def test_the_submitted_answers_come_back_as_the_draft():
    """Trang xoá nháp trong máy ngay khi nộp xong, còn bản trên máy chủ là lượt
    lưu tự động có độ trễ. Không rót lại thì em ấy mở ra thấy trang trắng — trả
    bài thành án gõ lại mười câu."""
    drafts = []
    out = return_item_to_student(_db([_item()], [_sub()], drafts=drafts),
                                 item_id="it1", clear_score=False)
    assert out["draft_restored"] == 2
    assert drafts[0]["class_assignment_item_id"] == "it1"
    assert drafts[0]["answers"] == {
        "E1": "i find the new timetable confusing",
        "E2": "air pollution make him tired",
    }
    assert drafts[0]["user_id"] == "u1" and drafts[0]["bank_id"] == "b1"


def test_a_stale_autosave_is_overwritten_by_the_submitted_snapshot():
    # Sau khi nộp, học viên không còn đường nào ghi nháp nữa — nên không có bản
    # nào MỚI HƠN để mà giẫm lên.
    drafts = [{"class_assignment_item_id": "it1", "user_id": "u1", "bank_id": "b1",
               "answers": {"E1": "câu viết dở, lưu từ ba phút trước"}}]
    return_item_to_student(_db([_item()], [_sub()], drafts=drafts),
                           item_id="it1", clear_score=False)
    assert len(drafts) == 1, "phải ghi ĐÈ, không đẻ thêm dòng thứ hai"
    assert drafts[0]["answers"]["E1"] == "i find the new timetable confusing"
    assert drafts[0]["answers"]["E2"] == "air pollution make him tired"


def test_an_empty_submission_does_not_stamp_an_empty_draft_over_the_old_one():
    drafts = [{"class_assignment_item_id": "it1", "user_id": "u1", "bank_id": "b1",
               "answers": {"E1": "thứ duy nhất còn sót lại của em ấy"}}]
    out = return_item_to_student(
        _db([_item()], [_sub(items=[])], drafts=drafts),
        item_id="it1", clear_score=False)
    assert out["draft_restored"] == 0
    assert drafts[0]["answers"] == {"E1": "thứ duy nhất còn sót lại của em ấy"}


def test_a_submission_that_cannot_be_read_stops_the_return_before_any_write():
    items = [_item()]
    with pytest.raises(ReturnNotPossible, match="Không đọc được bài đã nộp"):
        return_item_to_student(_db(items, []), item_id="it1", clear_score=False)
    assert items[0]["submitted_at"] == "2026-08-07T01:22:06Z", \
        "rót nháp hỏng thì phải dừng khi CHƯA đụng vào sổ"


def test_the_returnable_list_is_deliberately_short():
    # Danh sách này KHÔNG phải việc làm dở: mỗi dạng thêm vào phải kèm một đường
    # gỡ bằng chứng, nếu không cái nút sẽ nói dối.
    assert cas._RETURNABLE_KINDS == {"course_writing"}
