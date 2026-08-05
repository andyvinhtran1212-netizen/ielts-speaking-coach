"""Phần TỰ LUẬN của bài tập theo buổi.

Hai luật người dùng đặt ra, và cả hai đều là chỗ dễ hỏng:

  · MỘT LƯỢT DUY NHẤT mỗi học viên mỗi bank — ràng buộc thật ở UNIQUE của
    migration 190, không phải một câu `if` ai đó phải nhớ.
  · ĐỦ CÂU MỚI NHẬN — thiếu một câu thì giữ nháp và chờ, KHÔNG tiêu mất lượt
    chấm duy nhất cho một bài dở dang.

Và một luật của chính bộ chấm: sửa NGỮ PHÁP + CHÍNH TẢ, không nâng cấp câu.
"""

from __future__ import annotations

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
             course_writing_submissions=[{"id": "sub1", "bank_id": "b1", "user_id": "u1"}])
    with patch.object(qs, "supabase_admin", db), \
         patch.object(qs, "_bank_meta_or_404", lambda b, u=None: {"id": b, "skill_area": "course"}), \
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
         patch.object(qs, "_assignment_item_for", lambda b, u: None), \
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

def _state(existing=()):
    db = _db([], quiz_questions=_QS, course_writing_submissions=list(existing))
    with patch.object(qs, "supabase_admin", db), \
         patch.object(qs, "_bank_meta_or_404", lambda b, u=None: {"id": b, "skill_area": "course"}):
        return qs.course_writing_state(user_id="u1", bank_id="b1")


def test_before_submitting_the_model_answer_is_withheld():
    """`explain` là ĐÁP ÁN MẪU. Trả nó trước khi nộp là phát đáp án."""
    st = _state()
    assert st["submitted"] is False
    assert all("explain" not in q for q in st["questions"])


def test_after_submitting_the_model_answer_comes_with_the_marking():
    st = _state([{"id": "s1", "bank_id": "b1", "user_id": "u1", "items": [],
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
