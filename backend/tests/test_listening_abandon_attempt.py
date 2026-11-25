"""EXAMLISTENT-0070 FR-012: POST /api/listening/tests/attempts/{id}/abandon.

Behaviour checks against an in-memory table that applies the same filters the
route sends (``eq``, ``is_``, ``gt``), so the CAS is exercised, not mocked:
the 200/404/409 branches, a submit racing the abandon, and that an abandoned
attempt yields no result in the three read paths (review, Listening history
analytics, Progress on the home summary).
"""
from __future__ import annotations

import asyncio
import copy
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from routers import listening as lr
from services import core_attempt_observation as obs
from services import student_home_aggregator

USER = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
ATTEMPT = "33333333-3333-4333-8333-333333333333"
TEST = "44444444-4444-4444-8444-444444444444"


def _iso(delta_minutes: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=delta_minutes)).isoformat()


class _Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters, self.patch, self.count, self.limit_n = [], None, None, None
        self.order_key = None

    def select(self, _cols="*", count=None):
        self.count = count
        return self

    def update(self, patch):
        self.patch = patch
        return self

    def eq(self, col, value):
        self.filters.append(lambda r: r.get(col) == value)
        return self

    def is_(self, col, value):
        assert value == "null"
        negate, self.negate_next = getattr(self, "negate_next", False), False
        self.filters.append(lambda r: (r.get(col) is None) != negate)
        return self

    @property
    def not_(self):
        self.negate_next = True
        return self

    def gt(self, col, value):
        self.filters.append(lambda r: r.get(col) is not None and r[col] > value)
        return self

    def gte(self, col, value):
        self.filters.append(lambda r: r.get(col) is not None and r[col] >= value)
        return self

    def in_(self, col, values):
        self.filters.append(lambda r: r.get(col) in values)
        return self

    def order(self, col, desc=False):
        self.order_key = (col, desc)
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def range(self, a, b):
        return self

    def execute(self):
        self.db.calls.append((self.table, "update" if self.patch else "select"))
        if self.patch is not None and self.db.before_update:
            hook, self.db.before_update = self.db.before_update, None
            hook(self.db)
        rows = [r for r in self.db.tables.setdefault(self.table, []) if all(f(r) for f in self.filters)]
        if self.patch is not None:
            for r in rows:
                r.update(self.patch)
        if self.order_key:
            col, desc = self.order_key
            rows = sorted(rows, key=lambda r: r.get(col) or "", reverse=desc)
        if self.limit_n is not None:
            rows = rows[: self.limit_n]
        out = type("Res", (), {})()
        out.data = [copy.deepcopy(r) for r in rows]
        out.count = len(out.data)
        return out


class _DB:
    def __init__(self, rows):
        self.tables = {"listening_test_attempts": rows, "listening_tests": [
            {"id": TEST, "test_id": "cam-1", "title": "Cambridge 1", "test_type": "full"}]}
        self.calls = []
        self.before_update = None

    def table(self, name):
        return _Query(self, name)

    @property
    def attempt(self):
        return self.tables["listening_test_attempts"][0]


def _attempt(**over):
    row = {
        "id": ATTEMPT, "test_id": TEST, "user_id": USER, "status": "in_progress",
        "answers": [{"q_num": 1, "answer": "x"}], "scoring_policy": "diagnostic",
        "paper_revision": None, "sitting_id": None, "class_assignment_item_id": None,
        "attempt_purpose": "delivery", "started_at": _iso(-10), "resume_expires_at": _iso(60),
        "created_at": _iso(-10), "updated_at": _iso(-10), "renderer_affinity": "next", "submitted_at": None, "score": None, "grading_details": None,
    }
    row.update(over)
    return row


@pytest.fixture
def db(monkeypatch):
    database = _DB([_attempt()])

    async def fake_auth(_authorization):
        return {"id": USER}

    async def not_admin(_authorization):
        return False

    monkeypatch.setattr(lr, "supabase_admin", database)
    monkeypatch.setattr(lr, "_require_auth", fake_auth)
    monkeypatch.setattr(lr, "_is_admin", not_admin)
    return database


def _abandon():
    return asyncio.run(lr.abandon_listening_test_attempt(ATTEMPT, authorization="Bearer t"))


