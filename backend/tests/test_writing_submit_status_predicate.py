"""Pin the learner submit guard at the route's atomic claim, without PostgreSQL.

Writing terminal → submitted relink is intentionally not guarded in the DB
(224 design; owner decision 2026-10-30, option b); the learner route predicate
is the guard.

Like test_writing_student_saga.py, invoke the real handler with a fluent
Supabase fake. Unlike a scripted empty UPDATE response, this fake applies
the actual predicates and persists every matching UPDATE, even without in_().
Terminal-state races therefore exercise the guard after the active preflight.
"""

import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import UUID

import pytest
from fastapi import BackgroundTasks, HTTPException

from routers import writing_student as ws


ASSIGNMENT_ID = "11111111-1111-4111-8111-111111111111"
STUDENT = {"id": "student-1", "user_id": "user-1"}
NEW_ESSAY_ID = "new-essay"
OLD_ESSAY_ID = "previous-essay"
ESSAY_TEXT = "My response to the education prompt. " * 30


class _Query:
    def __init__(self, db, table):
        self.db = db
        self.table = table
        self.action = None
        self.payload = None
        self.predicates = []

    def select(self, *_args):
        self.action = "select"
        return self

    def update(self, payload):
        self.action, self.payload = "update", payload
        return self

    def delete(self):
        self.action = "delete"
        return self

    def eq(self, column, value):
        self.predicates.append(("eq", column, value))
        return self

    def in_(self, column, values):
        self.predicates.append(("in", column, list(values)))
        return self

    def gt(self, column, value):
        self.predicates.append(("gt", column, value))
        return self

    def limit(self, _count):
        return self

    def _matches(self, row):
        for operator, column, value in self.predicates:
            current = row.get(column)
            if operator == "eq" and current != value:
                return False
            if operator == "in" and current not in value:
                return False
            if operator == "gt" and (
                current is None
                or datetime.fromisoformat(current) <= datetime.fromisoformat(value)
            ):
                return False
        return True

    def execute(self):
        self.db.calls.append(self)
        if self.table == "writing_assignments" and self.action == "update":
            # A finalizer/another request may win after the initial SELECT.
            self.db.assignment.update(self.db.before_claim)
            self.db.claim_snapshot = deepcopy(self.db.assignment)
        rows = self.db.rows[self.table]
        matched = [row for row in rows if self._matches(row)]
        if self.action == "update":
            for row in matched:
                row.update(self.payload)
        elif self.action == "delete":
            rows[:] = [row for row in rows if row not in matched]
        elif self.action != "select":
            raise AssertionError(f"Unexpected fake operation: {self.action}")
        # SELECT snapshots must not change when a later writer updates the row.
        return SimpleNamespace(data=deepcopy(matched))


class _Client:
    def __init__(self):
        self.assignment = {
            "id": ASSIGNMENT_ID,
            "student_id": STUDENT["id"],
            "status": "in_progress",
            "essay_id": None,
            "renderer_affinity": "next",
            "renderer_affinity_claimed_at": datetime.now(timezone.utc).isoformat(),
            "renderer_affinity_expires_at": (
                datetime.now(timezone.utc) + timedelta(hours=1)
            ).isoformat(),
            "writing_prompts": {"prompt_text": "Discuss education.", "task_type": "task2"},
        }
        self.rows = {
            "writing_assignments": [self.assignment],
            "writing_drafts": [{"assignment_id": ASSIGNMENT_ID, "draft_text": ESSAY_TEXT}],
            "writing_essays": [],
        }
        self.calls = []
        self.before_claim = {}
        self.claim_snapshot = None

    def table(self, name):
        return _Query(self, name)

    def claims(self):
        return [call for call in self.calls
                if call.table == "writing_assignments" and call.action == "update"]


@pytest.fixture
def submission(monkeypatch):
    db = _Client()
    monkeypatch.setattr(ws, "supabase_admin", db)
    monkeypatch.setattr(ws, "get_user_access_code_permissions", lambda _user: ["all"])
    monkeypatch.setattr(ws, "detect_flags", lambda _text: [])

    def create_essay(**_kwargs):
        db.rows["writing_essays"].append({"id": NEW_ESSAY_ID})
        return {"essay_id": NEW_ESSAY_ID, "eta_seconds": 60}

    create = Mock(side_effect=create_essay)
    schedule = Mock(return_value={"job_id": "job-1", "eta_seconds": 60})
    monkeypatch.setattr(ws.essay_service, "create_essay_row_only", create)
    monkeypatch.setattr(ws.essay_service, "schedule_grading_job", schedule)
    return SimpleNamespace(db=db, create=create, schedule=schedule, bg=BackgroundTasks())


