"""Giao bài tập theo BUỔI cho lớp.

Bài giao này là cửa DUY NHẤT mở một bank giáo trình (bank ấy không xuất bản và
không nằm trong danh sách tự chọn). Nên mọi điều kiện phải kiểm ở lệnh giao —
không có lớp bảo vệ nào phía sau.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from routers import admin_class_assignments as adm


class _Resp:
    def __init__(self, data, count=None): self.data = data; self.count = count


class _Table:
    def __init__(self, rows): self._rows = list(rows)
    def select(self, *_a, **k): self._count = "count" in k; return self
    def eq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self
    def in_(self, f, vals):
        self._rows = [r for r in self._rows if r.get(f) in vals]
        return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def range(self, s, e): self._rows = self._rows[s:e + 1]; return self
    def execute(self): return _Resp(self._rows, count=len(self._rows))


def _db(**tables):
    db = type("DB", (), {})()
    db.table = lambda n: _Table(tables.get(n, []))
    return db


_COHORT = {"id": "co-1", "name": "Lớp A", "course_id": "c-1"}
_BANK = {"id": "bank-1", "code": "C1-B01", "title": "Buổi 1", "skill_area": "course",
         "course_id": "c-1", "lesson_no": 1, "words_count": 100}


def _body(**over):
    kw = {"skill": "course", "title": "Bài tập buổi 1", "content_id": "bank-1"}
    kw.update(over)
    return adm.AssignmentCreate(**kw)


def _resolve(db, body=None):
    with patch.object(adm, "supabase_admin", db):
        return adm._resolve_course_bank("co-1", body or _body())


def _full(**over):
    t = {"cohorts": [_COHORT], "quiz_banks": [_BANK],
         "quiz_questions": [{"id": "q1", "bank_id": "bank-1"}],
         "class_assignments": []}
    t.update(over)
    return _db(**t)


# ── Nhận ─────────────────────────────────────────────────────────────────────

def test_a_valid_bank_resolves_with_display_labels_only():
    """Câu hỏi KHÔNG chụp vào bài giao: đề tới tay học viên qua endpoint quiz đã
    có cổng riêng, và chụp thêm một bản ở đây là tạo nguồn sự thật thứ hai."""
    bank_id, cfg = _resolve(_full())
    assert bank_id == "bank-1"
    assert cfg == {"test_title": "Buổi 1", "lesson_no": 1, "bank_code": "C1-B01"}
    assert "questions" not in cfg and "question_ids" not in cfg


# ── Từ chối ──────────────────────────────────────────────────────────────────

def test_a_bank_from_ANOTHER_course_is_refused():
    """Giao bộ của khoá khác là giao nội dung lớp này chưa học — và id đến từ
    trình duyệt, nên phải kiểm lại ở đây."""
    db = _full(quiz_banks=[{**_BANK, "course_id": "c-KHAC"}])
    with pytest.raises(HTTPException) as exc:
        _resolve(db)
    assert exc.value.status_code == 400
    assert "khoá khác" in exc.value.detail


def test_a_NON_course_bank_is_refused():
    """Bank từ vựng/ngữ pháp là nội dung tự chọn; giao qua đường này sẽ mở một
    trang không dựng cho chúng."""
    db = _full(quiz_banks=[{**_BANK, "skill_area": "vocab"}])
    with pytest.raises(HTTPException) as exc:
        _resolve(db)
    assert "không phải bài tập theo buổi" in exc.value.detail


def test_an_EMPTY_bank_is_refused():
    """Bank rỗng vẫn "tồn tại". Giao nó nghĩa là học viên mở ra trang trắng."""
    db = _full(quiz_questions=[])
    with pytest.raises(HTTPException) as exc:
        _resolve(db)
    assert "chưa có câu hỏi" in exc.value.detail


def test_an_unknown_bank_is_404():
    db = _full(quiz_banks=[])
    with pytest.raises(HTTPException) as exc:
        _resolve(db)
    assert exc.value.status_code == 404


def test_giving_the_same_lesson_twice_is_refused():
    db = _full(class_assignments=[{"id": "a1", "cohort_id": "co-1", "skill": "course",
                                   "content_id": "bank-1", "title": "Bài cũ"}])
    with pytest.raises(HTTPException) as exc:
        _resolve(db)
    assert exc.value.status_code == 409
    assert "Bài cũ" in exc.value.detail


def test_a_cohort_with_no_course_says_SO():
    """Danh sách rỗng đọc như "khoá chưa ai soạn đề", còn sự thật là lớp chưa
    được gắn khoá — hai việc khác nhau, và chỉ một sửa được ngay."""
    db = _full(cohorts=[{**_COHORT, "course_id": None}])
    with pytest.raises(HTTPException) as exc:
        _resolve(db)
    assert "chưa được gắn vào khoá" in exc.value.detail


def test_the_payload_requires_a_bank():
    with pytest.raises(ValueError):
        _body(content_id="")


def test_a_course_give_does_not_need_mode_or_part():
    """Bộ đề của buổi quyết định tất cả — đòi thêm mode/part là đòi một thông tin
    không tồn tại."""
    b = _body()
    assert b.skill == "course"


# ── Kho phía admin ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_library_separates_ALREADY_GIVEN_from_NOT_YET_LOADED():
    """Hai lý do khác nhau ⇒ hai việc khác nhau: một cái đã xong, một cái là nạp
    tệp JSONL của buổi ấy."""
    db = _db(
        cohorts=[_COHORT],
        quiz_banks=[_BANK,
                    {**_BANK, "id": "bank-2", "lesson_no": 2, "title": "Buổi 2"},
                    {**_BANK, "id": "bank-3", "lesson_no": 3, "title": "Buổi 3"}],
        quiz_questions=[{"id": "q1", "bank_id": "bank-1"},
                        {"id": "q2", "bank_id": "bank-2"}],
        class_assignments=[{"cohort_id": "co-1", "skill": "course", "content_id": "bank-2"}],
    )
    with patch.object(adm, "supabase_admin", db), \
         patch.object(adm, "require_admin", new=lambda *_a, **_k: _async({"id": "ad"})):
        out = await adm.list_course_banks("co-1", authorization="Bearer x")
    by = {b["lesson_no"]: b for b in out["items"]}
    assert by[1]["ready"] is True and by[1]["already_given"] is False
    assert by[2]["already_given"] is True
    assert by[3]["ready"] is False and by[3]["question_count"] == 0


def _async(v):
    async def _f(): return v
    return _f()