def _reason(exc: pytest.ExceptionInfo) -> tuple[int, object]:
    return exc.value.status_code, exc.value.detail


def _body(response) -> dict:
    import json
    assert response.headers["cache-control"] == "private, no-store"
    return json.loads(response.body)


def test_abandon_closes_the_own_self_selected_attempt_with_one_conditional_update(db):
    assert _body(_abandon()) == {"attempt_id": ATTEMPT, "status": "abandoned"}
    assert db.attempt["status"] == "abandoned"
    assert db.attempt["answers"] == [{"q_num": 1, "answer": "x"}]
    assert [c for c in db.calls if c[1] == "update"] == [("listening_test_attempts", "update")]


def test_repeating_abandon_returns_the_same_200(db):
    _abandon()
    assert _body(_abandon()) == {"attempt_id": ATTEMPT, "status": "abandoned"}


def test_abandon_moves_updated_at_only_when_it_closes_the_attempt(db):
    before = db.attempt["updated_at"]
    _abandon()
    closed_at = db.attempt["updated_at"]
    assert closed_at > before
    _abandon()  # the repeat changes nothing
    assert db.attempt["updated_at"] == closed_at


def test_a_refused_abandon_leaves_updated_at_alone(db):
    db.attempt["resume_expires_at"] = _iso(-1)
    before = db.attempt["updated_at"]
    with pytest.raises(HTTPException):
        _abandon()
    assert db.attempt["updated_at"] == before


