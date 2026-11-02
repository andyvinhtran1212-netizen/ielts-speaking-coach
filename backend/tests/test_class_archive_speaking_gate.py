"""CLASSARCHIVE-0030 FR-004 (Variant A) — Speaking sessions of an archived class.

research.md §5 "Class item start/submit → 409" has no Speaking exception: an
in-progress Speaking session of an archived class (``is_active = false AND
archived_at IS NOT NULL``) takes no new answer (POST /sessions/{id}/responses),
no completion (PATCH /sessions/{id}/complete, POST /sessions/finalize-full-test)
and no class hand-in (``_record_class_submission``). A completed result stays
replayable, a lost acknowledgement of an earlier answer still replays, and an
active or legacy inactive class (``archived_at IS NULL``) behaves as before.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from routers import grading
from routers import sessions as sessions_module
from services import class_archive_service as archive

OWNER = "user-1"
ARCHIVED_AT = "2026-11-02T05:00:00+00:00"
BEFORE = "2026-11-02T04:59:00+00:00"
AFTER = "2026-11-02T05:01:00+00:00"
ACTIVE = {"id": "c1", "is_active": True, "archived_at": None}
LEGACY = {"id": "c1", "is_active": False, "archived_at": None}
ARCHIVED = {"id": "c1", "is_active": False, "archived_at": ARCHIVED_AT}
LEARNER_409 = {"code": "cohort_archived", "message": archive.COHORT_ARCHIVED_LEARNER_MESSAGE}
DB_TEXT = 'relation "cohorts" secret_col private-db-value'
SUBMISSION = "11111111-1111-4111-8111-111111111111"


class _Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.rows = [dict(r) for r in db.tables.get(name, [])]
        self.payload = None

    def select(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def order(self, *_a, **_k): return self
    def gt(self, *_a): return self

    def eq(self, field, value):
        self.rows = [r for r in self.rows if str(r.get(field)) == str(value)]
        return self

    def in_(self, field, values):
        allowed = {str(v) for v in values}
        self.rows = [r for r in self.rows if str(r.get(field)) in allowed]
        return self

    def update(self, payload):
        self.payload = payload
        return self

    def execute(self):
        if self.name in self.db.fail:
            raise RuntimeError(DB_TEXT)
        if self.payload is not None:
            self.db.updates.append((self.name, self.payload))
            return SimpleNamespace(data=[{**r, **self.payload} for r in self.rows])
        return SimpleNamespace(data=self.rows, count=len(self.rows))


class _DB:
    def __init__(self, cohort, **tables):
        self.tables = {
            "cohorts": [dict(cohort)],
            "class_assignment_items": [{"id": "item-1", "assignment_id": "a1"}],
            # ``_record_class_submission`` reads the assignment through an
            # embedded !inner filter on the item id.
            "class_assignments": [{"id": "a1", "cohort_id": cohort["id"], "status": "published",
                                   "due_at": None, "class_assignment_items.id": "item-1"}],
            **tables,
        }
        self.fail: set = set()
        self.updates: list = []

    def table(self, name):
        return _Query(self, name)


def _session(**over):
    return {"id": "sess-1", "user_id": OWNER, "part": 1, "topic": "Hometown",
            "mode": "practice", "status": "in_progress", "sitting_id": None,
            "class_assignment_item_id": "item-1", "completed_at": None,
            "overall_band": None, "resume_expires_at": "2999-01-01T00:00:00+00:00",
            **over}


def _never(name):
    def _call(*_a, **_k):
        pytest.fail(f"{name} ran for an archived class")
    return _call


class _Stop(HTTPException):
    """Raised by a stub one step past the archive gate: the gate let it through.

    An HTTPException, so the grader's catch-all re-raises it unchanged.
    """

    def __init__(self):
        super().__init__(418, "past the archive gate")


# ── POST /sessions/{id}/responses ────────────────────────────────────────

def _grade(monkeypatch, db, *, session=None, submission_id=None, saved=None, after_gate=None):
    session = session or _session()
    questions = [{"id": "q-1", "session_id": "sess-1", "question_text": "Q?"}]

    async def execute(builder):
        return builder(_DB(ACTIVE, sessions=[session], questions=questions)).execute()

    monkeypatch.setattr(sessions_module, "supabase_admin", db)
    monkeypatch.setattr(grading, "aexecute", execute)
    monkeypatch.setattr(grading, "get_supabase_user", AsyncMock(return_value={"id": OWNER}))
    monkeypatch.setattr(grading, "require_resume_active", lambda _s: None)
    monkeypatch.setattr(grading, "require_speaking_entitlement", lambda *_a: None)
    monkeypatch.setattr(grading, "bind_owned_attempt", lambda _s: None)
    monkeypatch.setattr(grading, "load_response", lambda *_a: saved)
    monkeypatch.setattr(grading, "transcribe_from_bytes", _never("Whisper"))
    monkeypatch.setattr(grading, "record_grading_attempt", lambda *_a: None)
    monkeypatch.setattr(grading, "enforce_grading_rate_limit",
                        after_gate or _never("the grading quota"))
    audio = b"recorded audio"
    upload = UploadFile(io.BytesIO(audio), filename="a.wav",
                        headers=Headers({"content-type": "audio/wav"}))
    return asyncio.run(grading.grade_response_endpoint(
        "sess-1", question_id="q-1", audio_file=upload, authorization="t",
        submission_id=submission_id,
        expected_revision="absent" if submission_id else None,
    ))


@pytest.mark.parametrize("submission_id", [None, SUBMISSION])
def test_an_answer_in_an_archived_class_is_the_learner_409(monkeypatch, submission_id):
    with pytest.raises(HTTPException) as caught:
        _grade(monkeypatch, _DB(ARCHIVED), submission_id=submission_id)
    assert caught.value.status_code == 409
    assert caught.value.detail == LEARNER_409


@pytest.mark.parametrize("cohort", [ACTIVE, LEGACY])
@pytest.mark.parametrize("submission_id", [None, SUBMISSION])
def test_an_answer_in_active_and_legacy_classes_is_graded_as_before(
        monkeypatch, cohort, submission_id):
    def stop(*_a):
        raise _Stop
    with pytest.raises(_Stop):
        _grade(monkeypatch, _DB(cohort), submission_id=submission_id, after_gate=stop)


def test_an_answer_without_a_class_item_never_reads_the_class(monkeypatch):
    db = _DB(ARCHIVED)
    db.fail.update({"cohorts", "class_assignment_items", "class_assignments"})

    def stop(*_a):
        raise _Stop
    with pytest.raises(_Stop):
        _grade(monkeypatch, db, session=_session(class_assignment_item_id=None), after_gate=stop)


def test_a_lost_acknowledgement_still_replays_in_an_archived_class(monkeypatch):
    audio = b"recorded audio"
    saved = {"id": "resp-1", "audio_storage_path":
             f"{OWNER}/sess-1/q-1.{SUBMISSION}.{hashlib.sha256(audio).hexdigest()}.wav"}
    out = _grade(monkeypatch, _DB(ARCHIVED), submission_id=SUBMISSION, saved=saved)
    assert out["response_id"] == "resp-1" and out["_replayed"] is True


def test_a_failed_class_read_refuses_the_answer_with_a_generic_500(monkeypatch):
    db = _DB(ACTIVE)
    db.fail.add("cohorts")
    with pytest.raises(HTTPException) as caught:
        _grade(monkeypatch, db)
    assert caught.value.status_code == 500
    assert DB_TEXT not in str(caught.value.detail)


# ── PATCH /sessions/{id}/complete ────────────────────────────────────────

def _complete(monkeypatch, db, session, marks):
    db.tables["sessions"] = [session]
    monkeypatch.setattr(sessions_module, "supabase_admin", db)
    monkeypatch.setattr(sessions_module, "get_supabase_user",
                        AsyncMock(return_value={"id": OWNER}))
    monkeypatch.setattr(sessions_module, "bind_owned_attempt", lambda _s: None)
    monkeypatch.setattr(sessions_module, "require_resume_active", lambda _s: None)
    monkeypatch.setattr(sessions_module, "_compute_session_bands",
                        lambda _sid: {"overall_band": 6.5, "band_fc": 6.5})
    monkeypatch.setattr(sessions_module, "mark_item_submitted",
                        lambda _db, **kw: marks.append(kw) or True)
    return asyncio.run(sessions_module.complete_session("sess-1", None))


def test_completing_an_in_progress_session_of_an_archived_class_is_409(monkeypatch):
    db, marks = _DB(ARCHIVED), []
    with pytest.raises(HTTPException) as caught:
        _complete(monkeypatch, db, _session(), marks)
    assert caught.value.status_code == 409
    assert caught.value.detail == LEARNER_409
    assert db.updates == [] and marks == [], "a refused completion writes nothing"


@pytest.mark.parametrize("cohort", [ACTIVE, LEGACY])
def test_completing_in_active_and_legacy_classes_records_the_hand_in(monkeypatch, cohort):
    db, marks = _DB(cohort), []
    out = _complete(monkeypatch, db, _session(), marks)
    assert out["status"] == "completed"
    assert [m["item_id"] for m in marks] == ["item-1"]


def test_a_failed_class_read_refuses_the_completion_with_a_generic_500(monkeypatch):
    db, marks = _DB(ACTIVE), []
    db.fail.add("cohorts")
    with pytest.raises(HTTPException) as caught:
        _complete(monkeypatch, db, _session(), marks)
    assert caught.value.status_code == 500
    assert DB_TEXT not in str(caught.value.detail)
    assert db.updates == [] and marks == []


@pytest.mark.parametrize(("completed_at", "credited"), [(BEFORE, True), (AFTER, False)])
def test_a_completed_result_replays_and_is_credited_only_before_the_archive(
        monkeypatch, completed_at, credited):
    db, marks = _DB(ARCHIVED), []
    out = _complete(monkeypatch, db, _session(status="completed", overall_band=6.0,
                                              completed_at=completed_at), marks)
    assert out["session_id"] == "sess-1"
    assert bool(marks) is credited


# ── _record_class_submission (replay, full-test finaliser, archive race) ──

@pytest.mark.parametrize(("cohort", "completed_at", "credited"), [
    (ARCHIVED, AFTER, False),
    (ARCHIVED, None, False),
    (ARCHIVED, BEFORE, True),
    (ACTIVE, AFTER, True),
    (LEGACY, AFTER, True),
])
def test_record_class_submission_refuses_a_hand_in_after_the_archive(
        monkeypatch, cohort, completed_at, credited):
    marks: list = []
    monkeypatch.setattr(sessions_module, "supabase_admin", _DB(cohort))
    monkeypatch.setattr(sessions_module, "mark_item_submitted",
                        lambda _db, **kw: marks.append(kw) or True)
    assert sessions_module._record_class_submission(
        _session(status="completed", completed_at=completed_at)) is credited
    assert bool(marks) is credited


# ── POST /sessions/finalize-full-test ────────────────────────────────────

def test_finalizing_a_full_test_of_an_archived_class_is_409(monkeypatch):
    parts = [_session(id=f"p{n}", part=n, mode="test_full") for n in (1, 2, 3)]
    db = _DB(ARCHIVED, sessions=parts)
    monkeypatch.setattr(sessions_module, "supabase_admin", db)
    monkeypatch.setattr(sessions_module, "get_supabase_user",
                        AsyncMock(return_value={"id": OWNER}))
    monkeypatch.setattr(sessions_module, "_validate_full_test_chain", lambda *_a: None)
    monkeypatch.setattr(sessions_module, "bind_owned_attempt", lambda _s: None)
    monkeypatch.setattr(sessions_module, "require_resume_active", lambda _s: None)
    body = sessions_module.FinalizeFullTestBody(p1_id="p1", p2_id="p2", p3_id="p3")
    with pytest.raises(HTTPException) as caught:
        asyncio.run(sessions_module.finalize_full_test(body, SimpleNamespace(), None))
    assert caught.value.status_code == 409
    assert caught.value.detail == LEARNER_409
    assert db.updates == [], "no part is marked submitted"
