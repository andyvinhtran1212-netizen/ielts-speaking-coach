"""Read-only access to a submitted course result must outlive its deadline."""

from unittest.mock import patch

import pytest

from services import quiz_service as qs


class _Resp:
    def __init__(self, data):
        self.data = data


class _Table:
    def __init__(self, rows):
        self.rows = list(rows)

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, field, value):
        self.rows = [row for row in self.rows if str(row.get(field)) == str(value)]
        return self

    def in_(self, field, values):
        allowed = {str(value) for value in values}
        self.rows = [row for row in self.rows if str(row.get(field)) in allowed]
        return self

    def order(self, *_args, **_kwargs):
        return self

    def range(self, start, end):
        self.rows = self.rows[start:end + 1]
        return self

    def execute(self):
        return _Resp(self.rows)


def _db(*, submitted_at, primary_cohort="c1", memberships=None):
    tables = {
        "class_assignments": [{
            "id": "a1", "content_id": "b1", "cohort_id": "c1",
            "status": "published", "publish_at": None,
            "due_at": "2000-01-01T00:00:00+00:00",
        }],
        "students": [{"id": "s1", "user_id": "u1", "cohort_id": primary_cohort}],
        "student_cohort_memberships": memberships or [],
        "class_assignment_items": [{
            "id": "i1", "assignment_id": "a1", "student_id": "s1",
            "submitted_at": submitted_at,
        }],
    }
    db = type("DB", (), {})()
    db.table = lambda name: _Table(tables.get(name, []))
    return db


def test_default_gate_still_rejects_expired_submitted_work_for_mutations():
    with patch.object(qs, "supabase_admin", _db(submitted_at="2026-08-19T18:23:55Z")):
        assert qs._assignment_item_for("b1", "u1") is None


def test_review_gate_accepts_only_a_persisted_submission_after_deadline():
    with patch.object(qs, "supabase_admin", _db(submitted_at="2026-08-19T18:23:55Z")):
        item = qs._assignment_item_for_review("b1", "u1")
    assert item["id"] == "i1"
    assert item["accepting"] is False

    with patch.object(qs, "supabase_admin", _db(submitted_at=None)):
        assert qs._assignment_item_for_review("b1", "u1") is None


def test_review_item_id_cannot_be_swapped_to_another_assignment_item():
    with patch.object(qs, "supabase_admin", _db(submitted_at="2026-08-19T18:23:55Z")):
        assert qs._assignment_item_for_review("b1", "u1", "item-khac") is None


def test_course_player_accepts_work_from_either_active_class():
    memberships = [
        {"id": "m1", "student_id": "s1", "cohort_id": "c1", "is_active": True},
        {"id": "m2", "student_id": "s1", "cohort_id": "c2", "is_active": True},
    ]
    db = _db(submitted_at="2026-08-19T18:23:55Z", primary_cohort="c2",
             memberships=memberships)
    with patch.object(qs, "supabase_admin", db):
        item = qs._assignment_item_for_review("b1", "u1")
    assert item["id"] == "i1"


def _multiple_assignment_db(items, *, same_created_at=False):
    tables = {
        "class_assignments": [{
            "id": f"a{index}", "content_id": "b1", "cohort_id": f"c{index}",
            "status": "published", "publish_at": None, "due_at": None,
            "created_at": ("2026-10-28T10:00:00Z" if same_created_at or index == 1
                           else "2026-10-29T10:00:00Z"),
            "content_config": {"source": f"a{index}"},
        } for index in (1, 2)],
        "students": [{"id": "s1", "user_id": "u1", "cohort_id": "c1"}],
        "student_cohort_memberships": [{
            "id": f"m{index}", "student_id": "s1", "cohort_id": f"c{index}",
            "is_active": True,
        } for index in (1, 2)],
        "class_assignment_items": items,
    }
    db = type("DB", (), {})()
    db.table = lambda name: _Table(tables.get(name, []))
    return db


@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("completed_fields", [
    {"submitted_at": "2026-10-29T12:00:00Z"},
    {"passed_at": "2026-10-29T12:00:00Z"},
    {"submitted_at": "2026-10-29T12:00:00Z", "passed_at": "2026-10-29T12:00:00Z"},
])
def test_unscoped_assignment_prefers_unsubmitted_unpassed_item(reverse, completed_fields):
    rows = [
        {"id": "i1", "assignment_id": "a1", "student_id": "s1",
         "submitted_at": None, "passed_at": None},
        {"id": "i2", "assignment_id": "a2", "student_id": "s1", **completed_fields},
    ]
    with patch.object(qs, "supabase_admin", _multiple_assignment_db(
        rows[::-1] if reverse else rows,
    )):
        item = qs._assignment_item_for("b1", "u1")
    assert item["id"] == "i1"
    assert item["content_config"] == {"source": "a1"}
    assert item["accepting"] is True


@pytest.mark.parametrize("reverse", [False, True])
def test_unscoped_pending_assignment_prefers_newest_assignment(reverse):
    # Item timestamps deliberately disagree: assignment.created_at owns recency.
    rows = [
        {"id": "i1", "assignment_id": "a1", "student_id": "s1",
         "updated_at": "2026-10-30T10:00:00Z"},
        {"id": "i2", "assignment_id": "a2", "student_id": "s1",
         "updated_at": "2026-10-29T10:00:00Z"},
    ]
    with patch.object(qs, "supabase_admin", _multiple_assignment_db(
        rows[::-1] if reverse else rows,
    )):
        item = qs._assignment_item_for("b1", "u1")
    assert item["id"] == "i2"
    assert item["content_config"] == {"source": "a2"}


@pytest.mark.parametrize("reverse", [False, True])
def test_unscoped_assignment_breaks_equal_creation_ties_by_item_id(reverse):
    rows = [
        {"id": "i1", "assignment_id": "a1", "student_id": "s1"},
        {"id": "i2", "assignment_id": "a2", "student_id": "s1"},
    ]
    with patch.object(qs, "supabase_admin", _multiple_assignment_db(
        rows[::-1] if reverse else rows, same_created_at=True,
    )):
        item = qs._assignment_item_for("b1", "u1")
    assert item["id"] == "i1"


@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("requested_id", ["i1", "i2", "missing", "other-student", "other-bank"])
def test_explicit_assignment_never_falls_back_to_another_item(reverse, requested_id):
    rows = [
        {"id": "i1", "assignment_id": "a1", "student_id": "s1",
         "submitted_at": "2026-10-29T12:00:00Z"},
        {"id": "i2", "assignment_id": "a2", "student_id": "s1"},
        {"id": "other-student", "assignment_id": "a1", "student_id": "s2"},
        {"id": "other-bank", "assignment_id": "a3", "student_id": "s1"},
    ]
    with patch.object(qs, "supabase_admin", _multiple_assignment_db(
        rows[::-1] if reverse else rows,
    )):
        item = qs._assignment_item_for("b1", "u1", assignment_item_id=requested_id)
    if requested_id in {"i1", "i2"}:
        assert item["id"] == requested_id
    else:
        assert item is None
