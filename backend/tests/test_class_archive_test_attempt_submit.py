"""CLASSARCHIVE-0030 FR-004 (Variant A) — Reading/Listening hand-ins of an archived class.

research.md §5 "Class item start/submit → 409": a class-linked Reading or
Listening attempt (``class_assignment_item_id``) started before the archive
gets the learner 409 ``cohort_archived`` on submit, before any grading or
write. A submitted attempt still replays, an attempt without a class item never
reads the class, and an active or legacy inactive class (``archived_at IS
NULL``) behaves as before. A failed class read refuses with a generic 500.

The repair passes (``reconcile_test_attempts``, ``reconcile_ledger_from_sessions``)
apply the rule of ``_record_class_submission``: no credit for work handed in at
or after ``archived_at``. Trigger 337 guards only INSERT, and the ledger write
is an UPDATE of the item, so the reconcilers are the only place that refuses a
hand-in racing the archive.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import listening, reading_student
from services import class_archive_service as archive
from services import mock_paper_policy
from services.class_assignment_service import (
    reconcile_ledger_from_sessions,
    reconcile_test_attempts,
)
from tests.test_class_assignment_service import _DB as _LedgerDB

ARCHIVED_AT = "2026-11-02T05:00:00+00:00"
BEFORE = "2026-11-02T04:59:00+00:00"
AFTER = "2026-11-02T05:01:00+00:00"
ACTIVE = {"id": "c1", "is_active": True, "archived_at": None}
LEGACY = {"id": "c1", "is_active": False, "archived_at": None}
ARCHIVED = {"id": "c1", "is_active": False, "archived_at": ARCHIVED_AT}
LEARNER_409 = {"code": "cohort_archived", "message": archive.COHORT_ARCHIVED_LEARNER_MESSAGE}
DB_TEXT = 'relation "cohorts" secret_col private-db-value'


class _Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.rows = [dict(r) for r in db.tables.get(name, [])]

    def select(self, *_a, **_k): return self
    def limit(self, *_a): return self

    def eq(self, field, value):
        self.rows = [r for r in self.rows if str(r.get(field)) == str(value)]
        return self

    def execute(self):
        self.db.reads.append(self.name)
        if self.name in self.db.fail:
            raise RuntimeError(DB_TEXT)
        return SimpleNamespace(data=self.rows)


class _ClassDB:
    """The three reads of ``class_item_cohort_id`` + ``cohort_accepts_work``."""

    def __init__(self, cohort):
        self.tables = {
            "cohorts": [dict(cohort)],
            "class_assignment_items": [{"id": "item-1", "assignment_id": "a1"}],
            "class_assignments": [{"id": "a1", "cohort_id": cohort["id"]}],
        }
        self.fail: set = set()
        self.reads: list = []

    def table(self, name):
        return _Query(self, name)


def _attempt(**over):
    return {"id": "att-1", "user_id": "u1", "test_id": "t1", "status": "in_progress",
            "sitting_id": None, "class_assignment_item_id": "item-1",
            "started_at": BEFORE, "resume_expires_at": "2999-01-01T00:00:00+00:00",
            **over}


class _Stop(HTTPException):
    """Raised one step past the archive gate: the gate let the hand-in through."""

    def __init__(self):
        super().__init__(418, "past the archive gate")


def _stop_after_gate(monkeypatch):
    def stop(*_a, **_k):
        raise _Stop
    monkeypatch.setattr(mock_paper_policy, "guard_owned_attempt", stop)


def _never_grades(monkeypatch):
    def never(*_a, **_k):
        pytest.fail("the hand-in reached grading in an archived class")
    monkeypatch.setattr(mock_paper_policy, "guard_owned_attempt", never)


def _submit_reading(monkeypatch, db, attempt):
    monkeypatch.setattr(reading_student, "supabase_admin", db)
    monkeypatch.setattr(reading_student, "_optional_auth", AsyncMock(return_value={"id": "u1"}))
    monkeypatch.setattr(reading_student, "_fetch_attempt_owned", lambda *_a: dict(attempt))
    monkeypatch.setattr(reading_student, "bind_owned_attempt", lambda _a: None)
    monkeypatch.setattr(reading_student, "require_resume_active", lambda _a: None)
    return asyncio.run(reading_student.submit_reading_test_attempt(
        "att-1", reading_student._SubmitRequest(answers=[]), authorization="Bearer x",
    ))


def _submit_listening(monkeypatch, db, attempt):
    monkeypatch.setattr(listening, "supabase_admin", db)
    monkeypatch.setattr(listening, "_require_auth", AsyncMock(return_value={"id": "u1"}))
    monkeypatch.setattr(listening, "_fetch_attempt_or_404", lambda *_a: dict(attempt))
    monkeypatch.setattr(listening, "bind_owned_attempt", lambda _a: None)
    monkeypatch.setattr(listening, "require_resume_active", lambda _a: None)
    monkeypatch.setattr(listening, "_mock_sealed", lambda _a: False)
    return asyncio.run(listening.submit_listening_test_attempt("att-1", authorization="Bearer x"))


SUBMITS = {"reading": _submit_reading, "listening": _submit_listening}


# ── submit routes ────────────────────────────────────────────────────────

@pytest.mark.parametrize("skill", sorted(SUBMITS))
def test_an_attempt_started_before_the_archive_cannot_be_handed_in(monkeypatch, skill):
    _never_grades(monkeypatch)
    with pytest.raises(HTTPException) as caught:
        SUBMITS[skill](monkeypatch, _ClassDB(ARCHIVED), _attempt(started_at=BEFORE))
    assert caught.value.status_code == 409
    assert caught.value.detail == LEARNER_409


@pytest.mark.parametrize("skill", sorted(SUBMITS))
@pytest.mark.parametrize("cohort", [ACTIVE, LEGACY], ids=["active", "legacy"])
def test_active_and_legacy_classes_are_handed_in_as_before(monkeypatch, skill, cohort):
    _stop_after_gate(monkeypatch)
    with pytest.raises(_Stop):
        SUBMITS[skill](monkeypatch, _ClassDB(cohort), _attempt())


@pytest.mark.parametrize("skill", sorted(SUBMITS))
def test_an_attempt_without_a_class_item_never_reads_the_class(monkeypatch, skill):
    db = _ClassDB(ARCHIVED)
    db.fail.update({"cohorts", "class_assignment_items", "class_assignments"})
    _stop_after_gate(monkeypatch)
    with pytest.raises(_Stop):
        SUBMITS[skill](monkeypatch, db, _attempt(class_assignment_item_id=None))
    assert db.reads == []


@pytest.mark.parametrize("skill", sorted(SUBMITS))
def test_a_submitted_attempt_still_replays_in_an_archived_class(monkeypatch, skill):
    """The finished result stays the learner's: the replay answers as before
    (422 for a normal attempt) and never asks about the class."""
    db = _ClassDB(ARCHIVED)
    db.fail.update({"cohorts", "class_assignment_items", "class_assignments"})
    with pytest.raises(HTTPException) as caught:
        SUBMITS[skill](monkeypatch, db, _attempt(status="submitted"))
    assert caught.value.status_code == 422
    assert db.reads == []


@pytest.mark.parametrize("skill", sorted(SUBMITS))
@pytest.mark.parametrize("table", ["cohorts", "class_assignment_items", "class_assignments"])
def test_a_failed_class_read_refuses_the_hand_in_with_a_generic_500(monkeypatch, skill, table):
    db = _ClassDB(ACTIVE)
    db.fail.add(table)
    _never_grades(monkeypatch)
    with pytest.raises(HTTPException) as caught:
        SUBMITS[skill](monkeypatch, db, _attempt())
    assert caught.value.status_code == 500
    assert DB_TEXT not in str(caught.value.detail)


# ── reconcile_test_attempts (Reading/Listening) ──────────────────────────

def _rl_db(cohort, *, when, table="reading_test_attempts", assignment_cohort=True):
    return _LedgerDB({
        "cohorts": [dict(cohort)],
        "class_assignments": [{"id": "asg-1", "cohort_id": cohort["id"]}],
        "class_assignment_items": [
            {"id": "item-1", "assignment_id": "asg-1", "student_id": "stu-1",
             "submitted_at": None, "state": "assigned"},
        ],
        table: [{"id": "att-1", "class_assignment_item_id": "item-1", "submitted_at": when,
                 "band_estimate": 6.5, "status": "submitted"}],
    })


def _rl_assignment(cohort, skill="reading", *, with_cohort=True):
    row = {"id": "asg-1", "skill": skill, "status": "published", "due_at": None}
    if with_cohort:
        row["cohort_id"] = cohort["id"]
    return row


@pytest.mark.parametrize("skill,table", [("reading", "reading_test_attempts"),
                                         ("listening", "listening_test_attempts")])
@pytest.mark.parametrize("when", [ARCHIVED_AT, AFTER], ids=["at", "after"])
@pytest.mark.parametrize("with_cohort", [True, False], ids=["row-cohort", "read-cohort"])
def test_an_attempt_submitted_at_or_after_the_archive_is_not_credited(
        skill, table, when, with_cohort):
    db = _rl_db(ARCHIVED, when=when, table=table)
    assert reconcile_test_attempts(db, [_rl_assignment(ARCHIVED, skill, with_cohort=with_cohort)]) == 0
    assert db.tables["class_assignment_items"][0]["submitted_at"] is None


@pytest.mark.parametrize("cohort,when", [(ARCHIVED, BEFORE), (ACTIVE, AFTER), (LEGACY, AFTER)],
                         ids=["archived-before", "active", "legacy"])
def test_an_attempt_submitted_before_the_archive_or_in_an_open_class_is_credited(cohort, when):
    db = _rl_db(cohort, when=when)
    assert reconcile_test_attempts(db, [_rl_assignment(cohort)]) == 1
    item = db.tables["class_assignment_items"][0]
    assert item["artifact_id"] == "att-1"
    assert item["submitted_at"] == when


def test_a_failed_class_read_credits_nothing_and_propagates():
    """The callers flag ``reconcile_failed`` / ``stale`` and retry on the next
    read; a failed read never credits a hand-in to an archived class."""
    db = _rl_db(ARCHIVED, when=AFTER)
    db.fail = {"cohorts"}
    with pytest.raises(RuntimeError):
        reconcile_test_attempts(db, [_rl_assignment(ARCHIVED)])
    assert db.tables["class_assignment_items"][0]["submitted_at"] is None


# ── reconcile_ledger_from_sessions (Speaking) ────────────────────────────

def _speaking_db(cohort, *, completed_at, mode="practice"):
    return _LedgerDB({
        "cohorts": [dict(cohort)],
        "class_assignments": [{"id": "asg-1", "cohort_id": cohort["id"], "due_at": None,
                               "status": "published"}],
        "class_assignment_items": [
            {"id": "item-1", "assignment_id": "asg-1", "submitted_at": None,
             "state": "assigned"},
        ],
        "sessions": [{"id": "sess-1", "class_assignment_item_id": "item-1",
                      "status": "completed", "overall_band": 6.5,
                      "completed_at": completed_at, "mode": mode}],
    })


@pytest.mark.parametrize("completed_at", [ARCHIVED_AT, AFTER, None], ids=["at", "after", "none"])
def test_a_session_completed_at_or_after_the_archive_is_not_credited(completed_at):
    db = _speaking_db(ARCHIVED, completed_at=completed_at)
    assert reconcile_ledger_from_sessions(db, ["asg-1"]) == 0
    assert db.tables["class_assignment_items"][0]["submitted_at"] is None


@pytest.mark.parametrize("cohort,completed_at", [(ARCHIVED, BEFORE), (ACTIVE, AFTER),
                                                 (LEGACY, AFTER)],
                         ids=["archived-before", "active", "legacy"])
def test_a_session_completed_before_the_archive_or_in_an_open_class_is_credited(
        cohort, completed_at):
    db = _speaking_db(cohort, completed_at=completed_at)
    assert reconcile_ledger_from_sessions(db, ["asg-1"]) == 1
    assert db.tables["class_assignment_items"][0]["artifact_id"] == "sess-1"


def test_a_full_test_accepted_before_the_archive_keeps_its_credit_on_repair():
    """Same exemption as the finaliser's ``archive_gated``: finalize-full-test
    refused an archived class up front, and completed_at is the later
    aggregation time, so it can fall after the archive."""
    db = _speaking_db(ARCHIVED, completed_at=AFTER, mode="test_full")
    assert reconcile_ledger_from_sessions(db, ["asg-1"]) == 1


# ── completion racing the archive, then the admin assignment read ────────

def test_a_hand_in_racing_the_archive_stays_uncredited_on_the_admin_read(monkeypatch):
    """The session passed the up-front gate, the class was archived, and the
    session completed after ``archived_at``: ``_record_class_submission``
    refused the credit. The admin assignment list then runs the repair pass,
    which must not record it either (Speaking and Reading alike)."""
    from routers import admin_class_assignments as adm
    from routers import sessions as sessions_module

    db = _LedgerDB({
        "cohorts": [dict(ARCHIVED)],
        "class_assignments": [
            {"id": "asg-s", "cohort_id": "c1", "skill": "speaking", "due_at": None,
             "status": "published", "class_assignment_items.id": "item-s",
             "created_at": "2026-11-01T00:00:00+00:00"},
            {"id": "asg-r", "cohort_id": "c1", "skill": "reading", "due_at": None,
             "status": "published", "created_at": "2026-11-01T00:00:00+00:00"},
        ],
        "class_assignment_items": [
            {"id": "item-s", "assignment_id": "asg-s", "student_id": "stu-1",
             "submitted_at": None, "state": "assigned"},
            {"id": "item-r", "assignment_id": "asg-r", "student_id": "stu-1",
             "submitted_at": None, "state": "assigned"},
        ],
        "sessions": [{"id": "sess-1", "class_assignment_item_id": "item-s",
                      "status": "completed", "overall_band": 6.5,
                      "completed_at": AFTER, "mode": "practice"}],
        "reading_test_attempts": [{"id": "att-1", "class_assignment_item_id": "item-r",
                                   "submitted_at": AFTER, "band_estimate": 6.5,
                                   "status": "submitted"}],
    })
    monkeypatch.setattr(sessions_module, "supabase_admin", db)
    session = db.tables["sessions"][0]
    assert sessions_module._record_class_submission(dict(session)) is False

    monkeypatch.setattr(adm, "supabase_admin", db)
    monkeypatch.setattr(adm, "require_admin", AsyncMock(return_value={"id": "admin"}))
    monkeypatch.setattr(adm, "_require_cohort", lambda _cid: None)
    monkeypatch.setattr(adm, "reconcile_course_items", lambda *_a: 0)
    out = asyncio.run(adm.list_assignments("c1", authorization="Bearer x"))

    assert "reconcile_failed" not in out
    assert all(i["submitted_at"] is None for i in db.tables["class_assignment_items"])
    progress = {a["id"]: a["progress"] for a in out["assignments"]}
    assert progress["asg-s"]["submitted"] == 0
    assert progress["asg-r"]["submitted"] == 0
