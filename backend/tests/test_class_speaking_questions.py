"""Phiên luyện của bài tập lớp phải dùng ĐÚNG đề đã giao, và giấu chữ.

Hai bất biến, và cả hai đều là lý do tồn tại của tính năng này:

  * **Đúng đề đã giao.** Trước đây câu hỏi được sinh lúc học viên mở bài, nên
    hai em cùng một bài giao có thể trả lời hai bộ câu khác nhau. "Em ấy có làm
    đúng bài được giao không?" là câu hỏi mà cách làm đó không trả lời được.

  * **Chữ không rời máy chủ.** Part 1 và Part 3 giao bằng audio; ẩn bằng CSS
    hoặc gửi xuống rồi mong người ta không nhìn đều không tính — mở devtools
    hay xem tab Network là đọc được. Việc PHẢI NGHE mới biết đề hỏi gì chính là
    thứ bài tập này kiểm tra.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from routers import questions as mod
from services.question_visibility import redact_question


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
    def limit(self, *_a): return self
    def order(self, *_a, **_k): return self
    def execute(self): return _Resp(self._rows)


def _bank_q(qid, part, *, text="Where do you live?", audio="https://cdn/a.mp3"):
    return {"id": qid, "part": part, "question_text": text,
            "question_type": "personal", "audio_url": audio,
            "cue_card_bullets": None, "cue_card_reflection": None}


def _db(*, qids=("q1", "q2"), bank=None, skill="speaking"):
    tables = {
        "class_assignment_items": [{"id": "item-1", "assignment_id": "asg-1"}],
        "class_assignments": [{"id": "asg-1", "skill": skill, "part": 1,
                               "content_config": {"question_ids": list(qids)}}],
        "topic_questions": list(bank if bank is not None
                                else [_bank_q("q1", 1), _bank_q("q2", 1)]),
    }
    db = type("DB", (), {})()
    db.table = lambda n: _Table(tables.get(n, []))
    return db


def _load(db, session=None):
    s = {"id": "sess-1", "class_assignment_item_id": "item-1"}
    s.update(session or {})
    with patch.object(mod, "supabase_admin", db):
        return mod._load_pinned_class_questions("sess-1", s)


# ── đúng đề đã giao ─────────────────────────────────────────────────────


def test_the_pinned_questions_are_used():
    rows = _load(_db())
    assert [r["question_text"] for r in rows] == ["Where do you live?"] * 2
    assert [r["order_num"] for r in rows] == [1, 2]


def test_the_order_the_admin_pinned_is_kept():
    """Thứ tự DB trả về không phải thứ tự admin chốt — Part 1 là một mạch hội
    thoại, đảo câu là đảo mạch."""
    bank = [_bank_q("q2", 1, text="B"), _bank_q("q1", 1, text="A")]   # DB trả ngược
    rows = _load(_db(qids=("q1", "q2"), bank=bank))
    assert [r["question_text"] for r in rows] == ["A", "B"]


def test_an_incomplete_pinned_set_is_refused_LOUDLY():
    """Thiếu một câu mà vẫn dựng phiên nghĩa là học viên làm nửa bài rồi được
    ghi nhận là đã nộp.

    Ném lỗi chứ KHÔNG trả [] — trả rỗng sẽ đẩy tiếp xuống kho đề/Gemini và chèn
    vĩnh viễn một bộ câu khác, trong khi phiên vẫn đủ điều kiện tính là bài tập
    lớp: em ấy trả lời một đề không ai giao mà sổ vẫn ghi "đã làm"."""
    with pytest.raises(Exception) as exc:
        _load(_db(qids=("q1", "q2", "q-mất"), bank=[_bank_q("q1", 1), _bank_q("q2", 1)]))
    assert getattr(exc.value, "status_code", None) == 503


def test_a_session_with_no_class_link_falls_through():
    """Luyện tự do vẫn đi luồng cũ."""
    assert _load(_db(), session={"class_assignment_item_id": None}) == []


def test_a_reading_give_is_not_treated_as_speaking():
    assert _load(_db(skill="reading")) == []


def test_an_old_give_with_no_pinned_ids_falls_through():
    """Bài giao tạo trước khi đổi cách làm vẫn chạy được luồng cũ."""
    assert _load(_db(qids=())) == []


def test_a_lookup_failure_FAILS_CLOSED():
    """Cùng lý do: một trục trặc tạm thời không được biến thành "giao em ấy một
    đề khác, vĩnh viễn"."""
    class _Boom:
        def table(self, _n): raise RuntimeError("boom")
    with pytest.raises(Exception) as exc:
        _load(_Boom())
    assert getattr(exc.value, "status_code", None) == 503


# ── bản chụp: sửa kho đề KHÔNG được làm đổi bài đã phát ─────────────────