def _submit(submission):
    return asyncio.run(ws.submit_my_assignment(
        assignment_id=UUID(ASSIGNMENT_ID),
        body=ws.SubmitEssay(essay_text=ESSAY_TEXT),
        background_tasks=submission.bg,
        student=STUDENT,
    ))


def _assert_claim_predicates(db, observed_after):
    claim, = db.claims()
    assert ws._ACTIVE_ASSIGNMENT_STATES == {"pending", "in_progress"}
    status_filters = [value for op, column, value in claim.predicates
                      if op == "in" and column == "status"]
    assert len(status_filters) == 1
    assert set(status_filters[0]) == ws._ACTIVE_ASSIGNMENT_STATES
    expiry_filters = [value for op, column, value in claim.predicates
                      if op == "gt" and column == "renderer_affinity_expires_at"]
    assert len(expiry_filters) == 1
    observed_at = datetime.fromisoformat(expiry_filters[0])
    assert observed_after <= observed_at <= datetime.now(timezone.utc)
    assert ("eq", "id", ASSIGNMENT_ID) in claim.predicates
    assert ("eq", "student_id", STUDENT["id"]) in claim.predicates
    assert claim.payload["status"] == "submitted"
    assert claim.payload["essay_id"] == NEW_ESSAY_ID


@pytest.mark.parametrize("status", ["pending", "in_progress"])
def test_active_assignment_claim_keeps_status_and_lease_predicates(submission, status):
    submission.db.assignment["status"] = status
    before = datetime.now(timezone.utc)

    result = _submit(submission)

    assert result["status"] == "submitted"
    assert result["essay_id"] == NEW_ESSAY_ID
    assert result["job_id"] == "job-1"
    assert result["replayed"] is False
    _assert_claim_predicates(submission.db, before)
    assert submission.db.assignment["status"] == "submitted"
    assert submission.db.assignment["essay_id"] == NEW_ESSAY_ID
    submission.schedule.assert_called_once()
    assert len(submission.bg.tasks) == 1


@pytest.mark.parametrize("status", ["graded", "delivered"])
def test_terminal_assignment_returns_existing_409_without_writes(submission, status):
    db = submission.db
    db.assignment.update(status=status, essay_id=OLD_ESSAY_ID)
    before = deepcopy(db.rows)

    with pytest.raises(HTTPException) as error:
        _submit(submission)

    assert error.value.status_code == 409
    assert error.value.detail == (
        f"Không thể nộp — trạng thái bài là '{status}' "
        "(bài có thể đã được nộp ở tab khác)."
    )
    assert db.rows == before
    assert all(call.action == "select" for call in db.calls)
    submission.create.assert_not_called()
    submission.schedule.assert_not_called()
    assert submission.bg.tasks == []


@pytest.mark.parametrize("status", ["graded", "delivered"])
def test_terminal_state_before_claim_cannot_relink_essay(submission, status):
    db = submission.db
    db.before_claim = {"status": status, "essay_id": OLD_ESSAY_ID}
    before = datetime.now(timezone.utc)

    with pytest.raises(HTTPException) as error:
        _submit(submission)

    assert error.value.status_code == 409
    assert error.value.detail == (
        f"Không thể nộp — trạng thái bài là '{status}' "
        "(bài có thể đã được nộp ở tab khác)."
    )
    _assert_claim_predicates(db, before)
    assert db.assignment == db.claim_snapshot
    assert db.assignment["status"] == status
    assert db.assignment["essay_id"] == OLD_ESSAY_ID
    submission.create.assert_called_once()
    assert db.rows["writing_essays"] == [], "The rejected claim must clean up its orphan essay"
    assert db.rows["writing_drafts"], "The rejected claim must preserve the learner draft"
    submission.schedule.assert_not_called()
    assert submission.bg.tasks == []
