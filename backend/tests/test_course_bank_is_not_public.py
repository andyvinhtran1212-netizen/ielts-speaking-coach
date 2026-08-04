"""Bài tập theo BUỔI HỌC không phải nội dung tự chọn.

Nó nằm trong kho của giáo viên và chỉ tới tay một học viên khi em đó ĐƯỢC GIAO.
Hai cửa phải khoá, và khoá bằng CẤU TẠO chứ không bằng quy ước "nhớ để nháp":

  · liệt kê — `skill_area` do người gọi truyền, nên không loại trừ nghĩa là bất
    kỳ ai gọi `?skill_area=course` cũng đọc được toàn bộ giáo trình;
  · mở bài  — xuất bản KHÔNG mở cửa; phải có bài giao cho chính em ấy.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from services import quiz_service as mod


class _Resp:
    def __init__(self, data): self.data = data


class _Table:
    def __init__(self, rows):
        self._rows = list(rows)

    def select(self, *_a, **_k): return self

    def eq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self

    def neq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) != str(v)]
        return self

    def in_(self, f, vals):
        self._rows = [r for r in self._rows if r.get(f) in vals]
        return self

    def order(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def execute(self): return _Resp(self._rows)


def _db(**tables):
    db = type("DB", (), {})()
    db.table = lambda n: _Table(tables.get(n, []))
    return db


_COURSE_BANK = {"id": "bank-course", "code": "C1-B01", "skill_area": "course",
                "title": "Buổi 1", "is_published": True, "topic_id": None,
                "words_count": 100, "updated_at": "2026-08-04"}
_VOCAB_BANK = {"id": "bank-vocab", "code": "V-01", "skill_area": "vocab",
               "title": "Từ vựng", "is_published": True, "topic_id": "t1",
               "words_count": 20, "updated_at": "2026-08-04"}


# ── Cửa 1: liệt kê ───────────────────────────────────────────────────────────

def test_a_course_bank_never_appears_in_the_student_listing():
    db = _db(quiz_banks=[_COURSE_BANK, _VOCAB_BANK])
    with patch.object(mod, "supabase_admin", db):
        codes = [b["code"] for b in mod.list_published_banks()]
    assert codes == ["V-01"], "giáo trình không được nằm trong danh sách tự chọn"


def test_asking_for_the_course_area_by_name_returns_NOTHING():
    """`skill_area` đến từ người gọi. Chỉ dựa vào 'không trang nào hỏi nó' là dựa
    vào một thói quen, không phải một chốt."""
    db = _db(quiz_banks=[_COURSE_BANK, _VOCAB_BANK])
    with patch.object(mod, "supabase_admin", db):
        assert mod.list_published_banks(skill_area="course") == []


def test_the_other_areas_still_list_normally():
    """Chốt ngược: khoá quá tay sẽ làm hỏng kho từ vựng và ngữ pháp đang chạy."""
    db = _db(quiz_banks=[_COURSE_BANK, _VOCAB_BANK])
    with patch.object(mod, "supabase_admin", db):
        assert [b["code"] for b in mod.list_published_banks(skill_area="vocab")] == ["V-01"]


# ── Cửa 2: mở bài ────────────────────────────────────────────────────────────

def _play(db, user_id="u1"):
    with patch.object(mod, "supabase_admin", db):
        return mod.get_bank_for_play("bank-course", user_id=user_id)


def test_a_published_course_bank_is_still_CLOSED_without_an_assignment():
    """Xuất bản KHÔNG mở cửa cho giáo trình. Nếu có thì một lần bấm 'xuất bản'
    trong trang admin là mở toàn bộ khoá cho mọi học viên."""
    db = _db(quiz_banks=[_COURSE_BANK], quiz_questions=[],
             class_assignments=[], students=[], class_assignment_items=[])
    with pytest.raises(HTTPException) as exc:
        _play(db)
    assert exc.value.status_code == 404


def test_it_answers_404_not_403():
    """403 xác nhận bank ấy tồn tại. Với nội dung giáo trình thì chính sự tồn tại
    cũng không cần nói ra."""
    db = _db(quiz_banks=[_COURSE_BANK], class_assignments=[], students=[])
    with pytest.raises(HTTPException) as exc:
        _play(db)
    assert exc.value.status_code == 404
    assert "403" not in str(exc.value.detail)


def test_an_ASSIGNED_student_can_open_it():
    db = _db(
        quiz_banks=[_COURSE_BANK],
        quiz_questions=[{"id": "q1", "bank_id": "bank-course", "order": 0,
                         "type": "mcq", "item_key": "x"}],
        class_assignments=[{"id": "asg-1", "content_id": "bank-course"}],
        students=[{"id": "st-1", "user_id": "u1"}],
        class_assignment_items=[{"id": "it-1", "assignment_id": "asg-1", "student_id": "st-1"}],
    )
    with patch.object(mod, "_word_cards_for", lambda *_a, **_k: []), \
         patch.object(mod, "_attach_article_urls", lambda *_a, **_k: None), \
         patch.object(mod, "_resolve_question_audio", lambda *_a, **_k: None):
        out = _play(db)
    assert out["bank"]["code"] == "C1-B01"
    assert len(out["questions"]) == 1


def test_ANOTHER_students_assignment_does_not_open_it():
    """Bài giao của bạn cùng lớp không phải bài giao của em ấy.

    Em u1 PHẢI là một học viên có thật ở đây — nếu để em ấy không có hồ sơ nào
    thì hàm thoát sớm ở bước tra học viên và bộ lọc `student_id` không bao giờ
    chạy, nên phép thử trông đúng mà chẳng chứng minh gì. (Phá-thử-ngược bắt
    được: bỏ hẳn bộ lọc ấy mà bản test cũ vẫn xanh.)"""
    db = _db(
        quiz_banks=[_COURSE_BANK],
        class_assignments=[{"id": "asg-1", "content_id": "bank-course"}],
        students=[{"id": "st-1", "user_id": "u1"},        # chính em ấy
                  {"id": "st-2", "user_id": "u-khac"}],   # bạn cùng lớp
        # Bài giao thuộc về BẠN CÙNG LỚP, không phải em ấy.
        class_assignment_items=[{"id": "it-1", "assignment_id": "asg-1", "student_id": "st-2"}],
    )
    with pytest.raises(HTTPException) as exc:
        _play(db, user_id="u1")
    assert exc.value.status_code == 404


def test_an_assignment_for_a_DIFFERENT_bank_does_not_open_it():
    db = _db(
        quiz_banks=[_COURSE_BANK],
        class_assignments=[{"id": "asg-1", "content_id": "bank-khac"}],
        students=[{"id": "st-1", "user_id": "u1"}],
        class_assignment_items=[{"id": "it-1", "assignment_id": "asg-1", "student_id": "st-1"}],
    )
    with pytest.raises(HTTPException) as exc:
        _play(db)
    assert exc.value.status_code == 404


def test_an_anonymous_caller_is_refused():
    db = _db(quiz_banks=[_COURSE_BANK])
    with patch.object(mod, "supabase_admin", db), pytest.raises(HTTPException):
        mod.get_bank_for_play("bank-course", user_id=None)


def test_a_failed_lookup_CLOSES_the_door():
    """Mở cửa khi chốt hỏng là biến một lỗi tạm thời thành một lần lộ nội dung."""
    db = _db(quiz_banks=[_COURSE_BANK])

    def boom(_name):
        raise RuntimeError("mất kết nối")
    db.table = lambda n: (_Table([_COURSE_BANK]) if n == "quiz_banks" else boom(n))
    with pytest.raises(HTTPException) as exc:
        _play(db)
    assert exc.value.status_code == 404


def test_a_vocab_bank_is_NOT_gated_by_assignments():
    """Chốt ngược: kho từ vựng vẫn là nội dung tự chọn, không được đòi bài giao."""
    db = _db(quiz_banks=[_VOCAB_BANK], quiz_questions=[])
    with patch.object(mod, "supabase_admin", db), \
         patch.object(mod, "_word_cards_for", lambda *_a, **_k: []), \
         patch.object(mod, "_attach_article_urls", lambda *_a, **_k: None), \
         patch.object(mod, "_resolve_question_audio", lambda *_a, **_k: None):
        out = mod.get_bank_for_play("bank-vocab", user_id="u1")
    assert out["bank"]["code"] == "V-01"
