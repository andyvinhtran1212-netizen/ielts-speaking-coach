"""Read-only access to a submitted course result must outlive its deadline."""

from unittest.mock import patch

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

    def execute(self):
        return _Resp(self.rows)


def _db(*, submitted_at):
    tables = {
        "class_assignments": [{
            "id": "a1", "content_id": "b1", "cohort_id": "c1",
            "status": "published", "publish_at": None,
            "due_at": "2000-01-01T00:00:00+00:00",
        }],
        "students": [{"id": "s1", "user_id": "u1", "cohort_id": "c1"}],
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
