"""Bộ lọc chữ câu hỏi — MỘT bộ, dùng ở MỌI đường trả về.

Câu hỏi của một phiên đi ra ngoài qua BA đường khác nhau. Lọc ở một đường và
quên hai đường kia thì bộ lọc TRÔNG NHƯ đang chạy trong khi chữ vẫn lọt — đúng
cái đã xảy ra ở bản đầu và bị review bắt.
"""

from __future__ import annotations

import inspect
import re

from services.question_visibility import redact_question, redact_questions


def test_a_listen_only_question_loses_its_text():
    out = redact_question({"listen_only": True, "question_text": "Where do you live?",
                           "audio_url": "https://cdn/a.mp3"})
    assert out["question_text"] == ""
    assert out["audio_url"] == "https://cdn/a.mp3", "audio là thứ DUY NHẤT em ấy có"


def test_every_field_that_leaks_the_prompt_goes_too():
    """Một cue-card bullet hay một subtopic đủ để đoán ra câu hỏi."""
    out = redact_question({"listen_only": True, "question_text": "x",
                           "cue_card_bullets": ["a"], "cue_card_reflection": "b",
                           "subtopic": "c"})
    for leak in ("cue_card_bullets", "cue_card_reflection", "subtopic"):
        assert leak not in out


def test_the_key_is_emptied_not_deleted():
    out = redact_question({"listen_only": True, "question_text": "x"})
    assert "question_text" in out and out["question_text"] == ""


def test_an_ordinary_question_is_returned_untouched():
    q = {"listen_only": False, "question_text": "Describe a trip",
         "cue_card_bullets": ["a"]}
    assert redact_question(q) == q


def test_none_becomes_an_empty_list():
    assert redact_questions(None) == []


def test_every_student_facing_return_of_question_rows_is_filtered():
    """Quét CẢ HAI router. Lý luận "đường này không thể mang cờ" chính là kiểu
    suy nghĩ đã để lọt lần đầu — đường nào trả dòng câu hỏi cũng phải qua bộ lọc,
    kể cả nơi nó là phép rỗng."""
    from routers import questions as q_mod
    from routers import sessions as s_mod

    src = inspect.getsource(q_mod)
    # Bỏ chú thích trước khi quét: chính lời giải thích dài ở đây sẽ làm xanh
    # phép kiểm nếu không bóc.
    code = re.sub(r'"""[\s\S]*?"""', "", src)
    code = re.sub(r"#[^\n]*", "", code)

    bad = [ln.strip() for ln in code.split("\n")
           if ln.strip().startswith("return ")
           and any(k in ln for k in ("sorted(", "result.data", "winner", "saved",
                                     "existing.data"))
           and "redact_questions" not in ln]
    assert bad == [], f"đường trả chưa lọc: {bad}"

    s_code = re.sub(r'"""[\s\S]*?"""', "", inspect.getsource(s_mod))
    assert "redact_questions(q_result.data)" in s_code, (
        "GET /sessions/{id} là đường trang gọi ĐẦU TIÊN — không lọc ở đó thì chữ "
        "đã nằm trong phản hồi mạng trước khi bộ lọc nào khác kịp chạy"
    )
