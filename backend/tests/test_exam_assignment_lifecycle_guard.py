"""A live class give keeps its Reading/Listening parent paper available."""

from datetime import datetime, timezone
from inspect import getsource

from routers import admin_reading, listening
from services.class_assignment_service import active_exam_assignment_references


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows):
        self.rows = list(rows)

    def select(self, *_args, **_kwargs): return self
    def eq(self, field, value):
        self.rows = [row for row in self.rows if str(row.get(field)) == str(value)]
        return self
    def order(self, *_args, **_kwargs): return self
    def range(self, start, end):
        self.rows = self.rows[start:end + 1]
        return self
    def execute(self): return _Result(self.rows)


class _Db:
    def __init__(self, rows): self.rows = rows
    def table(self, name):
        assert name == "class_assignments"
        return _Query(self.rows)


def test_only_assignments_still_accepting_work_block_paper_withdrawal():
    now = datetime(2026, 9, 11, tzinfo=timezone.utc)
    rows = [
        {"id": "open", "title": "Open", "skill": "reading", "content_id": "paper",
         "status": "published", "publish_at": None, "due_at": None},
        {"id": "future", "title": "Future", "skill": "reading", "content_id": "paper",
         "status": "published", "publish_at": None, "due_at": "2026-09-12T00:00:00+00:00"},
        {"id": "expired", "title": "Expired", "skill": "reading", "content_id": "paper",
         "status": "published", "publish_at": None, "due_at": "2026-09-10T00:00:00+00:00"},
        {"id": "closed", "title": "Closed", "skill": "reading", "content_id": "paper",
         "status": "archived", "publish_at": None, "due_at": None},
    ]
    found = active_exam_assignment_references(_Db(rows), "reading", "paper", now=now)
    assert [row["id"] for row in found] == ["open", "future"]


def test_both_admin_withdrawal_routes_use_the_shared_guard():
    assert "active_exam_assignment_references" in getsource(
        admin_reading.admin_delete_reading_test
    )
    assert "active_exam_assignment_references" in getsource(
        listening.admin_patch_listening_test_status
    )
    assert "active_exam_assignment_references" in getsource(
        listening.admin_delete_listening_test
    )
    assert "active_exam_assignment_references" in getsource(
        listening.admin_hard_delete_listening_test
    )
