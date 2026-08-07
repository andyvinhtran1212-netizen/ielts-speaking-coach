"""Phần TỰ LUẬN của bài tập theo buổi.

Hai luật người dùng đặt ra, và cả hai đều là chỗ dễ hỏng:

  · MỘT LƯỢT DUY NHẤT mỗi học viên mỗi bank — ràng buộc thật ở UNIQUE của
    migration 190, không phải một câu `if` ai đó phải nhớ.
  · ĐỦ CÂU MỚI NHẬN — thiếu một câu thì giữ nháp và chờ, KHÔNG tiêu mất lượt
    chấm duy nhất cho một bài dở dang.

Và một luật của chính bộ chấm: sửa NGỮ PHÁP + CHÍNH TẢ, không nâng cấp câu.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from services import quiz_service as qs
from services import course_writing_grader as cw


class _Resp:
    def __init__(self, data): self.data = data


class _Table:
    def __init__(self, name, rows, log):
        self._name, self._rows, self._log = name, list(rows), log
    def select(self, *_a, **_k): return self
    def insert(self, row):
        self._log.append((self._name, "insert", row))
        self._rows = [{**row, "graded_at": "2026-08-05T00:00:00Z"}]
        return self
    def eq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def execute(self): return _Resp(self._rows)


def _db(log, **tables):
    db = type("DB", (), {})()
    db.table = lambda n: _Table(n, tables.get(n, []), log)
    return db


def _q(qid, order):
    return {"qid": qid, "prompt": f"Viết lại: {qid}", "explain": "Đáp án mẫu",
            "points": 1, "item_key": "RB1", "subtype": "E1", "order": order,
            "type": "writing", "bank_id": "b1"}


_QS = [_q("E1", 90), _q("E2", 91)]


async def _submit(answers, *, existing=(), graded=None, log=None):
    log = [] if log is None else log
    db = _db(log, quiz_questions=_QS, course_writing_submissions=list(existing))
    async def fake_grade(items):
        return (graded if graded is not None else
                [{"qid": i["qid"], "prompt": i["prompt"], "answer": i["answer"],
                  "corrected": i["answer"], "issues": [], "ok": True}
                 for i in items]), "gemini-2.5-flash-lite"
    with patch.object(qs, "supabase_admin", db), \
         patch.object(qs, "_bank_meta_or_404", lambda b, u=None: {"id": b, "skill_area": "course"}), \
         patch.object(qs, "_assignment_item_for", lambda b, u: {"id": "it1"}), \
         patch.object(qs.course_writing_grader, "grade", fake_grade):
        return await qs.submit_course_writing(user_id="u1", bank_id="b1", answers=answers), log


# ── Một lượt duy nhất ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_first_submission_is_graded_and_saved():
    out, log = await _submit({"E1": "I am a student.", "E2": "She works here."})
    assert out["total"] == 2 and out["clean"] == 2
    ins = [e for e in log if e[1] == "insert"]
    assert len(ins) == 1
    assert ins[0][2]["class_assignment_item_id"] == "it1"


@pytest.mark.asyncio
async def test_second_submission_is_refused_before_spending_a_model_call():
    """Kiểm SỚM: lượt thứ hai không được tốn tiền gọi model rồi mới bị chặn."""
    called = {"n": 0}
    async def counting(items):
        called["n"] += 1
        return [], None
    db = _db([], quiz_questions=_QS,
             course_writing_submissions=[{"id": "sub1", "bank_id": "b1", "user_id": "u1",
                                          "class_assignment_item_id": "it1"}])
    with patch.object(qs, "supabase_admin", db), \
         patch.object(qs, "_bank_meta_or_404", lambda b, u=None: {"id": b, "skill_area": "course"}), \
         patch.object(qs, "_assignment_item_for", lambda b, u: {"id": "it1"}), \
         patch.object(qs.course_writing_grader, "grade", counting):
        with pytest.raises(HTTPException) as e:
            await qs.submit_course_writing(user_id="u1", bank_id="b1",
                                           answers={"E1": "x", "E2": "y"})
    assert e.value.status_code == 409
    assert called["n"] == 0, "đã chặn rồi thì đừng gọi model"


@pytest.mark.asyncio
async def test_a_race_that_hits_the_unique_index_reads_as_already_submitted():
    """Hai tab cùng bấm Nộp: lượt thua va UNIQUE — đó là 409, không phải 500."""
    class _Boom(_Table):
        def execute(self):
            if any(e[1] == "insert" for e in self._log):
                raise RuntimeError('duplicate key value violates unique constraint "…"')
            return super().execute()
    log = []
    tables = {"quiz_questions": _QS, "course_writing_submissions": []}
    db = type("DB", (), {})()
    db.table = lambda n: _Boom(n, tables.get(n, []), log)
    async def g(items): return [], "m"
    with patch.object(qs, "supabase_admin", db), \
         patch.object(qs, "_bank_meta_or_404", lambda b, u=None: {"id": b, "skill_area": "course"}), \
         patch.object(qs, "_assignment_item_for", lambda b, u: {"id": "it1"}), \
         patch.object(qs.course_writing_grader, "grade", g):
        with pytest.raises(HTTPException) as e:
            await qs.submit_course_writing(user_id="u1", bank_id="b1",
                                           answers={"E1": "x", "E2": "y"})
    assert e.value.status_code == 409


# ── Đủ câu mới nhận ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_missing_answer_is_refused_and_names_what_is_missing():
    with pytest.raises(HTTPException) as e:
        await _submit({"E1": "I am a student."})
    assert e.value.status_code == 422
    assert e.value.detail["missing"] == ["E2"]


@pytest.mark.asyncio
async def test_whitespace_only_does_not_count_as_written():
    with pytest.raises(HTTPException) as e:
        await _submit({"E1": "ok", "E2": "   \n  "})
    assert e.value.status_code == 422


@pytest.mark.asyncio
async def test_an_incomplete_attempt_does_not_burn_the_single_grading_run():
    log = []
    with pytest.raises(HTTPException):
        await _submit({"E1": "only one"}, log=log)
    assert [e for e in log if e[1] == "insert"] == [], "không được ghi gì"


# ── Trạng thái đọc ───────────────────────────────────────────────────────────

def _state(existing=(), item={"id": "it1", "assignment_id": "a1"}):
    db = _db([], quiz_questions=_QS, course_writing_submissions=list(existing))
    with patch.object(qs, "supabase_admin", db), \
         patch.object(qs, "_assignment_item_for", lambda b, u: item), \
         patch.object(qs, "_bank_meta_or_404", lambda b, u=None: {"id": b, "skill_area": "course"}):
        return qs.course_writing_state(user_id="u1", bank_id="b1")


def test_before_submitting_the_model_answer_is_withheld():
    """`explain` là ĐÁP ÁN MẪU. Trả nó trước khi nộp là phát đáp án."""
    st = _state()
    assert st["submitted"] is False
    assert all("explain" not in q for q in st["questions"])


def test_after_submitting_the_model_answer_comes_with_the_marking():
    st = _state([{"id": "s1", "bank_id": "b1", "user_id": "u1",
                  "class_assignment_item_id": "it1", "items": [],
                  "total": 2, "clean": 1, "graded_at": "t"}])
    assert st["submitted"] is True
    assert all("explain" in q for q in st["questions"])
    assert st["submission"]["clean"] == 1


# ── Bộ chấm: sửa lỗi, KHÔNG nâng cấp câu ─────────────────────────────────────

def test_prompt_forbids_upgrading_in_plain_words():
    # Ranh giới này là toàn bộ lý do bộ chấm tồn tại: một bản sửa "hay hơn" trả
    # về câu học viên chưa học tới sẽ dạy sai trọng tâm buổi ấy.
    for phrase in ["KHÔNG nâng cấp câu", "đồng nghĩa", "NGUYÊN VĂN", "chính tả"]:
        assert phrase in cw._PROMPT, phrase


def test_grader_runs_at_temperature_zero():
    # Hai học viên viết giống nhau phải nhận cùng một bản sửa.
    import inspect
    src = inspect.getsource(cw._model)
    assert "temperature=0.0" in src


@pytest.mark.asyncio
async def test_a_broken_model_never_says_the_sentence_was_fine():
    """`ok=True` khi model hỏng là một lời khen bịa ra — tệ nhất bộ này có thể làm."""
    items = [{"qid": "E1", "prompt": "p", "answer": "a"}]
    with patch.object(cw, "_model", side_effect=RuntimeError("no key")):
        out, _ = await cw.grade(items)
    assert out[0]["ok"] is None, "chưa chấm được phải khác hẳn đã-chấm-và-đúng"
    assert out[0]["error"]


@pytest.mark.asyncio
async def test_ok_is_derived_from_issues_not_from_the_models_own_flag():
    """Model hay trả ok=true kèm danh sách lỗi không rỗng. Khi hai thứ mâu
    thuẫn, danh sách lỗi mới là thứ học viên đọc."""
    class _R:
        text = ('{"results":[{"qid":"E1","corrected":"I am a student.",'
                '"ok":true,"issues":[{"type":"grammar","before":"am","after":"is"}]}]}')
    fake = type("M", (), {"generate_content_async": AsyncMock(return_value=_R())})()
    with patch.object(cw, "_model", return_value=("m", fake)):
        out, _ = await cw.grade([{"qid": "E1", "prompt": "p", "answer": "I am a student."}])
    assert out[0]["ok"] is False


# ── Lỗi HÌNH THỨC không đánh rớt một câu ngữ pháp đúng ──────────────────────
#
# Dữ liệu thật, 07/08: em Lê Ngọc Hà Linh nộp 10 câu, nhận 0/10. Tám câu bị trừ
# vì viết thường đầu câu, NĂM trong số đó không có lỗi nào khác.

async def _one(issues, answer="the audience found the documentary shocking",
               corrected="The audience found the documentary shocking."):
    class _R:
        text = json.dumps({"results": [{"qid": "E1", "corrected": corrected,
                                        "ok": False, "issues": issues}]})
    fake = type("M", (), {"generate_content_async": AsyncMock(return_value=_R())})()
    with patch.object(cw, "_model", return_value=("m", fake)):
        out, _ = await cw.grade([{"qid": "E1", "prompt": "p", "answer": answer}])
    return out[0]


@pytest.mark.asyncio
async def test_a_lowercase_first_letter_does_not_fail_a_correct_sentence():
    g = await _one([{"type": "grammar", "before": "the", "after": "The",
                     "note": "Câu cần bắt đầu bằng chữ cái viết hoa."}])
    assert g["ok"] is True, "câu dựng đúng khung không được rớt vì một chữ hoa"
    assert g["issues"][0]["type"] == cw.MECHANICS, "vẫn phải BÁO, chỉ là không tính"


@pytest.mark.asyncio
async def test_the_pronoun_I_and_a_missing_full_stop_are_form_not_grammar():
    for issue in ({"type": "grammar", "before": "i", "after": "I"},
                  {"type": "grammar", "before": "autumn", "after": "autumn."},
                  {"type": "grammar", "before": "found  the", "after": "found the"}):
        g = await _one([issue])
        assert g["ok"] is True, issue
        assert g["issues"][0]["type"] == cw.MECHANICS, issue


@pytest.mark.asyncio
async def test_a_real_grammar_error_still_fails_even_beside_a_form_error():
    g = await _one([{"type": "grammar", "before": "air", "after": "Air"},
                    {"type": "grammar", "before": "make", "after": "makes"}],
                   answer="air pollution make him tired")
    assert g["ok"] is False, "chia sai động từ vẫn là sai, dù đứng cạnh lỗi hình thức"
    assert [x["type"] for x in g["issues"]] == [cw.MECHANICS, "grammar"]


@pytest.mark.parametrize("before,after", [
    ("its", "it's"),            # dấu lược MANG NGHĨA
    ("students", "student's"),  # sở hữu cách
    ("alot", "a lot"),          # tách từ
    ("in to", "into"),          # dính từ
    ("hes", "he's"),
])
@pytest.mark.asyncio
async def test_apostrophes_and_word_boundaries_stay_countable(before, after):
    """Bản đầu cắt sạch mọi ký tự không-phải-chữ rồi so, nên bốn lỗi thật này
    cho hai lõi giống hệt nhau và được ghi lại là câu ĐÚNG (codex #1000, P1).

    Dấu lược và ranh giới từ đổi mặt chữ; khoảng trắng thừa với dấu chấm cuối
    câu thì không. Chỉ ba thứ sau mới là hình thức."""
    g = await _one([{"type": "spelling", "before": before, "after": after}])
    assert g["issues"][0]["type"] != cw.MECHANICS, f"{before!r}→{after!r} là lỗi thật"
    assert g["ok"] is False


@pytest.mark.asyncio
async def test_the_model_cannot_hide_a_word_change_by_calling_it_mechanics():
    """Nhãn `mechanics` do PHÉP SO đặt, không do model đặt.

    Tin nhãn của model là mở một đường cho mọi lỗi ngữ pháp trốn khỏi ô đúng/sai
    — chỉ cần model gọi tên nó khác đi.
    """
    g = await _one([{"type": "mechanics", "before": "rise", "after": "are"}])
    assert g["ok"] is False
    assert g["issues"][0]["type"] == "grammar"


@pytest.mark.asyncio
async def test_an_issue_with_nothing_to_compare_stays_countable():
    """`before`/`after` cùng rỗng thì không so được — và đoán rằng nó vô hại là
    âm thầm nâng điểm."""
    g = await _one([{"type": "grammar", "note": "Thiếu ô V."}])
    assert g["ok"] is False
    assert g["issues"][0]["type"] == "grammar"


def test_the_prompt_tells_the_model_that_form_errors_are_their_own_kind():
    for phrase in ["mechanics", "viết hoa đầu câu", "KHÔNG"]:
        assert phrase in cw._PROMPT, phrase


@pytest.mark.asyncio
async def test_a_question_the_model_skipped_is_reported_alone():
    class _R:
        text = '{"results":[{"qid":"E1","corrected":"x","issues":[]}]}'
    fake = type("M", (), {"generate_content_async": AsyncMock(return_value=_R())})()
    with patch.object(cw, "_model", return_value=("m", fake)):
        out, _ = await cw.grade([{"qid": "E1", "prompt": "p", "answer": "x"},
                                 {"qid": "E2", "prompt": "p", "answer": "y"}])
    assert out[0]["ok"] is True
    assert out[1]["ok"] is None, "thiếu MỘT câu không được kéo cả cụm xuống"


# ── Đáp án mẫu KHÔNG lọt qua đường phát đề (codex #935) ─────────────────────

def test_the_play_endpoint_never_ships_writing_answers():
    """`get_bank_for_play` dùng select("*"), nên `explain` (đáp án mẫu) nằm sẵn
    trong phản hồi mạng. Lọc ở trình duyệt chỉ là trang trí — mở tab Network là
    đọc được, mà lượt viết chỉ có MỘT."""
    rows = [
        {"qid": "M1", "type": "mcq", "explain": "giải thích trắc nghiệm",
         "answer": 0, "accept": None, "bank_id": "b1", "order": 1},
        {"qid": "E1", "type": "writing", "explain": "ĐÁP ÁN MẪU",
         "answer": None, "accept": ["x"], "bank_id": "b1", "order": 90},
    ]
    db = _db([], quiz_banks=[{"id": "b1", "code": "C1-B01", "skill_area": "course"}],
             quiz_questions=rows)
    with patch.object(qs, "supabase_admin", db), \
         patch.object(qs, "_assignment_item_for", lambda b, u: {"id": "it1", "assignment_id": "a1"}), \
         patch.object(qs, "_word_cards_for", lambda b: {}), \
         patch.object(qs, "_attach_article_urls", lambda q: None), \
         patch.object(qs, "_resolve_question_audio", lambda q, w: None), \
         patch.object(qs, "mastery_config", lambda a: {"pass_pct": 80, "retake_size": 20}):
        out = qs.get_bank_for_play("b1", user_id="u1")

    by = {q["qid"]: q for q in out["questions"]}
    assert by["E1"]["explain"] is None, "đáp án mẫu của câu tự luận không được đi qua đây"
    assert by["E1"]["accept"] is None
    # Trắc nghiệm thì VẪN phải có — client chấm tại chỗ và hiện giải thích ngay.
    assert by["M1"]["explain"] == "giải thích trắc nghiệm"
    assert by["M1"]["answer"] == 0


# ── Chốt sổ bài giao khi nộp tự luận (codex #935) ───────────────────────────

@pytest.mark.asyncio
async def test_submitting_writing_stamps_the_assignment_ledger():
    """Bank CHỈ có tự luận không sinh phiên quiz nào, nên đây là đường chốt sổ
    DUY NHẤT. Thiếu nó, bài đã nộp vẫn nằm ở "Cần nộp" rồi thành "Quá hạn"."""
    seen = {}
    def fake_mark(db, *, item_id, artifact_kind, artifact_id, score=None, now=None):
        seen.update(item_id=item_id, kind=artifact_kind, score=score)
        return True
    # Khai HÌNH DẠNG BỘ ĐỀ tường minh, đúng tiền đề của chính chốt này ("bank
    # CHỈ có tự luận"). Bộ giả ở tệp này không phục vụ `quiz_questions`, nên
    # `bank_has_mcq` sẽ trả True theo chiều an toàn và chốt đỏ vì một lý do
    # không liên quan tới thứ nó kiểm.
    with patch.object(qs, "mark_item_submitted", fake_mark), \
         patch.object(qs, "bank_has_mcq", lambda _b: False):
        await _submit({"E1": "a", "E2": "b"})
    assert seen["item_id"] == "it1"
    assert seen["kind"] == "course_writing", "mượn 'quiz_session' là trỏ vào bảng không có dòng ấy"
    assert seen["score"] == 100.0


@pytest.mark.asyncio
async def test_a_MIXED_bank_is_stamped_WITHOUT_touching_the_quiz_score():
    """Bộ đề có trắc nghiệm ⇒ vẫn chốt sổ, nhưng KHÔNG ghi điểm.

    Điểm của mục là kết quả trắc nghiệm mà `course_verdict` đã ghi và `passed_at`
    được xét trên. Đây là đường chạy THẬT trên sản phẩm, và nó đã xoá điểm của
    11/11 mục trên prod.
    """
    seen = {}
    def fake_mark(db, *, item_id, artifact_kind, artifact_id, score=None, now=None):
        seen.update(item_id=item_id, kind=artifact_kind, score=score)
        return True
    with patch.object(qs, "mark_item_submitted", fake_mark), \
         patch.object(qs, "bank_has_mcq", lambda _b: True):
        await _submit({"E1": "a", "E2": "b"})
    assert seen["item_id"] == "it1", "vẫn phải chốt sổ"
    assert seen["kind"] == "course_writing"
    assert seen["score"] is None, "đã ghi đè lên kết quả trắc nghiệm"


@pytest.mark.asyncio
async def test_a_failed_ledger_write_does_not_lose_the_graded_writing():
    """Bài đã chấm và đã ghi rồi; sổ thì vá lại được bằng lượt đối chiếu."""
    def boom(*a, **k): raise RuntimeError("db down")
    with patch.object(qs, "mark_item_submitted", boom):
        out, _ = await _submit({"E1": "a", "E2": "b"})
    assert out["total"] == 2, "lượt nộp phải thành công dù chốt sổ hỏng"


# ── Giao LẠI cùng bộ bài = lượt MỚI (codex #935) ────────────────────────────

def test_a_re_give_is_a_fresh_attempt_not_the_old_one():
    """Khoá theo (bank, học viên) khiến lượt nộp của lần giao TRƯỚC làm lần giao
    SAU vĩnh viễn không nộp được — bài mới đứng mãi ở "Cần nộp"."""
    old_row = {"id": "s1", "bank_id": "b1", "user_id": "u1",
               "class_assignment_item_id": "it-CU", "items": [],
               "total": 2, "clean": 2, "graded_at": "t"}
    st = _state([old_row], item={"id": "it-MOI", "assignment_id": "a2"})
    assert st["submitted"] is False, "bài giao mới phải là một lượt chưa nộp"


@pytest.mark.asyncio
async def test_submitting_without_an_assignment_item_is_refused():
    """Một mục NULL lọt qua UNIQUE của Postgres (NULL không va nhau) — tức là
    nộp không giới hạn. Đòi có mục tường minh."""
    db = _db([], quiz_questions=_QS, course_writing_submissions=[])
    async def g(items): return [], "m"
    with patch.object(qs, "supabase_admin", db), \
         patch.object(qs, "_bank_meta_or_404", lambda b, u=None: {"id": b, "skill_area": "course"}), \
         patch.object(qs, "_assignment_item_for", lambda b, u: None), \
         patch.object(qs.course_writing_grader, "grade", g):
        with pytest.raises(HTTPException) as e:
            await qs.submit_course_writing(user_id="u1", bank_id="b1",
                                           answers={"E1": "a", "E2": "b"})
    assert e.value.status_code == 404


# ── Câu quá dài: TỪ CHỐI, không chấm một nửa (codex #935) ───────────────────

@pytest.mark.asyncio
async def test_an_over_long_answer_is_refused_before_any_model_call():
    """Bộ chấm chỉ gửi đi MAX_ANSWER_CHARS ký tự, còn bản lưu và bản so sai→sửa
    dùng câu ĐẦY ĐỦ — phần đuôi model chưa từng đọc sẽ hiện ra như bị xoá."""
    called = {"n": 0}
    async def counting(items):
        called["n"] += 1
        return [], None
    db = _db([], quiz_questions=_QS, course_writing_submissions=[])
    with patch.object(qs, "supabase_admin", db), \
         patch.object(qs, "_bank_meta_or_404", lambda b, u=None: {"id": b, "skill_area": "course"}), \
         patch.object(qs, "_assignment_item_for", lambda b, u: {"id": "it1"}), \
         patch.object(qs.course_writing_grader, "grade", counting):
        with pytest.raises(HTTPException) as e:
            await qs.submit_course_writing(
                user_id="u1", bank_id="b1",
                answers={"E1": "x" * (cw.MAX_ANSWER_CHARS + 1), "E2": "ngắn"})
    assert e.value.status_code == 422
    assert e.value.detail["too_long"] == ["E1"]
    assert called["n"] == 0, "đừng gọi model rồi mới phát hiện"


@pytest.mark.asyncio
async def test_an_answer_exactly_at_the_limit_is_accepted():
    # Trần là ĐƯỢC PHÉP bằng, không phải nhỏ hơn — lệch một ký tự ở biên là
    # kiểu lỗi không ai đọc ra được từ thông báo.
    out, _ = await _submit({"E1": "x" * cw.MAX_ANSWER_CHARS, "E2": "b"})
    assert out["total"] == 2