@pytest.fixture
def receipts(monkeypatch):
    events = []

    async def record(**fields):
        events.append(fields)

    monkeypatch.setattr(obs.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", True)
    monkeypatch.setattr(obs, "try_record_event", record)
    return events


def test_abandon_writes_the_same_abandonment_receipt_as_start_over(db, receipts):
    _abandon()
    assert len(receipts) == 1
    event = receipts[0]
    assert event["surface"] == "listening_test" and event["attempt_kind"] == "default"
    assert str(event["canonical_attempt_id"]) == ATTEMPT
    assert (event["operation"], event["event_kind"], event["outcome"]) == ("start", "outcome_observed", "abandoned")
    assert event["renderer"] == "next"
    assert set(event) == {"event_id", "operation_id", "surface", "attempt_kind", "canonical_attempt_id",
                          "operation", "event_kind", "outcome", "renderer"}


def test_repeat_or_refused_abandon_writes_no_receipt(db, receipts):
    _abandon()
    receipts.clear()
    _abandon()
    assert receipts == []
    db.attempt.update(status="submitted")
    with pytest.raises(HTTPException):
        _abandon()
    assert receipts == []


def test_no_receipt_when_evidence_is_disabled(db, receipts, monkeypatch):
    monkeypatch.setattr(obs.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", False)
    assert _body(_abandon())["status"] == "abandoned"
    assert receipts == []


def test_receipt_failure_never_fails_the_abandon(db, monkeypatch):
    async def broken(**_fields):
        raise RuntimeError("evidence down")

    monkeypatch.setattr(obs.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", True)
    monkeypatch.setattr(obs, "try_record_event", broken)
    assert _body(_abandon()) == {"attempt_id": ATTEMPT, "status": "abandoned"}
    assert db.attempt["status"] == "abandoned"


def test_unverified_update_row_writes_no_receipt(receipts):
    row = {"id": ATTEMPT, "test_id": TEST, "user_id": OTHER, "status": "abandoned", "renderer_affinity": "next"}
    asyncio.run(obs.record_explicit_exam_abandonment(
        [row], surface="listening_test", attempt_id=ATTEMPT, test_id=TEST, user_id=USER))
    assert receipts == []


def test_someone_elses_attempt_is_404_and_untouched(db):
    db.attempt["user_id"] = OTHER
    with pytest.raises(HTTPException) as exc:
        _abandon()
    assert exc.value.status_code == 404
    assert db.attempt["status"] == "in_progress"


@pytest.mark.parametrize("field, value", [
    ("class_assignment_item_id", "55555555-5555-4555-8555-555555555555"),
    ("sitting_id", "66666666-6666-4666-8666-666666666666"),
])
def test_class_item_or_mock_sitting_attempt_is_not_self_selected(db, field, value):
    db.attempt[field] = value
    with pytest.raises(HTTPException) as exc:
        _abandon()
    assert _reason(exc) == (409, {"reason": "not_self_selected"})
    assert db.attempt["status"] == "in_progress"


def test_submitted_attempt_is_409_already_submitted(db):
    db.attempt.update(status="submitted", submitted_at=_iso(-1), score=30)
    with pytest.raises(HTTPException) as exc:
        _abandon()
    assert _reason(exc) == (409, {"reason": "already_submitted"})
    assert db.attempt["status"] == "submitted"


def test_expired_resume_window_is_409_resume_expired(db):
    db.attempt["resume_expires_at"] = _iso(-1)
    with pytest.raises(HTTPException) as exc:
        _abandon()
    assert _reason(exc) == (409, {"reason": "resume_expired"})
    assert db.attempt["status"] == "in_progress"


def test_submit_winning_between_read_and_update_makes_abandon_409(db):
    # The submit finalize lands after abandon's ownership read: the CAS on
    # status='in_progress' misses, and the re-read reports the real state.
    def submit_wins(database):
        database.attempt.update(status="submitted", submitted_at=_iso(0), score=30)
    db.before_update = submit_wins
    with pytest.raises(HTTPException) as exc:
        _abandon()
    assert _reason(exc) == (409, {"reason": "already_submitted"})
    assert db.attempt["status"] == "submitted" and db.attempt["score"] == 30


def test_abandon_winning_first_makes_submit_refuse(db):
    _abandon()
    with pytest.raises(HTTPException) as exc:
        asyncio.run(lr.submit_listening_test_attempt(ATTEMPT, authorization="Bearer t"))
    assert exc.value.status_code in (409, 422)
    assert db.attempt["status"] == "abandoned" and db.attempt["score"] is None


def test_abandoned_attempt_has_no_review(db):
    _abandon()
    with pytest.raises(HTTPException) as exc:
        asyncio.run(lr.get_listening_test_attempt_review(ATTEMPT, authorization="Bearer t"))
    assert exc.value.status_code == 409


def test_abandoned_attempt_gives_no_score_in_listening_history(db, monkeypatch):
    monkeypatch.setattr(lr, "_assisted_programme_attempt_ids", lambda ids: set())
    _abandon()
    out = asyncio.run(lr.get_listening_analytics(time_range="all", authorization="Bearer t"))
    full = out["by_mode"]["full"]
    assert full["scored_count"] == 0 and full["avg_score"] is None
    assert full["completion"] == 0.0
    assert out["weakest_mode"] is None
    assert out["recent_attempts"] == []
    assert out["total_attempts"] == 1        # engagement still counts it


def test_abandoned_attempt_is_left_out_of_history_next_to_a_submitted_one(db, monkeypatch):
    monkeypatch.setattr(lr, "_assisted_programme_attempt_ids", lambda ids: set())
    _abandon()
    done = "00000000-0000-0000-0000-0000000000d1"
    db.tables["listening_test_attempts"].append(_attempt(
        id=done, status="submitted", score=1, created_at=_iso(-20), submitted_at=_iso(-15),
        grading_details=[{"q_num": 1, "correct": True}]))
    out = asyncio.run(lr.get_listening_analytics(time_range="all", authorization="Bearer t"))
    assert [r["id"] for r in out["recent_attempts"]] == [done]
    assert out["recent_attempts"][0]["status"] == "submitted"


def test_abandoned_attempt_is_not_counted_in_progress(db):
    _abandon()
    db.attempt["band_estimate"] = 6.5
    built = student_home_aggregator._build_listening(db, USER)
    assert built["attempts_count"] == 0
    assert built["last_activity_at"] is None and built["last_band"] is None


def test_route_is_registered_once_with_a_specific_response_model():
    from main import app
    client = TestClient(app)
    routes = [r for r in app.routes
              if getattr(r, "path", "") == "/api/listening/tests/attempts/{attempt_id}/abandon"]
    assert len(routes) == 1 and routes[0].methods == {"POST"}
    assert routes[0].response_model is lr.ListeningAttemptAbandonResponse
    assert client.post(f"/api/listening/tests/attempts/{ATTEMPT}/abandon").status_code == 401
