"""B1 / review Mục 1 — full-test finalization must not complete a session whose
grading is still incomplete after the grace window.

`_bg_finalize_full_test` used to call `_complete_session_internal` (which
AGGREGATES band scores) for EVERY session once the poll/grace window elapsed —
even when responses were still ungraded. The band was then computed from partial
data and shown to the user as a real score.

Fix: only complete a session that is actually fully graded; mark the rest
`analysis_failed` so the band is NOT aggregated from incomplete data. These
tests pin both branches without waiting on the real 90s+120s timers.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import BackgroundTasks, HTTPException
from pydantic import ValidationError

from routers import sessions as sessions_module


_OK = "sess-ok"      # fully graded
_BAD = "sess-bad"    # grading never completes


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Builder:
    def __init__(self, parent, table):
        self._p = parent; self._t = table; self._payload = None; self._eq = []

    def update(self, payload, *_a, **_k):
        self._payload = payload; return self

    def eq(self, col, val):
        self._eq.append((col, val)); return self

    def execute(self):
        if self._t == "sessions" and self._payload is not None:
            self._p.session_updates.append({"payload": self._payload, "eq": list(self._eq)})
        class _R:
            data: Any = []
        return _R()


class _Rec:
    def __init__(self):
        self.session_updates: list[dict] = []

    def table(self, name):
        return _Builder(self, name)


@pytest.fixture
def patched(monkeypatch):
    rec = _Rec()
    completed: list[str] = []

    async def _instant_sleep(*_a, **_k):
        return None

    # readiness: a session is "ready" iff every id in the batch is _OK.
    def _fake_check(ids):
        return all(i == _OK for i in ids)

    def _fake_complete(sid):
        completed.append(sid)

    monkeypatch.setattr(asyncio, "sleep", _instant_sleep)
    monkeypatch.setattr(sessions_module, "_check_all_responses_graded", _fake_check)
    monkeypatch.setattr(sessions_module, "_complete_session_internal", _fake_complete)
    monkeypatch.setattr(sessions_module, "supabase_admin", rec)
    return rec, completed


def _failed_ids(rec):
    return [
        u["eq"][0][1] for u in rec.session_updates
        if u["payload"].get("status") == "analysis_failed"
    ]


def test_incomplete_session_marked_failed_not_completed(patched):
    """Mixed batch: the graded session completes; the ungraded one is marked
    analysis_failed and is NOT passed to band aggregation."""
    rec, completed = patched
    _run(sessions_module._bg_finalize_full_test([_OK, _BAD]))

    assert completed == [_OK], "only the fully-graded session may aggregate a band"
    assert _BAD in _failed_ids(rec), "the ungraded session must be marked analysis_failed"
    assert _OK not in _failed_ids(rec)


def test_all_graded_completes_without_failed(patched):
    """Happy path: everything graded → both complete, nothing marked failed."""
    rec, completed = patched
    _run(sessions_module._bg_finalize_full_test([_OK, _OK]))

    assert completed == [_OK, _OK]
    assert _failed_ids(rec) == [], "no session should be analysis_failed when all graded"


class _CoverageResult:
    def __init__(self, data):
        self.data = data


class _CoverageBuilder:
    def __init__(self, parent, table):
        self.parent = parent
        self.table = table
        self.session_id = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        if column == "session_id":
            self.session_id = value
        return self

    def execute(self):
        return _CoverageResult(self.parent.rows[self.table].get(self.session_id, []))


class _CoverageDb:
    def __init__(self, questions, responses):
        self.rows = {"questions": questions, "responses": responses}

    def table(self, name):
        return _CoverageBuilder(self, name)


def test_readiness_requires_each_question_id_not_just_equal_response_count(monkeypatch):
    db = _CoverageDb(
        questions={"s1": [{"id": "q1"}, {"id": "q2"}]},
        responses={"s1": [
            {"id": "r1", "question_id": "q1", "grading_status": "completed", "overall_band": 7},
            {"id": "r2", "question_id": "q1", "grading_status": "completed", "overall_band": 7.5},
        ]},
    )
    monkeypatch.setattr(sessions_module, "supabase_admin", db)
    assert sessions_module._check_all_responses_graded(["s1"]) is False


def test_readiness_rejects_empty_question_set(monkeypatch):
    db = _CoverageDb(questions={"s1": []}, responses={"s1": []})
    monkeypatch.setattr(sessions_module, "supabase_admin", db)
    assert sessions_module._check_all_responses_graded(["s1"]) is False


def test_readiness_accepts_exact_question_coverage(monkeypatch):
    db = _CoverageDb(
        questions={"s1": [{"id": "q1"}, {"id": "q2"}]},
        responses={"s1": [
            {"id": "r1", "question_id": "q1", "grading_status": "completed", "overall_band": 7},
            {"id": "r2", "question_id": "q2", "grading_status": "completed", "overall_band": 6.5},
        ]},
    )
    monkeypatch.setattr(sessions_module, "supabase_admin", db)
    assert sessions_module._check_all_responses_graded(["s1"]) is True


def test_finalize_body_requires_all_three_parts():
    with pytest.raises(ValidationError):
        sessions_module.FinalizeFullTestBody(p1_id="p1")
    with pytest.raises(ValidationError):
        sessions_module.FinalizeFullTestBody(p1_id="p1", p2_id=" ", p3_id="p3")

    with pytest.raises(ValidationError):
        sessions_module.CreateSessionBody(
            mode="test_full", part=2, topic="Topic", previous_session_id=" ",
        )


def test_full_test_chain_rejects_duplicates_and_wrong_part_or_mode():
    with pytest.raises(HTTPException) as duplicate:
        sessions_module._validate_full_test_chain(["p1", "p1", "p3"], [])
    assert duplicate.value.status_code == 400

    with pytest.raises(HTTPException) as wrong_mode:
        sessions_module._validate_full_test_chain(
            ["p1", "p2", "p3"],
            [
                {"id": "p1", "mode": "test_full", "part": 1},
                {"id": "p2", "mode": "practice", "part": 2},
                {"id": "p3", "mode": "test_full", "part": 3},
            ],
        )
    assert wrong_mode.value.status_code == 400

    sessions_module._validate_full_test_chain(
        ["p1", "p2", "p3"],
        [
            {"id": "p1", "mode": "test_full", "part": 1, "full_test_attempt_id": "a1"},
            {"id": "p2", "mode": "test_full", "part": 2, "full_test_attempt_id": "a1"},
            {"id": "p3", "mode": "test_full", "part": 3, "full_test_attempt_id": "a1"},
        ],
    )

    with pytest.raises(HTTPException) as mixed_attempt:
        sessions_module._validate_full_test_chain(
            ["p1", "p2", "p3"],
            [
                {"id": "p1", "mode": "test_full", "part": 1, "full_test_attempt_id": "a1"},
                {"id": "p2", "mode": "test_full", "part": 2, "full_test_attempt_id": "a2"},
                {"id": "p3", "mode": "test_full", "part": 3, "full_test_attempt_id": "a1"},
            ],
        )
    assert mixed_attempt.value.status_code == 400

    with pytest.raises(HTTPException) as missing_attempt:
        sessions_module._validate_full_test_chain(
            ["p1", "p2", "p3"],
            [
                {"id": "p1", "mode": "test_full", "part": 1},
                {"id": "p2", "mode": "test_full", "part": 2},
                {"id": "p3", "mode": "test_full", "part": 3},
            ],
        )
    assert missing_attempt.value.status_code == 400

    with pytest.raises(HTTPException) as mixed_sitting:
        sessions_module._validate_full_test_chain(
            ["p1", "p2", "p3"],
            [
                {"id": "p1", "mode": "test_full", "part": 1, "sitting_id": "sit-a", "full_test_attempt_id": "a1"},
                {"id": "p2", "mode": "test_full", "part": 2, "sitting_id": "sit-b", "full_test_attempt_id": "a1"},
                {"id": "p3", "mode": "test_full", "part": 3, "sitting_id": "sit-a", "full_test_attempt_id": "a1"},
            ],
        )
    assert mixed_sitting.value.status_code == 400


class _AttemptBuilder:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        self.rows = [row for row in self.rows if row.get(column) == value]
        return self

    def limit(self, count):
        self.rows = self.rows[:count]
        return self

    def execute(self):
        return _CoverageResult(self.rows)


class _AttemptDb:
    def __init__(self, rows):
        self.rows = rows

    def table(self, name):
        assert name == "sessions"
        return _AttemptBuilder(list(self.rows))


def test_next_full_test_part_inherits_only_from_owned_immediate_predecessor(monkeypatch):
    db = _AttemptDb([{
        "id": "p1",
        "user_id": "u1",
        "mode": "test_full",
        "part": 1,
        "status": "in_progress",
        "resume_expires_at": "2999-01-01T00:00:00+00:00",
        "full_test_attempt_id": "attempt-1",
    }])
    monkeypatch.setattr(sessions_module, "supabase_admin", db)
    body = sessions_module.CreateSessionBody(
        mode="test_full", part=2, topic="Topic", previous_session_id="p1",
    )
    assert sessions_module._resolve_full_test_attempt_id("u1", body) == "attempt-1"

    with pytest.raises(HTTPException) as wrong_owner:
        sessions_module._resolve_full_test_attempt_id("u2", body)
    assert wrong_owner.value.status_code == 400

    with pytest.raises(HTTPException) as missing_previous:
        sessions_module._resolve_full_test_attempt_id(
            "u1", sessions_module.CreateSessionBody(mode="test_full", part=2, topic="Topic"),
        )
    assert missing_previous.value.status_code == 400


def test_full_test_attempt_migration_enforces_trigger_and_unique_part():
    migration = (
        Path(__file__).parent.parent / "migrations" / "200_speaking_full_test_attempt_identity.sql"
    ).read_text()
    assert "CREATE TRIGGER trg_sessions_full_test_attempt_id" in migration
    assert "gen_random_uuid()" in migration
    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_full_test_attempt_part" in migration
    assert "CHECK (mode <> 'test_full' OR full_test_attempt_id IS NOT NULL)" in migration


def test_full_test_question_count_contract_is_exact_9_1_5():
    rows = (
        [{"id": f"q1-{i}", "session_id": "p1"} for i in range(9)]
        + [{"id": "q2-1", "session_id": "p2"}]
        + [{"id": f"q3-{i}", "session_id": "p3"} for i in range(5)]
    )
    sessions_module._validate_full_test_question_counts(["p1", "p2", "p3"], rows)

    with pytest.raises(HTTPException) as incomplete:
        sessions_module._validate_full_test_question_counts(
            ["p1", "p2", "p3"],
            rows[:-1],
        )
    assert incomplete.value.status_code == 409


class _FinalizeEndpointBuilder:
    def __init__(self, db, table):
        self.db = db
        self.table = table
        self.payload = None
        self.filters = []

    def select(self, *_args, **_kwargs):
        return self

    def update(self, payload):
        self.payload = payload
        return self

    def in_(self, column, values):
        self.filters.append(("in", column, set(values)))
        return self

    def eq(self, column, value):
        self.filters.append(("eq", column, value))
        return self

    def _rows(self):
        rows = self.db.sessions if self.table == "sessions" else self.db.questions
        out = list(rows)
        for kind, column, value in self.filters:
            if kind == "in":
                out = [row for row in out if row.get(column) in value]
            else:
                out = [row for row in out if row.get(column) == value]
        return out

    def execute(self):
        rows = self._rows()
        if self.payload is not None:
            if self.db.update_error is not None:
                raise self.db.update_error
            for row in rows:
                row.update(self.payload)
            self.db.updated_ids.extend(row["id"] for row in rows)
        return _CoverageResult([dict(row) for row in rows])


class _FinalizeEndpointDb:
    def __init__(self, expiry="2999-01-01T00:00:00+00:00", update_error=None):
        self.sessions = [
            {
                "id": f"p{part}",
                "user_id": "u1",
                "mode": "test_full",
                "part": part,
                "status": "in_progress",
                "sitting_id": None,
                "full_test_attempt_id": "attempt-1",
                "resume_expires_at": expiry,
            }
            for part in (1, 2, 3)
        ]
        self.questions = (
            [{"id": f"q1-{i}", "session_id": "p1"} for i in range(9)]
            + [{"id": "q2-1", "session_id": "p2"}]
            + [{"id": f"q3-{i}", "session_id": "p3"} for i in range(5)]
        )
        self.update_error = update_error
        self.updated_ids = []

    def table(self, name):
        return _FinalizeEndpointBuilder(self, name)


def _finalize_body():
    return sessions_module.FinalizeFullTestBody(p1_id="p1", p2_id="p2", p3_id="p3")


def _patch_finalize_auth(monkeypatch):
    async def _auth(_authorization):
        return {"id": "u1"}

    monkeypatch.setattr(sessions_module, "get_supabase_user", _auth)


def test_finalize_full_test_rejects_expired_part_before_terminal_write(monkeypatch):
    db = _FinalizeEndpointDb(expiry="2000-01-01T00:00:00+00:00")
    monkeypatch.setattr(sessions_module, "supabase_admin", db)
    _patch_finalize_auth(monkeypatch)

    with pytest.raises(HTTPException) as expired:
        _run(sessions_module.finalize_full_test(_finalize_body(), BackgroundTasks()))

    assert expired.value.status_code == 410
    assert db.updated_ids == []


def test_finalize_full_test_maps_db_deadline_race_to_410(monkeypatch):
    db = _FinalizeEndpointDb(update_error=RuntimeError("active_player_expired"))
    monkeypatch.setattr(sessions_module, "supabase_admin", db)
    _patch_finalize_auth(monkeypatch)
    tasks = BackgroundTasks()

    with pytest.raises(HTTPException) as expired:
        _run(sessions_module.finalize_full_test(_finalize_body(), tasks))

    assert expired.value.status_code == 410
    assert tasks.tasks == []


def test_finalize_full_test_persists_all_three_before_scheduling(monkeypatch):
    db = _FinalizeEndpointDb()
    monkeypatch.setattr(sessions_module, "supabase_admin", db)
    _patch_finalize_auth(monkeypatch)
    tasks = BackgroundTasks()

    result = _run(sessions_module.finalize_full_test(_finalize_body(), tasks))

    assert result == {"accepted": True, "session_ids": ["p1", "p2", "p3"]}
    assert db.updated_ids == ["p1", "p2", "p3"]
    assert len(tasks.tasks) == 1
