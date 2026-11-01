"""A stale next_item snapshot must not write to a closed session (G4)."""

from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from services import grammar_diagnostic_service as service


CLOSED_DETAIL = {
    "error_code": "diagnostic_exhausted",
    "message": "Phiên này không còn câu độc lập phù hợp.",
}


class FakeSupabase:
    def __init__(self, session):
        self.rows = {
            "grammar_diagnostic_sessions": [session],
            "grammar_diagnostic_responses": [],
            "grammar_exposure_events": [],
        }
        self.before_update = lambda: None
        self.updated_rows = []

    def table(self, name):
        return Query(self, name)


class Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters = []
        self.operation, self.payload = "select", None

    def select(self, *_args):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def order(self, *_args):
        return self

    def limit(self, *_args):
        return self

    def range(self, *_args):
        return self

    def update(self, payload):
        self.operation, self.payload = "update", payload
        return self

    def insert(self, payload):
        self.operation, self.payload = "insert", payload
        return self

    def execute(self):
        if self.operation == "update":
            assert self.name == "grammar_diagnostic_sessions"
            self.db.before_update()
        rows = [row for row in self.db.rows[self.name]
                if all(row.get(key) == value for key, value in self.filters)]
        if self.operation == "update":
            for row in rows:
                row.update(deepcopy(self.payload))
            self.db.updated_rows.append(len(rows))
        elif self.operation == "insert":
            rows = [deepcopy(self.payload)]
            self.db.rows[self.name].extend(rows)
        # Reads must be snapshots, not references that conceal stale reads.
        return SimpleNamespace(data=deepcopy(rows))


@pytest.fixture
def selector(monkeypatch):
    session = {
        "id": "session", "user_id": "learner", "status": "in_progress",
        "release_id": "release", "test_length": "QUICK", "objective_limit": 28,
        "current_phase": "BASELINE", "mode": "ENTRY", "module": "GENERAL",
    }
    db = FakeSupabase(session)
    item = {
        "item_id": "confirmation-item", "attribute_id": "M01", "module": "ALL",
        "diagnostic_status": "CONFIRMATION_RESERVED", "stimulus_family": "family",
        "prompt": "Choose.", "options": ["A", "B"],
    }
    content = {"items": [item], "by_id": {item["item_id"]: item}}
    monkeypatch.setattr(service, "supabase_admin", db)
    monkeypatch.setattr(service, "_require_session_accepting", lambda *_: None)
    monkeypatch.setattr(service, "_content", lambda *_: content)
    monkeypatch.setattr(service, "_practice_exposure", lambda *_: {
        "item_ids": set(), "stimulus_families": set(), "parallel_set_ids": set(),
    })
    return db, session, content


def _finish_baseline(db):
    db.rows["grammar_diagnostic_responses"] = [
        {"session_id": "session", "item_id": f"answered-{i}",
         "attribute_id": service.ATTRIBUTES[i % len(service.ATTRIBUTES)],
         "phase": "BASELINE", "is_correct": False}
        for i in range(service.LIMITS["QUICK"][0])
    ]


@pytest.mark.parametrize("closed_status", ["completed", "exhausted"])
def test_stale_phase_change_does_not_update_or_expose(selector, closed_status):
    db, session, _ = selector
    _finish_baseline(db)

    def close_before_update():
        session.update(status=closed_status, current_phase="COMPLETED")

    db.before_update = close_before_update
    with pytest.raises(HTTPException) as caught:
        service.next_item("learner", "session")
    assert (caught.value.status_code, caught.value.detail) == (409, CLOSED_DETAIL)
    assert session["status"] == closed_status
    assert session["current_phase"] == "COMPLETED"
    assert "updated_at" not in session
    assert db.updated_rows == [0]
    assert db.rows["grammar_exposure_events"] == []


@pytest.mark.parametrize("closed_status", ["completed", "exhausted"])
def test_stale_exhaustion_preserves_closed_session(selector, closed_status):
    db, session, content = selector
    content["items"] = []

    def close_before_update():
        session.update(status=closed_status)

    db.before_update = close_before_update
    with pytest.raises(HTTPException) as caught:
        service.next_item("learner", "session")
    assert (caught.value.status_code, caught.value.detail) == (409, CLOSED_DETAIL)
    assert session["status"] == closed_status
    assert session["current_phase"] == "BASELINE"
    assert "updated_at" not in session
    assert db.updated_rows == [0]
    assert db.rows["grammar_exposure_events"] == []


def test_in_progress_advances_phase_and_inserts_one_exposure(selector):
    db, session, _ = selector
    _finish_baseline(db)
    result = service.next_item("learner", "session")
    assert result["complete"] is False
    assert result["item"]["phase"] == "CONFIRMATION"
    assert result["item"]["ordinal"] == 19
    assert session["status"] == "in_progress"
    assert session["current_phase"] == "CONFIRMATION"
    assert db.updated_rows == [1]
    assert db.rows["grammar_exposure_events"] == [{
        "user_id": "learner", "session_id": "session", "release_id": "release",
        "item_id": "confirmation-item", "stimulus_family": "family",
        "parallel_set_id": None, "phase": "CONFIRMATION",
    }]


def test_in_progress_exhaustion_keeps_existing_detail(selector):
    db, session, content = selector
    content["items"] = []
    with pytest.raises(HTTPException) as caught:
        service.next_item("learner", "session")
    assert (caught.value.status_code, caught.value.detail) == (409, {
        "error_code": "diagnostic_exhausted",
        "message": "Đã hết mẫu độc lập phù hợp; hệ thống không tái sử dụng câu cũ.",
    })
    assert session["status"] == "exhausted"
    assert session["current_phase"] == "BASELINE"
    assert db.updated_rows == [1]
    assert db.rows["grammar_exposure_events"] == []
