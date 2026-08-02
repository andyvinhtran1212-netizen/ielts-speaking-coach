"""routers/admin_class_lessons — buổi học của lớp (GĐ 1, migration 176).

Pins the three behaviours that are quiet when wrong:

  * **Ordering.** lesson_no and lesson_date are both optional, so the list can
    mix numbered, dated and bare rows. Sorting is done server-side so every
    reader agrees; a naive sort puts unnumbered lessons first or raises on the
    None comparison.

  * **Blank date.** An empty <input type=date> posts `""`, which Postgres
    rejects as a date. The admin clearing the field must mean NULL, not a 500.

  * **Cohort scoping.** update and delete filter on cohort_id as well as the
    lesson id. Without it a stale tab can edit or delete a lesson that now
    belongs to a different class — and the request would look entirely normal.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from routers import admin_class_lessons as mod


COHORT = "aaaaaaaa-0000-0000-0000-000000000001"
OTHER = "bbbbbbbb-0000-0000-0000-000000000002"
LESSON = "cccccccc-0000-0000-0000-000000000003"


# ── ordering ────────────────────────────────────────────────────────────


def test_numbered_lessons_come_first_in_number_order():
    rows = [
        {"lesson_no": 3, "lesson_date": None, "created_at": "1"},
        {"lesson_no": 1, "lesson_date": None, "created_at": "2"},
        {"lesson_no": 2, "lesson_date": None, "created_at": "3"},
    ]
    assert [r["lesson_no"] for r in sorted(rows, key=mod._sort_key)] == [1, 2, 3]


def test_unnumbered_lessons_sort_last_by_date():
    """A class part-way through the term may add a dated lesson before it has a
    number. It belongs after the numbered ones, not first — and comparing None
    with int would otherwise raise."""
    rows = [
        {"lesson_no": None, "lesson_date": "2026-08-05", "created_at": "1"},
        {"lesson_no": 2, "lesson_date": None, "created_at": "2"},
        {"lesson_no": None, "lesson_date": "2026-08-01", "created_at": "3"},
    ]
    out = sorted(rows, key=mod._sort_key)
    assert out[0]["lesson_no"] == 2
    assert [r["lesson_date"] for r in out[1:]] == ["2026-08-01", "2026-08-05"]


def test_sort_key_never_compares_none_with_int():
    rows = [{"lesson_no": None, "lesson_date": None, "created_at": None},
            {"lesson_no": 5, "lesson_date": None, "created_at": None}]
    sorted(rows, key=mod._sort_key)      # must not raise


# ── blank date ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("model", [mod.LessonCreate, mod.LessonPatch])
def test_cleared_date_field_becomes_null(model):
    """"" is what an emptied date input posts; Postgres rejects it as a date."""
    assert model(title="Buổi 1", lesson_date="").lesson_date is None


def test_a_real_date_is_preserved():
    assert mod.LessonCreate(title="x", lesson_date="2026-08-03").lesson_date == "2026-08-03"


def test_lesson_no_must_be_positive():
    with pytest.raises(Exception):
        mod.LessonCreate(title="x", lesson_no=0)


def test_lesson_is_unpublished_by_default():
    """A half-typed lesson must never be visible to a class."""
    assert mod.LessonCreate(title="x").is_published is False


# ── cohort scoping ──────────────────────────────────────────────────────


class _Resp:
    def __init__(self, data):
        self.data = data


class _Recorder:
    """Records the eq() filters applied, and returns rows only when the lesson
    is matched within the cohort that was asked for."""

    def __init__(self, store):
        self.store = store
        self.eqs: dict[str, object] = {}

    def select(self, *_a, **_kw): return self
    def update(self, payload): self.store["payload"] = payload; return self
    def delete(self): self.store["deleted"] = True; return self
    def limit(self, *_a): return self

    def eq(self, field, value):
        self.eqs[field] = value
        self.store.setdefault("eqs", []).append((field, value))
        return self

    def execute(self):
        row = {"id": LESSON, "cohort_id": COHORT, "title": "Buổi 1"}
        matches = all(row.get(f) == v for f, v in self.eqs.items() if f in row)
        return _Resp([row] if matches else [])


@pytest.mark.asyncio
async def test_update_is_scoped_to_the_cohort_in_the_path():
    store: dict = {}
    with patch.object(mod, "require_admin", AsyncMock(return_value={"id": "admin"})), \
         patch.object(mod, "supabase_admin") as db:
        db.table.side_effect = lambda _n: _Recorder(store)
        await mod.update_lesson(COHORT, LESSON, mod.LessonPatch(title="Đổi tên"), None)

    assert ("cohort_id", COHORT) in store["eqs"], (
        "update must filter on cohort_id as well as the lesson id, or a stale "
        "tab can edit a lesson that now belongs to another class"
    )


@pytest.mark.asyncio
async def test_update_against_the_wrong_cohort_is_404_not_a_silent_noop():
    store: dict = {}
    with patch.object(mod, "require_admin", AsyncMock(return_value={"id": "admin"})), \
         patch.object(mod, "supabase_admin") as db:
        db.table.side_effect = lambda _n: _Recorder(store)
        with pytest.raises(Exception) as exc:
            await mod.update_lesson(OTHER, LESSON, mod.LessonPatch(title="x"), None)
    assert "404" in str(exc.value) or "Không tìm thấy" in str(exc.value)


@pytest.mark.asyncio
async def test_delete_is_scoped_to_the_cohort_in_the_path():
    store: dict = {}
    with patch.object(mod, "require_admin", AsyncMock(return_value={"id": "admin"})), \
         patch.object(mod, "supabase_admin") as db:
        db.table.side_effect = lambda _n: _Recorder(store)
        await mod.delete_lesson(COHORT, LESSON, None)

    assert store.get("deleted") is True
    assert ("cohort_id", COHORT) in store["eqs"]


@pytest.mark.asyncio
async def test_empty_patch_is_rejected_rather_than_stamping_updated_at():
    with patch.object(mod, "require_admin", AsyncMock(return_value={"id": "admin"})):
        with pytest.raises(Exception) as exc:
            await mod.update_lesson(COHORT, LESSON, mod.LessonPatch(), None)
    assert "400" in str(exc.value) or "Không có trường nào" in str(exc.value)
