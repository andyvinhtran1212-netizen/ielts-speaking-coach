"""routers/class_student — trang lớp phía học viên (GĐ 3).

`GET /api/class/me` feeds one page, so its failure behaviour is the thing worth
pinning:

  * **Not being in a class is an ordinary answer**, not a 404. Most learners join
    on a mass code and belong to no class; the page explains that and the home
    card hides itself.

  * **One block failing must not take the others down.** A class page that 500s
    because the lessons query hiccuped hides the homework too — and the homework
    is the part the student came for. Each block degrades on its own and names
    itself in `degraded`.

  * **Counts come from the rendered list.** `progress` is computed from the same
    assignments the page shows, so the summary can never disagree with the rows
    underneath it — and it is `None`, never zeros, when that list failed to load.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from routers import class_student as mod


NOW = datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc)      # 19:00 giờ VN


def _assignment(*, submitted=False, late=False, missing=False, due_offset_h=2):
    due = (NOW + timedelta(hours=due_offset_h)).isoformat()
    return {
        "item_id": "i", "state": "submitted" if submitted else "assigned",
        "submitted_at": NOW.isoformat() if submitted else None,
        "score": 6.5 if submitted else None,
        "is_late": late, "is_missing": missing,
        "assignment": {"id": "a", "title": "t", "skill": "speaking",
                       "instructions": None, "due_at": due, "content_config": {}},
    }


# ── tiến độ tính từ chính danh sách hiển thị ────────────────────────────


def test_progress_counts_match_the_rendered_list():
    rows = [
        _assignment(submitted=True),
        _assignment(submitted=True, late=True),
        _assignment(),                       # chưa tới hạn
        _assignment(missing=True),           # quá hạn, chưa nộp
    ]
    p = mod._progress_summary(rows)
    assert p["total"] == 4
    assert p["submitted"] == 2
    assert p["late"] == 1
    assert p["missing"] == 1
    assert p["todo"] == 1, "todo must exclude both submitted and overdue work"


def test_on_time_percentage_is_over_hand_ins_not_over_everything():
    """Dividing by `total` would drag punctuality down for work that is not even
    due yet — a student who has submitted everything on time so far would see
    less than 100% simply for having homework left."""
    rows = [_assignment(submitted=True), _assignment(submitted=True),
            _assignment(), _assignment(), _assignment()]
    assert mod._progress_summary(rows)["on_time_pct"] == 100


def test_one_late_hand_in_out_of_four():
    rows = [_assignment(submitted=True) for _ in range(3)]
    rows.append(_assignment(submitted=True, late=True))
    assert mod._progress_summary(rows)["on_time_pct"] == 75


def test_no_hand_ins_yet_reports_unknown_not_zero():
    """0% would read as "always late"; the student simply has not submitted
    anything yet."""
    assert mod._progress_summary([_assignment()])["on_time_pct"] is None


def test_empty_list_is_all_zeros_and_no_percentage():
    p = mod._progress_summary([])
    assert (p["total"], p["submitted"], p["missing"], p["todo"]) == (0, 0, 0, 0)
    assert p["on_time_pct"] is None


# ── không thuộc lớp nào là câu trả lời bình thường ──────────────────────


@pytest.mark.asyncio
async def test_no_student_row_is_not_an_error():
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value=None):
        out = await mod.my_class(None)
    assert out == {"has_class": False}


@pytest.mark.asyncio
async def test_student_with_no_cohort_is_not_an_error():
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value={"id": "s1", "cohort_id": None}):
        out = await mod.my_class(None)
    assert out == {"has_class": False}


# ── một khối hỏng không kéo cả trang xuống ──────────────────────────────


class _Resp:
    def __init__(self, data):
        self.data = data


class _Table:
    def __init__(self, rows, raises):
        self._rows, self._raises = rows, raises

    def select(self, *_a, **_k): return self
    def eq(self, *_a): return self
    def order(self, *_a, **_k): return self
    def range(self, *_a): return self
    def limit(self, *_a): return self
    def in_(self, *_a): return self
    def is_(self, *_a): return self

    @property
    def not_(self): return self

    def execute(self):
        if self._raises:
            raise RuntimeError("boom")
        return _Resp(self._rows)


def _db(fail: set[str]):
    tables = {
        "cohorts": [{"id": "c1", "name": "C2-K12", "course_id": None}],
        "courses": [],
        "class_lessons": [{"id": "l1", "title": "Buổi 1", "lesson_no": 1,
                           "lesson_date": None, "created_at": "x"}],
        "class_assignment_items": [],
        "class_assignments": [],
    }
    db = type("DB", (), {})()
    db.table = lambda name: _Table(tables.get(name, []), name in fail)
    return db


async def _call(fail: set[str]):
    student = {"id": "s1", "cohort_id": "c1", "full_name": "A", "student_code": "S1"}
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value=student), \
         patch.object(mod, "supabase_admin", _db(fail)):
        return await mod.my_class(None)


@pytest.mark.asyncio
async def test_a_broken_lessons_query_still_returns_the_homework():
    out = await _call({"class_lessons"})
    assert out["has_class"] is True
    assert "lessons" in out["degraded"]
    assert "assignments" not in out["degraded"], "the part the student came for must survive"
    assert out["progress"] is not None


@pytest.mark.asyncio
async def test_a_broken_assignments_query_leaves_progress_unknown():
    """Zeros here would tell the student they owe nothing — the one thing this
    page must never say wrongly."""
    out = await _call({"class_assignment_items"})
    assert "assignments" in out["degraded"]
    assert out["progress"] is None
    assert out["assignments"] == []


@pytest.mark.asyncio
async def test_a_broken_class_query_still_lists_work():
    out = await _call({"cohorts"})
    assert "class" in out["degraded"]
    assert out["has_class"] is True


@pytest.mark.asyncio
async def test_nothing_broken_means_no_degraded_key_at_all():
    out = await _call(set())
    assert "degraded" not in out
    assert out["class"]["name"] == "C2-K12"
    assert [l["title"] for l in out["lessons"]] == ["Buổi 1"]
