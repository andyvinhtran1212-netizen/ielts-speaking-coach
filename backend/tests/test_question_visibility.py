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


# ── CỬA THỨ NĂM: xuất PDF ───────────────────────────────────────────────
#
# Vòng review thứ năm mới lộ ra, vì phép quét vòng 1 của tôi chỉ đi qua hai
# router mình vừa sửa chứ không đi qua MỌI nơi đọc bảng `questions`.


def test_every_reader_of_the_questions_table_is_accounted_for():
    """Liệt kê CHỦ ĐÍCH mọi nơi đọc bảng `questions`, và vì sao nơi đó an toàn.
    Thêm một nơi đọc mới mà không nghĩ tới việc lọc thì test này đỏ — đó là điều
    bốn vòng review vừa rồi cho thấy là cần."""
    import pathlib
    import re

    root = pathlib.Path(__file__).resolve().parents[1]
    hits = set()
    for d in ("routers", "services"):
        for f in (root / d).glob("*.py"):
            if re.search(r'table\("questions"\)', f.read_text(encoding="utf-8")):
                hits.add(f"{d}/{f.name}")

    # Mỗi mục là một lời khẳng định đã KIỂM, không phải một danh sách bỏ qua.
    known = {
        "routers/questions.py",      # mọi đường trả đều qua redact_questions
        "routers/sessions.py",       # GET /sessions/{id} đã lọc; hai chỗ khác không lấy chữ
        "routers/grading.py",        # chỉ đọc để CHẤM, không trả về client
        "routers/pronunciation.py",  # select("id, part") — không lấy chữ
        "routers/admin.py",          # màn admin: giáo viên ĐƯỢC xem đề
        "services/pdf_generator.py", # lọc khi phiên chưa hoàn thành
    }
    assert hits == known, (
        f"nơi đọc mới chưa được xét: {hits - known}; "
        f"nơi đã biến mất: {known - hits}"
    )


def test_the_pdf_hides_prompts_while_the_session_is_still_running():
    """Endpoint xuất PDF cũng của học viên và chạy được cả khi phiên ĐANG LÀM —
    không lọc thì em ấy tải một tệp chứa đủ đề rồi mới trả lời."""
    import inspect
    import re
    from services import pdf_generator

    src = re.sub(r"#[^\n]*", "", inspect.getsource(pdf_generator))
    m = re.search(r'status.*!=\s*"completed"[\s\S]{0,120}?redact_questions\(questions\)', src)
    assert m, "phiên chưa hoàn thành thì phải lược chữ"


def test_a_finished_session_keeps_its_questions_in_the_pdf():
    """Việc đã làm xong; sổ cái ghi lần nộp ĐẦU nên đọc lại đề không giúp làm lại
    được gì — và bản PDF là tài liệu để ôn, giấu đề ở đó chỉ làm nó vô dụng."""
    import inspect
    import re
    from services import pdf_generator

    src = re.sub(r"#[^\n]*", "", inspect.getsource(pdf_generator))
    assert re.search(r'if \(session or \{\}\)\.get\("status"\) != "completed"', src), (
        "phải là điều kiện theo trạng thái, không phải lọc vô điều kiện"
    )
