"""Chấm hỏng KHÔNG được ăn mất lượt nộp tự luận.

Lượt nộp tự luận chỉ có MỘT. Bản trước ghi dòng dù mọi câu `ok=None`, nên một
lượt gọi model hỏng ăn mất lượt duy nhất và không đường nào chấm lại. Ngày
06/08 model `gemini-2.5-flash-lite` bị ngừng cấp và TÁM em mất lượt — phải chạy
một kịch bản riêng mới trả lại được (PR #970).

Một luật nguyên tử: còn BẤT KỲ câu ``ok=None`` thì không ghi gì, nói thẳng và
giữ nháp. Mẫu số của kết quả phải là toàn bộ phần tự luận, không phải số mẻ mà
nhà cung cấp tình cờ trả JSON hợp lệ.
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from services import quiz_service as qs

ITEM = "it-1"


class _Q:
    def __init__(self, rows, cols="*"):
        self._rows, self._cols = list(rows), cols

    def eq(self, c, v): return _Q([r for r in self._rows if r.get(c) == v], self._cols)
    def order(self, *_a, **_k): return self
    def limit(self, *_a): return self

    def execute(self):
        class R: pass
        r = R(); r.data = [dict(x) for x in self._rows]; return r


class _DB:
    def __init__(self, tables):
        self.t, self.inserts, self.updates = tables, [], []

    def table(self, name):
        rows = self.t.get(name, [])
        db = self

        class T:
            def select(self, cols="*", **_k): return _Q(rows, cols)

            def insert(self, row):
                class _I:
                    def execute(self):
                        db.inserts.append(row)
                        class R: data = [{**row, "id": "new", "graded_at": "now"}]
                        return R()
                return _I()

            def update(self, patch):
                class _U:
                    def eq(self, _c, v): self._id = v; return self
                    def is_(self, *_a): return self
                    def execute(_s):
                        db.updates.append({"table": name, "id": getattr(_s, "_id", None), **patch})
                        class R: data = [{"id": getattr(_s, "_id", None), "graded_at": "now"}]
                        return R()
                return _U()
        return T()


def _submit(*, grade_oks, prior_items=None):
    """Gọi THẬT `submit_course_writing` với bộ chấm trả về `grade_oks`."""
    subs = ([{"id": "old", "class_assignment_item_id": ITEM, "items": prior_items}]
            if prior_items is not None else [])
    db = _DB({
        # Phải có ĐỦ mọi cột đường nộp lọc theo (`bank_id`, `type`). Thiếu một
        # cái là bộ giả trả rỗng ⇒ 404 "không có phần tự luận", tức chốt đỏ vì
        # bộ giả chứ không phải vì mã — bẫy đã vấp hai lần trong một buổi.
        "quiz_questions": [
            {"bank_id": "b1", "qid": "w1", "type": "writing", "prompt": "đề 1",
             "explain": "", "order": 0},
            {"bank_id": "b1", "qid": "w2", "type": "writing", "prompt": "đề 2",
             "explain": "", "order": 1}],
        "course_writing_submissions": subs,
        "class_assignment_items": [{"id": ITEM}],
    })

    async def fake_grade(items):
        return ([{**it, "ok": ok, "corrected": "x", "issues": []}
                 for it, ok in zip(items, grade_oks)], "model-thử")

    with patch.object(qs, "supabase_admin", db), \
            patch.object(qs, "_bank_meta_or_404", lambda *_a, **_k: {"id": "b1"}), \
            patch.object(qs, "_assignment_item_for", lambda *_a, **_k: {"id": ITEM}), \
            patch.object(qs, "mark_item_submitted", lambda *a, **k: True), \
            patch.object(qs.course_writing_grader, "grade", fake_grade):
        out = asyncio.run(qs.submit_course_writing(
            user_id="u1", bank_id="b1", answers={"w1": "câu một", "w2": "câu hai"}))
    return out, db


def test_a_total_grader_failure_writes_NOTHING():
    with pytest.raises(HTTPException) as e:
        _submit(grade_oks=[None, None])
    assert e.value.status_code == 503


def test_and_the_student_is_told_their_work_is_SAFE():
    """Không nói thì em ấy tưởng phải gõ lại từ đầu."""
    with pytest.raises(HTTPException) as e:
        _submit(grade_oks=[None, None])
    d = e.value.detail
    assert d["grader_down"] is True
    assert "vẫn còn nguyên" in d["message"] and "Nộp lại" in d["message"]


def test_a_PARTIAL_grade_writes_NOTHING():
    """Một câu thật + một câu chưa chấm không phải kết quả 1/2."""
    with pytest.raises(HTTPException) as e:
        _submit(grade_oks=[True, None])
    assert e.value.status_code == 503


def test_a_previously_BROKEN_submission_can_be_graded_again_in_place():
    """Dòng cũ còn một câu `ok=None` không phải một lượt hoàn tất."""
    out, db = _submit(grade_oks=[True, True],
                      prior_items=[{"qid": "w1", "ok": True}, {"qid": "w2", "ok": None}])
    assert db.inserts == [], "không được đẻ dòng thứ hai — mig 192 chỉ cho một"
    assert len(db.updates) == 1 and db.updates[0]["id"] == "old"
    assert db.updates[0]["clean"] == 2


def test_a_REAL_prior_submission_still_blocks_a_second_one():
    """Nới cho lượt hỏng KHÔNG được nới luôn cho lượt thật."""
    with pytest.raises(HTTPException) as e:
        _submit(grade_oks=[True, True],
                prior_items=[{"qid": "w1", "ok": True}, {"qid": "w2", "ok": False}])
    assert e.value.status_code == 409


# ── Đường chấm lại phải TỚI ĐƯỢC từ giao diện ─────────────────────────────
#
# Cho phép chấm lại ở `submit` là chưa đủ: `course_writing_state` vẫn báo mọi
# dòng là "đã nộp" và `save_course_writing_draft` vẫn chặn lưu nháp, nên sau
# khi tải lại trang em ấy bị khoá khung viết và `submit()` trả `{already:true}`
# — đường vá có mà không ai tới được (codex #971).

BROKEN = [{"qid": "w1", "ok": None}, {"qid": "w2", "ok": None}]
REAL = [{"qid": "w1", "ok": True}, {"qid": "w2", "ok": False}]
PARTIAL = [{"qid": "w1", "ok": True}, {"qid": "w2", "ok": None}]


def test_one_rule_decides_what_a_broken_row_is():
    assert qs._writing_row_is_broken({"items": BROKEN}) is True
    assert qs._writing_row_is_broken({"items": PARTIAL}) is True
    assert qs._writing_row_is_broken({"items": REAL}) is False
    assert qs._writing_row_is_broken({"items": []}) is False
    assert qs._writing_row_is_broken(None) is False


def test_all_THREE_contracts_ask_that_same_question():
    """Ba nơi phải nói cùng một câu. Sửa mỗi nơi thứ ba là đường vá không tới."""
    import inspect
    for fn in (qs.course_writing_state, qs.save_course_writing_draft,
               qs.submit_course_writing):
        assert "_writing_row_is_broken" in inspect.getsource(fn), fn.__name__


def test_a_broken_row_does_not_read_as_SUBMITTED():
    """Trang đọc `submitted` để quyết hiện KHUNG VIẾT hay BẢN CHẤM."""
    import inspect
    src = inspect.getsource(qs.course_writing_state)
    # ĐÚNG DÒNG `"submitted"`, không phải "đâu đó gần nó": dòng `grader_failed`
    # nằm ngay bên dưới và cũng gọi cùng hàm, nên cắt theo khoảng ký tự sẽ xanh
    # kể cả khi `submitted` quay về `bool(sub)`.
    line = next(l for l in src.splitlines() if '"submitted":' in l)
    assert "_writing_row_is_broken" in line, line.strip()
    # …và không phát ra một "bản chấm" rỗng để trang vẽ 0/10.
    j = src.index('"graded_at":')
    assert "_writing_row_is_broken" in src[j:j + 300]


def test_a_broken_row_can_read_its_SERVER_DRAFT_again():
    """Lượt partial từng xoá localStorage sau POST thành công. Nếu API chỉ đọc
    draft khi không có submission thì khung mở lại nhưng trắng 15 câu."""
    import inspect
    src = inspect.getsource(qs.course_writing_state)
    assert "not sub or _writing_row_is_broken(sub)" in src


def test_the_retry_write_is_a_COMPARE_AND_SWAP():
    """Hai tab cùng bấm Nộp lại thì cả hai qua được phép kiểm ở trên. Không có
    so-và-đổi thì cả hai cùng ghi, bản xong SAU đè lên bản trước, và sổ lớp
    nhận một điểm khác."""
    import inspect
    src = inspect.getsource(qs.submit_course_writing)
    i = src.index("if retry_of:")
    seg = src[i:i + 900]
    assert 'eq("graded_at", retry_stamp)' in seg, "phải so với mốc đã đọc"
    assert "if not (res.data or []):" in seg, "người thua phải biết mình thua"
    assert "409" in seg
