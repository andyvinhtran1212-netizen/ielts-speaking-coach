"""validate_class_item_for_test — ai được đóng dấu bài tập lên lượt làm đề.

The whole GĐ 5 design rests on one column: `class_assignment_item_id` on the
attempt row. The ledger trusts it completely and never second-guesses it, which
is exactly why it must be earned at the moment it is written.

It arrives in a QUERY STRING. Unchecked, a student could:

  * stamp another learner's homework as done from their own attempt;
  * open the easy paper and point it at the hard homework;
  * hand in work for a class they have left, or for a task not yet open.

Each of those turns "the assigned work was done" — the ledger's entire value —
into a claim anyone can manufacture.
"""

from __future__ import annotations

import pytest

from services.class_assignment_service import (
    ItemNotFoundError,
    TaskMismatchError,
    validate_class_item_for_test,
)


class _Resp:
    def __init__(self, data): self.data = data


class _Table:
    def __init__(self, rows): self._rows = list(rows)

    def select(self, *_a, **_k): return self
    def eq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self
    def limit(self, *_a): return self
    def execute(self): return _Resp(self._rows)


def _db(*, student=None, item=None, assignment=None):
    tables = {
        "students": [student] if student else [],
        "class_assignment_items": [item] if item else [],
        "class_assignments": [assignment] if assignment else [],
    }
    db = type("DB", (), {})()
    db.table = lambda n: _Table(tables.get(n, []))
    return db


def _ok(**over):
    student = {"id": "stu-1", "user_id": "user-1", "cohort_id": "co-1"}
    item = {"id": "item-1", "assignment_id": "asg-1", "student_id": "stu-1"}
    assignment = {"id": "asg-1", "cohort_id": "co-1", "skill": "reading",
                  "content_id": "test-1", "status": "published"}
    assignment.update(over.pop("assignment", {}))
    student.update(over.pop("student", {}))
    item.update(over.pop("item", {}))
    return _db(student=student, item=item, assignment=assignment)


def _check(db, **over):
    kw = {"skill": "reading", "test_id": "test-1"}
    kw.update(over)
    validate_class_item_for_test(db, "user-1", "item-1", **kw)


def test_the_assigned_paper_opened_by_its_owner_passes():
    _check(_ok())


def test_another_learners_homework_cannot_be_stamped():
    """Ownership is checked in the QUERY, so a guessed item id finds nothing."""
    db = _ok(item={"student_id": "stu-OTHER"})
    with pytest.raises(ItemNotFoundError):
        _check(db)


def test_a_user_with_no_student_record_is_refused():
    with pytest.raises(ItemNotFoundError):
        _check(_db(student=None))


def test_a_missing_assignment_is_refused():
    db = _db(student={"id": "stu-1", "user_id": "user-1", "cohort_id": "co-1"},
             item={"id": "item-1", "assignment_id": "asg-1", "student_id": "stu-1"},
             assignment=None)
    with pytest.raises(ItemNotFoundError):
        _check(db)


def test_a_different_paper_cannot_be_handed_in_as_this_homework():
    """Ownership alone would let a learner open an easy paper and have the hard
    homework marked complete."""
    with pytest.raises(TaskMismatchError):
        _check(_ok(), test_id="some-other-test")


def test_a_different_skill_cannot_be_handed_in_either():
    with pytest.raises(TaskMismatchError):
        _check(_ok(), skill="listening")


def test_a_closed_task_cannot_be_started():
    db = _ok(assignment={"status": "archived"})
    with pytest.raises(TaskMismatchError):
        _check(db)


def test_a_task_not_yet_revealed_cannot_be_started():
    db = _ok(assignment={"publish_at": "2099-01-01T00:00:00+00:00"})
    with pytest.raises(TaskMismatchError):
        _check(db)


def test_a_transferred_learner_cannot_hand_in_their_old_classes_work():
    """Moving a student rewrites students.cohort_id only; the old item rows
    survive."""
    db = _ok(student={"cohort_id": "co-NEW"})
    with pytest.raises(TaskMismatchError):
        _check(db)
