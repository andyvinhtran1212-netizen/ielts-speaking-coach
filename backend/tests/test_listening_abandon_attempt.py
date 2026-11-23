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
        "created_at": _iso(-10), "submitted_at": None, "score": None, "grading_details": None,
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
    (row,) = out["recent_attempts"]
    assert row["status"] == "abandoned" and row["accuracy"] is None


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
