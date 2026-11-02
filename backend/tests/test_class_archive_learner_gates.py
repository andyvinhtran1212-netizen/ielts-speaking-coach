"""CLASSARCHIVE-0030 T006 — Variant A gates of the course quiz, grammar lesson,
grammar diagnostic and Advanced Vocabulary learner entry points (research.md §5).

An archived class (``is_active = false AND archived_at IS NOT NULL``) takes no
new start, answer or submission; the learner gets the 409 ``cohort_archived``
body. Reads stay open, a timed course item opened before the archive may still
finish, and a legacy inactive class (``archived_at IS NULL``) behaves as before.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from services import advanced_vocab_service as av
from services import class_archive_service as cas
from services import grammar_diagnostic_service as gd
from services import grammar_lesson_service as gl
from services import quiz_service as qs

NOW = datetime.now(timezone.utc)
ARCHIVED_AT = (NOW - timedelta(minutes=10)).isoformat()
ACTIVE = {"id": "c1", "is_active": True, "archived_at": None}
LEGACY = {"id": "c1", "is_active": False, "archived_at": None}
ARCHIVED = {"id": "c1", "is_active": False, "archived_at": ARCHIVED_AT}


class _Resp:
    def __init__(self, data):
        self.data = data


class _Table:
    def __init__(self, rows, fail=False):
        self.rows = list(rows)
        self.fail = fail

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

    def limit(self, n):
        self.rows = self.rows[:n]
        return self

    def range(self, start, end):
        self.rows = self.rows[start:end + 1]
        return self

    def execute(self):
        if self.fail:
            raise RuntimeError("relation cohorts: secret db detail")
        return _Resp(self.rows)


class _DB:
    def __init__(self, tables, *, cohorts_fail=False):
        self.tables = tables
        self.cohorts_fail = cohorts_fail
        self.rpcs: list[str] = []

    def table(self, name):
        return _Table(self.tables.get(name, []), fail=self.cohorts_fail and name == "cohorts")

    def rpc(self, name, _params=None):
        self.rpcs.append(name)
        raise AssertionError(f"no RPC may run in an archived class: {name}")


def _assert_learner_409(exc_info):
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == {
        "code": cas.COHORT_ARCHIVED_CODE, "message": cas.COHORT_ARCHIVED_LEARNER_MESSAGE,
    }


# ── quiz_service._assignment_item_for (course items) ─────────────────────

def _quiz_db(cohort, *, item=None, **kw):
    item = {"id": "i1", "assignment_id": "a1", "student_id": "s1",
            "submitted_at": None, "opened_at": None, **(item or {})}
    return _DB({
        "class_assignments": [{
            "id": "a1", "content_id": "b1", "cohort_id": "c1",
            "status": "published", "publish_at": None, "due_at": None,
            "content_config": kw.pop("content_config", {}),
        }],
        "students": [{"id": "s1", "user_id": "u1", "cohort_id": "c1"}],
        "student_cohort_memberships": [{"id": "m1", "student_id": "s1", "cohort_id": "c1"}],
        "class_assignment_items": [item],
        "cohorts": [cohort],
    }, **kw)


def test_a_course_item_of_an_archived_class_refuses_the_write_lane():
    with patch.object(qs, "supabase_admin", _quiz_db(ARCHIVED)):
        with pytest.raises(HTTPException) as exc_info:
            qs._assignment_item_for("b1", "u1")
    _assert_learner_409(exc_info)


@pytest.mark.parametrize("cohort", [ACTIVE, LEGACY])
def test_active_and_legacy_course_items_are_unchanged(cohort):
    with patch.object(qs, "supabase_admin", _quiz_db(cohort)):
        item = qs._assignment_item_for("b1", "u1")
    assert item["id"] == "i1"
    assert item["class_archived"] is False
    assert item["class_archive_lane"] is None


@pytest.mark.parametrize("flags", [
    {"allow_archived_class": True},
    {"allow_submitted_review": True},
])
def test_read_lanes_still_return_the_archived_item(flags):
    with patch.object(qs, "supabase_admin", _quiz_db(ARCHIVED)):
        item = qs._assignment_item_for("b1", "u1", **flags)
    assert item["id"] == "i1"
    assert item["class_archived"] is True
    assert item["class_archive_lane"] == "closed"


def test_review_reader_stays_open_in_an_archived_class():
    with patch.object(qs, "supabase_admin", _quiz_db(ARCHIVED)):
        item = qs._assignment_item_for_review("b1", "u1", "i1")
    assert item["class_archived"] is True


def test_a_timed_item_opened_before_the_archive_may_finish():
    opened = (NOW - timedelta(minutes=15)).isoformat()   # before ARCHIVED_AT
    db = _quiz_db(ARCHIVED, item={"opened_at": opened},
                  content_config={"time_limit_minutes": 60})
    with patch.object(qs, "supabase_admin", db):
        item = qs._assignment_item_for("b1", "u1")
    assert item["class_archive_lane"] == "finish"


def test_a_timed_item_opened_after_the_archive_is_closed():
    opened = (NOW - timedelta(minutes=5)).isoformat()    # after ARCHIVED_AT
    db = _quiz_db(ARCHIVED, item={"opened_at": opened},
                  content_config={"time_limit_minutes": 60})
    with patch.object(qs, "supabase_admin", db):
        with pytest.raises(HTTPException) as exc_info:
            qs._assignment_item_for("b1", "u1")
    _assert_learner_409(exc_info)


def test_the_reaper_still_finalises_an_archived_item():
    with patch.object(qs, "supabase_admin", _quiz_db(ARCHIVED)):
        item = qs._assignment_item_for("b1", "u1", assignment_item_id="i1",
                                       allow_reaper_finalize=True)
    assert item["id"] == "i1"


# ── /api/quiz/course/pronunciation (Codex thread 4446640393) ─────────────

PRON_BANK = "00000000-0000-4000-8000-0000000000b1"
PRON_ITEM = "00000000-0000-4000-8000-000000000001"


def _pronunciation_db(cohort):
    db = _quiz_db(cohort, item={"id": PRON_ITEM})
    db.tables["class_assignments"][0]["content_id"] = PRON_BANK
    db.tables["course_pronunciation_sets"] = [{
        "id": "set-1", "bank_id": PRON_BANK, "is_active": True, "title": "Shadowing",
        "sentences": [{"id": "s-1", "order": 1, "text": "Hello there."}],
        "playback_rates": [1.0],
    }]
    db.tables["course_pronunciation_submissions"] = [{
        "id": "pron-1", "user_id": "u1", "bank_id": PRON_BANK,
        "class_assignment_item_id": PRON_ITEM, "attempt_no": 1, "status": "completed",
        "pronunciation_score": 81.0, "results": {"sentences": []},
        "created_at": ARCHIVED_AT,
    }]
    return db


@pytest.fixture
def pronunciation(monkeypatch):
    """The GET route and the submit service against one fake DB."""
    import asyncio
    from unittest.mock import AsyncMock
    from uuid import UUID

    from routers import course_pronunciation as route
    from services import course_pronunciation as cp

    def bind(db):
        monkeypatch.setattr(qs, "supabase_admin", db)
        monkeypatch.setattr(cp, "supabase_admin", db)
        monkeypatch.setattr(route, "get_supabase_user", AsyncMock(return_value={"id": "u1"}))

    def read(class_item):
        return asyncio.run(route.pronunciation_state(
            UUID(PRON_BANK), UUID(class_item) if class_item else None, "Bearer x"))

    def submit():
        return asyncio.run(cp.submit(
            user_id="u1", bank_id=PRON_BANK, client_id="22222222-2222-4222-8222-222222222222",
            recordings=[cp.Recording(sentence_id="s-1", data=b"x", content_type="audio/wav")],
        ))
    return SimpleNamespace(bind=bind, read=read, submit=submit)


@pytest.mark.parametrize("class_item", [PRON_ITEM, None], ids=["item-link", "bank-only"])
def test_a_saved_pronunciation_result_stays_readable_after_the_archive(pronunciation, class_item):
    pronunciation.bind(_pronunciation_db(ARCHIVED))
    state = pronunciation.read(class_item)
    assert state["latest_attempt"]["id"] == "pron-1"
    assert state["latest_attempt"]["pronunciation_score"] == 81.0


def test_a_new_pronunciation_submission_is_still_the_learner_409(pronunciation):
    pronunciation.bind(_pronunciation_db(ARCHIVED))
    with pytest.raises(HTTPException) as exc_info:
        pronunciation.submit()
    _assert_learner_409(exc_info)


def test_a_failed_class_read_does_not_open_the_course_gate():
    # The quiz gate's own contract: an unreadable check denies (no item).
    with patch.object(qs, "supabase_admin", _quiz_db(ARCHIVED, cohorts_fail=True)):
        assert qs._assignment_item_for("b1", "u1") is None
        assert qs._assignment_item_for("b1", "u1", allow_archived_class=True) is None


# ── timed course start / retake / full retry ─────────────────────────────

def _timed_item(lane):
    return {"id": "i1", "opened_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 30},
            "class_archive_lane": lane, "class_archived": lane is not None}


@pytest.mark.parametrize("lane,kind", [("closed", "run"), ("finish", "retake")])
def test_a_timed_start_or_retake_in_an_archived_class_is_409(lane, kind):
    db = _DB({})
    with patch.object(qs, "supabase_admin", db):
        with pytest.raises(HTTPException) as exc_info:
            qs._ensure_timed_course_session(
                _timed_item(lane), user_id="u1", bank_id="b1", code=None,
                kind=kind, create_if_missing=True)
    _assert_learner_409(exc_info)
    assert db.rpcs == []


@pytest.mark.parametrize("item", [
    {"id": "i1", "class_archived": True, "class_archive_lane": "closed"},
    {"id": "i1", "class_archived": True, "class_archive_lane": "finish"},
])
def test_a_full_retry_in_an_archived_class_is_409(item):
    with patch.object(qs, "_assignment_item_for", lambda *_a, **_k: item):
        with pytest.raises(HTTPException) as exc_info:
            qs.begin_course_full_retry(user_id="u1", bank_id="b1")
    _assert_learner_409(exc_info)


@pytest.mark.parametrize("cohort,opened_min,action,refused", [
    # Finish lane: the timed run opened before the archive may be resumed.
    (ARCHIVED, 15, "start", False),
    (ARCHIVED, 15, "continue", False),
    # A retake or a full retry is a new start, also in the finish lane.
    (ARCHIVED, 15, "retake", True),
    (ARCHIVED, 15, "retry_full", True),
    (ARCHIVED, 15, None, True),
    # Clock opened after the archive (or never): closed lane.
    (ARCHIVED, 5, "continue", True),
    (ARCHIVED, None, "start", True),
    (ACTIVE, None, "start", False),
    (LEGACY, 5, "retake", False),
])
def test_course_start_archive_rule_matches_the_session_lane(cohort, opened_min, action, refused):
    opened = (NOW - timedelta(minutes=opened_min)).isoformat() if opened_min else None
    item = {"id": "i1", "opened_at": opened, "submitted_at": None, "timed_limit_minutes": 60}
    assignment = {"cohort_id": "c1", "content_config": {"time_limit_minutes": 60}}
    assert qs.course_start_archive_refused(item, assignment, cohort, action) is refused


def test_an_untimed_course_item_has_no_finish_lane_at_the_start():
    item = {"id": "i1", "opened_at": (NOW - timedelta(minutes=15)).isoformat(),
            "submitted_at": None}
    assert qs.course_start_archive_refused(
        item, {"cohort_id": "c1", "content_config": {}}, ARCHIVED, "continue") is True


def test_session_writes_are_refused_unless_the_finish_lane():
    item = {"id": "i1", "opened_at": None, "submitted_at": None}
    assignment = {"cohort_id": "c1", "content_config": {}}
    with patch.object(qs, "supabase_admin", _DB({"cohorts": [ARCHIVED]})):
        with pytest.raises(HTTPException) as exc_info:
            qs._guarded_session_archive_gate(item, assignment, "i1")
    _assert_learner_409(exc_info)

    timed = {"id": "i1", "opened_at": (NOW - timedelta(minutes=15)).isoformat(),
             "submitted_at": None, "timed_limit_minutes": 60}
    with patch.object(qs, "supabase_admin", _DB({"cohorts": [ARCHIVED]})):
        qs._guarded_session_archive_gate(
            timed, {"cohort_id": "c1", "content_config": {"time_limit_minutes": 60}}, "i1")

    for cohort in (ACTIVE, LEGACY):
        with patch.object(qs, "supabase_admin", _DB({"cohorts": [cohort]})):
            qs._guarded_session_archive_gate(item, assignment, "i1")


def test_a_failed_class_read_on_a_session_write_is_a_generic_500():
    with patch.object(qs, "supabase_admin", _DB({"cohorts": [ARCHIVED]}, cohorts_fail=True)):
        with pytest.raises(HTTPException) as exc_info:
            qs._guarded_session_archive_gate({"id": "i1"}, {"cohort_id": "c1"}, "i1")
    assert exc_info.value.status_code == 500
    assert "secret" not in str(exc_info.value.detail)


# ── Advanced Vocabulary ──────────────────────────────────────────────────

@pytest.mark.parametrize("lane", ["closed", "finish"])
def test_advanced_vocab_has_no_finish_lane(monkeypatch, lane):
    item = {"id": "i1", "class_archived": True, "class_archive_lane": lane}
    monkeypatch.setattr(av, "_assignment_finder", lambda *, review: lambda *_a, **_k: item)
    with pytest.raises(HTTPException) as exc_info:
        av._owned_item("b1", "u1", "i1")
    _assert_learner_409(exc_info)
    assert av._owned_item("b1", "u1", "i1", review=True) is item


def test_advanced_vocab_active_item_is_unchanged(monkeypatch):
    item = {"id": "i1", "class_archived": False, "class_archive_lane": None}
    monkeypatch.setattr(av, "_assignment_finder", lambda *, review: lambda *_a, **_k: item)
    assert av._owned_item("b1", "u1", "i1") is item


# ── Grammar lesson ───────────────────────────────────────────────────────

def _grammar_lesson(monkeypatch, cohort, *, attempt=None):
    db = _DB({"cohorts": [cohort]})
    monkeypatch.setattr(gl, "supabase_admin", db)
    assignment = {"id": "a1", "cohort_id": "c1", "content_config": {
        "content_version": gl.CURRENT_VERSION, "lesson_id": "L1",
        "release_id": "r1", "content_sha256": "x"}}
    monkeypatch.setattr(gl, "_entitlement", lambda *_a: ({"id": "i1"}, assignment))
    monkeypatch.setattr(gl, "_owned_attempt", lambda *_a: attempt)
    states: list[dict] = []
    monkeypatch.setattr(gl, "_public_state",
                        lambda _i, _a, _t, **kw: states.append(kw) or {"ok": True})
    return db, states


def test_a_new_grammar_lesson_start_in_an_archived_class_is_409(monkeypatch):
    db, _ = _grammar_lesson(monkeypatch, ARCHIVED)
    with pytest.raises(HTTPException) as exc_info:
        gl.start_item("u1", "i1")
    _assert_learner_409(exc_info)
    assert db.rpcs == []


def test_an_existing_grammar_lesson_attempt_stays_readable_but_closed(monkeypatch):
    _, states = _grammar_lesson(monkeypatch, ARCHIVED, attempt={"id": "t1"})
    assert gl.start_item("u1", "i1") == {"ok": True}
    assert gl.read_item("u1", "i1") == {"ok": True}
    assert states == [{"class_archived": True}, {"class_archived": True}]


def test_a_grammar_lesson_answer_in_an_archived_class_is_409(monkeypatch):
    db, _ = _grammar_lesson(monkeypatch, ARCHIVED, attempt={"id": "t1"})
    with pytest.raises(HTTPException) as exc_info:
        gl.answer_item("u1", "i1", "q1", 0)
    _assert_learner_409(exc_info)
    assert db.rpcs == []


@pytest.mark.parametrize("cohort", [ACTIVE, LEGACY])
def test_grammar_lesson_read_in_active_and_legacy_classes_is_not_archived(monkeypatch, cohort):
    _, states = _grammar_lesson(monkeypatch, cohort, attempt={"id": "t1"})
    gl.read_item("u1", "i1")
    assert states == [{"class_archived": False}]


def test_grammar_lesson_public_state_cannot_submit_when_archived(monkeypatch):
    monkeypatch.setattr(gl, "_version_enabled", lambda _v: True)
    monkeypatch.setattr(gl, "_current_content", lambda *_a: None)
    monkeypatch.setattr(gl, "is_accepting_submissions", lambda _a: True)
    assignment = {"id": "a1", "title": "Bài 1", "content_config": {
        "content_version": gl.CURRENT_VERSION, "lesson_id": "L1", "question_count": 5}}
    open_state = gl._public_state({"id": "i1"}, assignment, None)
    archived = gl._public_state({"id": "i1"}, assignment, None, class_archived=True)
    assert (open_state["can_submit"], open_state["class_archived"]) == (True, False)
    assert (archived["can_submit"], archived["class_archived"]) == (False, True)


# ── Grammar diagnostic ───────────────────────────────────────────────────

def _diagnostic(monkeypatch, cohort):
    monkeypatch.setattr(gd, "supabase_admin", _DB({"cohorts": [cohort],
                                                   "grammar_diagnostic_sessions": []}))
    assignment = {"id": "a1", "cohort_id": "c1", "status": "published",
                  "publish_at": None, "due_at": None}
    monkeypatch.setattr(gd, "_assignment_entitlement",
                        lambda *_a: {"item": {"id": "i1"}, "assignment": assignment})


def test_a_grammar_diagnostic_in_an_archived_class_is_409(monkeypatch):
    _diagnostic(monkeypatch, ARCHIVED)
    with pytest.raises(HTTPException) as exc_info:
        gd._assignment_config("u1", "i1")
    _assert_learner_409(exc_info)
    with pytest.raises(HTTPException) as exc_info:
        gd._require_session_accepting("u1", {"class_assignment_item_id": "i1"})
    _assert_learner_409(exc_info)


def _diagnostic_session(status):
    return {"id": "gs-1", "user_id": "u1", "class_assignment_item_id": "i1",
            "status": status, "current_phase": "core", "mode": "REVIEW",
            "module": "GENERAL", "test_length": "QUICK", "objective_limit": 12,
            "release_id": "r1", "started_at": ARCHIVED_AT}


def _diagnostic_routes(monkeypatch, cohort, session):
    import asyncio
    from unittest.mock import AsyncMock

    from routers import grammar_diagnostic as route

    _diagnostic(monkeypatch, cohort)
    gd.supabase_admin.tables["grammar_diagnostic_sessions"] = [session]
    gd.supabase_admin.tables["grammar_diagnostic_responses"] = []
    monkeypatch.setattr(route, "get_supabase_user", AsyncMock(return_value={"id": "u1"}))
    return SimpleNamespace(
        get=lambda: asyncio.run(route.get_session("gs-1", "Bearer x")),
        history=lambda: asyncio.run(route.list_sessions("Bearer x"))["sessions"],
        answer=lambda: asyncio.run(route.submit_response(
            "gs-1", route.ResponseCreate(item_id="q1", selected_option=0,
                                         response_time_ms=None, assistance_used=False),
            "Bearer x")),
    )


def test_a_completed_grammar_diagnostic_stays_readable_after_the_archive(monkeypatch):
    """Codex thread 4446936254: the session URL and the history still reach
    the saved report of a completed Check-up in an archived class."""
    routes = _diagnostic_routes(monkeypatch, ARCHIVED, _diagnostic_session("completed"))
    assert routes.get()["status"] == "completed"
    assert [row["id"] for row in routes.history()] == ["gs-1"]


def test_an_unfinished_grammar_diagnostic_still_takes_no_answer_after_the_archive(monkeypatch):
    routes = _diagnostic_routes(monkeypatch, ARCHIVED, _diagnostic_session("in_progress"))
    with pytest.raises(HTTPException) as exc_info:
        routes.answer()
    _assert_learner_409(exc_info)
    with pytest.raises(HTTPException) as exc_info:
        routes.get()
    _assert_learner_409(exc_info)
    assert routes.history() == []


@pytest.mark.parametrize("cohort", [ACTIVE, LEGACY])
def test_a_grammar_diagnostic_in_active_and_legacy_classes_is_unchanged(monkeypatch, cohort):
    _diagnostic(monkeypatch, cohort)
    assert gd._assignment_config("u1", "i1")["existing"] is None
    gd._require_session_accepting("u1", {"class_assignment_item_id": "i1"})
