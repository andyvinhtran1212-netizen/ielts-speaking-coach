"""Render bản đọc cho KHO THEO BUỔI — chạy qua đúng lệnh người ta gõ.

Kho theo buổi và kho chung dùng chung một vòng lặp render nhưng KHÁC bảng ghi
lại và KHÁC nguồn chủ đề. Hai chỗ dễ hỏng, và cả hai đều im lặng khi hỏng:

  - ghi nhầm bảng ⇒ mẻ render "xanh" mà kho theo buổi vẫn không có audio;
  - lấy nhầm chủ đề ⇒ học viên nghe "let's talk about buổi một".
"""

from __future__ import annotations

import sys
from unittest.mock import patch

from scripts import pregen_speaking_question_audio as mod
from tests.test_import_speaking_lesson_sets import _DB   # noqa: F401  (double dùng chung)


_SET = {"id": "set-1", "title": "Buổi 1", "part": 1, "is_active": True}


def _q(order, text, *, topic_label=None, audio=None):
    return {"id": f"q{order}", "set_id": "set-1", "order_num": order,
            "question_text": text, "topic_label": topic_label,
            "audio_url": audio, "audio_path": None, "is_active": True}


def _db(questions, *, sets=(_SET,), topic_questions=()):
    return _DB(speaking_lesson_sets=list(sets),
               speaking_lesson_set_questions=list(questions),
               topic_questions=list(topic_questions),
               topics=[{"id": "top-1", "title": "Hometown", "is_active": True}])


def _run(db, *flags, rendered=None):
    """Gọi main() thật. `rendered` ghi lại từng (script, câu) đã render."""
    calls = []

    def _fake_render(question, topic_title=None, **_k):
        script = mod.sqa.build_script(part=question["part"],
                                      topic_title=topic_title,
                                      question_text=question["question_text"])
        calls.append((script, question["id"]))
        return {"audio_path": f"sp/{question['id']}.mp3",
                "audio_url": f"https://cdn/{question['id']}.mp3",
                "script": script, "synthesized": True}

    with patch.object(mod, "supabase_admin", db), \
         patch.object(mod.sqa, "render_question_audio", _fake_render), \
         patch.object(sys, "argv", ["prog", *flags]):
        rc = mod.main()
    if rendered is not None:
        rendered.extend(calls)
    return rc


# ── Ghi vào ĐÚNG bảng ─────────────────────────────────────────────────────────

def test_the_pointer_lands_on_the_lesson_table_not_the_shared_bank():
    """Ghi nhầm sang `topic_questions` cho ra một mẻ render "xanh" trong khi kho
    theo buổi vẫn trống — và không có gì đỏ để báo."""
    db = _db([_q(1, "When do you have breakfast?")])
    assert _run(db, "--lesson-set", "--commit") == 0
    row = db.tables["speaking_lesson_set_questions"][0]
    assert row["audio_url"] == "https://cdn/q1.mp3"
    assert row["audio_path"] == "sp/q1.mp3"
    assert not any(t == "topic_questions" for _, t, *_ in db.writes)


def test_without_the_flag_the_shared_bank_path_is_untouched():
    """Đường cũ phải giữ nguyên hành vi — thêm một nguồn không được đổi nguồn kia."""
    db = _db([], topic_questions=[{
        "id": "tq1", "topic_id": "top-1", "part": 1,
        "question_text": "Where do you live?", "audio_url": None, "is_active": True}])
    assert _run(db, "--commit") == 0
    assert db.tables["topic_questions"][0]["audio_url"] == "https://cdn/tq1.mp3"
    assert "speaking_lesson_set_questions" not in {t for _, t, *_ in db.writes}


# ── Chủ đề để đọc ─────────────────────────────────────────────────────────────

def test_a_question_with_no_topic_label_is_read_without_a_lead_in():
    """Đọc tên BỘ ĐỀ vào chỗ chủ đề cho ra "let's talk about buổi 1" — vô nghĩa
    với người đang nghe để biết mình bị hỏi gì."""
    out = []
    _run(_db([_q(1, "When do you have breakfast?")]),
         "--lesson-set", "--commit", rendered=out)
    assert out[0][0] == "This is Part 1. Question: When do you have breakfast?"
    assert "Buổi 1" not in out[0][0] and "talk about" not in out[0][0]


def test_a_question_that_HAS_a_topic_label_keeps_the_full_lead_in():
    out = []
    _run(_db([_q(1, "When do you have breakfast?", topic_label="Food")]),
         "--lesson-set", "--commit", rendered=out)
    assert out[0][0] == \
        "This is Part 1. Let's talk about food. Question: When do you have breakfast?"


# ── Part nằm ở BỘ ĐỀ, không nằm ở câu ─────────────────────────────────────────

def test_the_part_comes_from_the_set():
    """Câu trong kho theo buổi KHÔNG có cột `part`. Quên bơm nó vào thì
    `render_question_audio` thấy part=None và bỏ qua toàn bộ câu — im lặng."""
    out = []
    _run(_db([_q(1, "Why?")], sets=[{**_SET, "part": 3}]),
         "--lesson-set", "--commit", rendered=out)
    assert out[0][0].startswith("This is Part 3.")


# ── Chạy lại / lọc ────────────────────────────────────────────────────────────

def test_questions_that_already_have_audio_are_skipped():
    out = []
    db = _db([_q(1, "a?", audio="https://cdn/cu.mp3"), _q(2, "b?")])
    _run(db, "--lesson-set", "--commit", rendered=out)
    assert [c[1] for c in out] == ["q2"]


def test_regen_re_renders_even_what_already_has_audio():
    out = []
    db = _db([_q(1, "a?", audio="https://cdn/cu.mp3")])
    _run(db, "--lesson-set", "--commit", "--regen", rendered=out)
    assert [c[1] for c in out] == ["q1"]


def test_a_dry_run_renders_nothing_and_writes_nothing():
    out = []
    db = _db([_q(1, "a?")])
    assert _run(db, "--lesson-set", rendered=out) == 0
    assert out == [] and db.writes == []


def test_one_set_can_be_targeted_by_id():
    out = []
    db = _db([_q(1, "a?"), {**_q(2, "b?"), "set_id": "set-2"}],
             sets=[_SET, {"id": "set-2", "title": "Buổi 2", "part": 1, "is_active": True}])
    _run(db, "--lesson-set", "set-1", "--commit", rendered=out)
    assert [c[1] for c in out] == ["q1"]


def test_no_matching_set_is_an_ERROR_not_a_quiet_success():
    """Trả 0 khi không tìm thấy bộ nào sẽ khiến một lần gõ sai id trông y hệt một
    mẻ render thành công."""
    db = _db([], sets=[])
    assert _run(db, "--lesson-set", "khong-co", "--commit") == 1
