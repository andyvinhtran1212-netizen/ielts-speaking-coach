"""LEARNERCORE-0063 FR-120 (OQ17, G07-T30c): `GET /api/class/me` adds, for
each class, `instructor: {name} | null` and `weekly_schedule: [{dow, start}]`
from the migration 441 columns.

  * no teacher, or a teacher with an empty name → `instructor: null`;
  * `weekly_schedule` null or malformed → `[]`;
  * a failed read of those columns (or of `users`) empties both fields and adds
    `class_meta` to `degraded`; every other field stays exactly as before;
  * only `display_name` reaches the learner, never the teacher's email;
  * nothing is written.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from routers import class_student as mod


class _Resp:
    def __init__(self, data):
        self.data = data


class _Table:
    def __init__(self, db, name):
        self.db, self.name, self.cols, self.ids = db, name, "*", None

    def select(self, cols="*", **_k):
        self.cols = cols
        return self

    def in_(self, col, vals):
        if col == "id":
            self.ids = set(vals)
        return self

    def eq(self, *_a): return self
    def order(self, *_a, **_k): return self
    def range(self, *_a): return self
    def limit(self, *_a): return self
    def is_(self, *_a): return self

    @property
    def not_(self): return self

    def _write(self, *_a, **_k):
        self.db.writes.append(self.name)
        return self

    insert = update = upsert = delete = _write

    def execute(self):
        self.db.reads.append((self.name, self.cols))
        if (self.name, self.cols) in self.db.fail or self.name in self.db.fail:
            raise RuntimeError("boom")
        rows = self.db.tables.get(self.name, [])
        if self.ids is not None:
            rows = [r for r in rows if r.get("id") in self.ids]
        return _Resp([dict(r) for r in rows])


TEACHER = "t-1"


class _DB:
    def __init__(self, fail=()):
        self.fail = set(fail)
        self.reads: list = []
        self.writes: list = []
        self.tables = {
            "cohorts": [
                {"id": "c1", "name": "IELTS 6.5 tối 2-4", "description": "Lớp tối",
                 "course_id": None, "instructor_id": TEACHER,
                 "weekly_schedule": [{"dow": 3, "start": "18:30"}, {"dow": 1, "start": "18:30"}]},
                {"id": "c2", "name": "Lớp phụ", "description": None, "course_id": None,
                 "instructor_id": None, "weekly_schedule": None},
            ],
            "users": [{"id": TEACHER, "display_name": "Trần Thu Hà", "email": "ha@x.test"}],
            "courses": [],
            "class_lessons": [],
            "class_assignment_items": [],
            "class_assignments": [],
            "student_cohort_memberships": [
                {"id": "m1", "student_id": "s1", "cohort_id": "c1", "is_active": True},
                {"id": "m2", "student_id": "s1", "cohort_id": "c2", "is_active": True},
            ],
        }

    def table(self, name):
        return _Table(self, name)


async def _call(db, summary=False):
    student = {"id": "s1", "cohort_id": "c1", "full_name": "A", "student_code": "S1"}
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value=student), \
         patch.object(mod, "active_cohort_ids_for_student", return_value=["c1", "c2"]), \
         patch.object(mod, "supabase_admin", db):
        return await mod.my_class(summary=summary, authorization=None)


def _by_id(out):
    return {c["id"]: c for c in out["classes"]}


@pytest.mark.asyncio
async def test_each_class_carries_its_teacher_name_and_schedule():
    db = _DB()
    out = await _call(db)
    classes = _by_id(out)
    assert classes["c1"]["instructor"] == {"name": "Trần Thu Hà"}
    assert classes["c1"]["weekly_schedule"] == [{"dow": 3, "start": "18:30"},
                                                {"dow": 1, "start": "18:30"}]
    assert out["class"]["id"] == "c1" and out["class"]["instructor"] == {"name": "Trần Thu Hà"}
    assert "degraded" not in out
    assert db.writes == []
    assert ("cohorts", "id, instructor_id, weekly_schedule") in db.reads
    assert ("users", "id, display_name") in db.reads


@pytest.mark.asyncio
async def test_teacher_email_never_reaches_the_learner():
    out = await _call(_DB())
    assert "ha@x.test" not in repr(out)


@pytest.mark.asyncio
async def test_class_without_teacher_is_null_and_null_schedule_is_empty():
    classes = _by_id(await _call(_DB()))
    assert classes["c2"]["instructor"] is None
    assert classes["c2"]["weekly_schedule"] == []


@pytest.mark.asyncio
async def test_teacher_with_an_empty_name_or_missing_user_row_is_null():
    db = _DB()
    db.tables["users"] = [{"id": TEACHER, "display_name": "  ", "email": "ha@x.test"}]
    assert _by_id(await _call(db))["c1"]["instructor"] is None
    db = _DB()
    db.tables["users"] = []
    assert _by_id(await _call(db))["c1"]["instructor"] is None


@pytest.mark.parametrize("schedule", [
    "Thứ Hai 18:30",
    {"dow": 1, "start": "18:30"},
    [{"dow": 0, "start": "18:30"}],
    [{"dow": 8, "start": "18:30"}],
    [{"dow": True, "start": "18:30"}],
    [{"dow": "1", "start": "18:30"}],
    [{"dow": 1, "start": "6:30"}],
    [{"dow": 1, "start": "24:00"}],
    [{"dow": 1}],
    [{"dow": 1, "start": "18:30"}, "x"],
])
@pytest.mark.asyncio
async def test_malformed_schedule_is_empty(schedule):
    db = _DB()
    db.tables["cohorts"][0]["weekly_schedule"] = schedule
    out = await _call(db)
    assert _by_id(out)["c1"]["weekly_schedule"] == []
    assert _by_id(out)["c1"]["instructor"] == {"name": "Trần Thu Hà"}
    assert "degraded" not in out


@pytest.mark.parametrize("fail", [
    ("cohorts", "id, instructor_id, weekly_schedule"),
    "users",
])
@pytest.mark.asyncio
async def test_failed_meta_read_empties_both_fields_and_flags_class_meta(fail):
    healthy = await _call(_DB())
    out = await _call(_DB(fail={fail}))
    assert out["degraded"] == ["class_meta"]
    for cls in out["classes"]:
        assert cls["instructor"] is None and cls["weekly_schedule"] == []

    def strip(o):
        return {**o, "classes": [{k: v for k, v in c.items()
                                  if k not in ("instructor", "weekly_schedule")}
                                 for c in o["classes"]],
                "class": {k: v for k, v in o["class"].items()
                          if k not in ("instructor", "weekly_schedule")}}

    rest = {k: v for k, v in strip(out).items() if k != "degraded"}
    assert rest == strip(healthy), "every older field must be unchanged"


@pytest.mark.asyncio
async def test_summary_carries_the_same_two_fields():
    out = await _call(_DB(), summary=True)
    assert _by_id(out)["c1"]["instructor"] == {"name": "Trần Thu Hà"}
    assert "lessons" not in out