def _snapshot_db(snapshot, bank):
    tables = {
        "class_assignment_items": [{"id": "item-1", "assignment_id": "asg-1"}],
        "class_assignments": [{"id": "asg-1", "skill": "speaking", "part": 1,
                               "content_config": {
                                   "question_ids": [s["id"] for s in snapshot],
                                   "questions": snapshot}}],
        "topic_questions": list(bank),
    }
    db = type("DB", (), {})()
    db.table = lambda n: _Table(tables.get(n, []))
    return db


def test_editing_the_bank_cannot_change_an_assignment_already_given():
    """Chỉ lưu id thì lúc học viên mở bài hệ thống vẫn đọc lại kho đề đang sống
    — nên em mở TRƯỚC và em mở SAU một lần sửa sẽ nhận nội dung khác nhau dưới
    cùng một bài giao. Bản chụp là thứ khiến lời hứa đó thành thật."""
    snap = [{"id": "q1", "part": 1, "question_text": "Bản lúc giao",
             "question_type": "personal", "audio_url": "https://cdn/old.mp3",
             "cue_card_bullets": None, "cue_card_reflection": None}]
    bank = [_bank_q("q1", 1, text="Bản đã sửa sau đó", audio="https://cdn/new.mp3")]
    rows = _load(_snapshot_db(snap, bank))
    assert rows[0]["question_text"] == "Bản lúc giao"
    assert rows[0]["audio_url"] == "https://cdn/old.mp3"


def test_an_assignment_from_before_snapshots_still_works():
    """Bài giao ghi trước khi có bản chụp vẫn phải mở được — đọc lại kho đề."""
    rows = _load(_db())
    assert len(rows) == 2


def test_a_half_written_snapshot_falls_back_to_the_bank():
    """Bản chụp thiếu câu thì tin kho đề còn hơn phục vụ nửa bộ."""
    snap = [{"id": "q1", "part": 1, "question_text": "chỉ một câu",
             "question_type": "personal", "audio_url": "x",
             "cue_card_bullets": None, "cue_card_reflection": None}]
    tables_db = _snapshot_db(snap, [_bank_q("q1", 1), _bank_q("q2", 1)])
    tables_db.table("class_assignments")  # no-op, giữ nguyên cấu trúc
    cfg_db = _db(qids=("q1", "q2"))
    cfg_db.table("class_assignments")
    # bài giao khai 2 id nhưng bản chụp chỉ có 1 → đọc lại kho
    tables = {
        "class_assignment_items": [{"id": "item-1", "assignment_id": "asg-1"}],
        "class_assignments": [{"id": "asg-1", "skill": "speaking", "part": 1,
                               "content_config": {"question_ids": ["q1", "q2"],
                                                  "questions": snap}}],
        "topic_questions": [_bank_q("q1", 1), _bank_q("q2", 1)],
    }
    db = type("DB", (), {})()
    db.table = lambda n: _Table(tables.get(n, []))
    rows = _load(db)
    assert len(rows) == 2


# ── giấu chữ ────────────────────────────────────────────────────────────


@pytest.mark.parametrize("part,hidden", [(1, True), (3, True), (2, False)])
def test_only_the_audio_parts_are_marked_listen_only(part, hidden):
    """Part 2 là cue card — đọc bằng mắt là đúng cách của phần thi ấy."""
    bank = [_bank_q("q1", part)]
    rows = _load(_db(qids=("q1",), bank=bank))
    assert rows[0]["listen_only"] is hidden


def test_the_text_never_leaves_the_server_for_a_listen_only_question():
    q = {"id": "x", "part": 1, "listen_only": True,
         "question_text": "Where do you live?", "audio_url": "https://cdn/a.mp3",
         "cue_card_bullets": ["a"], "cue_card_reflection": "b", "subtopic": "c"}
    out = redact_question(q)
    assert out["question_text"] == ""
    assert out["audio_url"] == "https://cdn/a.mp3", "audio là thứ DUY NHẤT em ấy có"
    for leak in ("cue_card_bullets", "cue_card_reflection", "subtopic"):
        assert leak not in out, f"{leak} cũng lộ nội dung đề"


def test_the_key_is_emptied_not_deleted():
    """Frontend đọc `question_text` ở nhiều chỗ; khoá biến mất sẽ thành
    'undefined' hiện ra màn hình."""
    out = redact_question({"part": 1, "listen_only": True,
                                  "question_text": "x"})
    assert "question_text" in out and out["question_text"] == ""


def test_an_ordinary_question_is_untouched():
    q = {"part": 2, "listen_only": False, "question_text": "Describe a trip",
         "cue_card_bullets": ["a", "b"]}
    assert redact_question(q) == q
