import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import sessions as sessions_module


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self.db = db
        self.table = table
        self.filters = []
        self.maximum = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        self.filters.append(("eq", column, value))
        return self

    def in_(self, column, values):
        self.filters.append(("in", column, set(values)))
        return self

    def limit(self, value):
        self.maximum = value
        return self

    def execute(self):
        self.db.calls.append(self.table)
        if self.table in self.db.fail_tables:
            raise RuntimeError(f"{self.table} unavailable")
        rows = list(self.db.rows.get(self.table, []))
        for kind, column, value in self.filters:
            if kind == "eq":
                rows = [row for row in rows if row.get(column) == value]
            else:
                rows = [row for row in rows if row.get(column) in value]
        if self.maximum is not None:
            rows = rows[:self.maximum]
        return _Result(rows)


class _Db:
    def __init__(self, rows, fail_tables=()):
        self.rows = rows
        self.fail_tables = set(fail_tables)
        self.calls = []

    def table(self, name):
        return _Query(self, name)


def _sessions(*, sitting_id=None, attempt_id="00000000-0000-4000-8000-000000000001"):
    return [
        {
            "id": f"p{part}", "user_id": "user-1", "mode": "test_full", "part": part,
            "topic": f"Topic {part}", "status": "completed", "started_at": "2026-08-09T01:00:00Z",
            "sitting_id": sitting_id, "full_test_attempt_id": attempt_id,
            "overall_band": 6 + part / 2, "band_fc": 6.0, "band_lr": 6.5,
            "band_gra": 7.0, "band_p": 7.5,
        }
        for part in (1, 2, 3)
    ]


def _questions():
    counts = {"p1": 9, "p2": 1, "p3": 5}
    return [
        {"id": f"{sid}-q{index}", "session_id": sid}
        for sid, count in counts.items()
        for index in range(count)
    ]


def _responses():
    return [{
        "id": "r1", "session_id": "p1", "question_id": "p1-q0",
        "grading_status": "completed", "pronunciation_status": "completed",
        "pronunciation_score": 80, "pronunciation_accuracy": 82,
        "pronunciation_fluency": 78, "pronunciation_completeness": 90,
        "pronunciation_payload": {
            "NBest": [{"PronunciationAssessment": {"ProsodyScore": 76}}],
        },
        "feedback": {
            "strengths": ["Triển khai ý rõ"],
            "improvements": ["Dùng thêm từ nối"],
            "grammar_issues": [{"original": "I go yesterday", "correction": "I went yesterday"}],
        },
    }]


def _patch(monkeypatch, *, sessions=None, fail_tables=()):
    db = _Db({
        "sessions": sessions if sessions is not None else _sessions(),
        "questions": _questions(),
        "responses": _responses(),
    }, fail_tables=fail_tables)

    async def fake_user(_authorization):
        return {"id": "user-1"}

    monkeypatch.setattr(sessions_module, "get_supabase_user", fake_user)
    monkeypatch.setattr(sessions_module, "supabase_admin", db)
    return db


def test_new_attempt_resolves_all_parts_and_uses_only_canonical_persisted_scores(monkeypatch):
    _patch(monkeypatch)
    output = _run(sessions_module.get_full_test_summary(
        "p1", p2_id=None, p3_id=None, authorization="Bearer token",
    ))

    assert output["result_status"] == "ready"
    assert output["chain_verified"] is True
    assert output["full_test_attempt_id"] == "00000000-0000-4000-8000-000000000001"
    assert [part["session_id"] for part in output["parts"]] == ["p1", "p2", "p3"]
    assert output["overall_band"] == 7.0
    assert output["band_p"] == 7.5
    assert output["top_grammar_issues"] == ["I go yesterday → I went yesterday"]
    assert output["pronunciation"] == {
        "response_count": 1,
        "overall": 80.0,
        "accuracy": 82.0,
        "fluency": 78.0,
        "completeness": 90.0,
        "prosody": 76.0,
    }


def test_legacy_attempt_requires_all_three_explicit_ids(monkeypatch):
    _patch(monkeypatch, sessions=_sessions(attempt_id=None))
    with pytest.raises(HTTPException) as caught:
        _run(sessions_module.get_full_test_summary(
            "p1", p2_id=None, p3_id=None, authorization="Bearer token",
        ))
    assert caught.value.status_code == 400


def test_historical_attempts_use_explicit_owned_parts_without_claiming_verified_affinity(monkeypatch):
    rows = _sessions()
    rows[1]["full_test_attempt_id"] = "00000000-0000-4000-8000-000000000002"
    rows[2]["full_test_attempt_id"] = "00000000-0000-4000-8000-000000000003"
    _patch(monkeypatch, sessions=rows)
    output = _run(sessions_module.get_full_test_summary(
        "p1", p2_id="p2", p3_id="p3", authorization="Bearer token",
    ))
    assert output["result_status"] == "ready"
    assert output["chain_verified"] is False
    assert [part["session_id"] for part in output["parts"]] == ["p1", "p2", "p3"]


def test_historical_mock_sitting_does_not_invent_attempt_affinity(monkeypatch):
    rows = _sessions(sitting_id="sit-legacy")
    rows[1]["full_test_attempt_id"] = "00000000-0000-4000-8000-000000000002"
    rows[2]["full_test_attempt_id"] = "00000000-0000-4000-8000-000000000003"
    _patch(monkeypatch, sessions=rows)
    monkeypatch.setattr("services.mock_exam_service.is_sealed", lambda _sitting_id: False)
    output = _run(sessions_module.get_full_test_summary(
        "p1", p2_id="p2", p3_id="p3", authorization="Bearer token",
    ))
    assert output["result_status"] == "ready"
    assert output["chain_verified"] is False


def test_active_attempt_cannot_fall_back_to_mismatched_explicit_parts(monkeypatch):
    rows = _sessions()
    rows[1]["full_test_attempt_id"] = "00000000-0000-4000-8000-000000000002"
    rows[2]["full_test_attempt_id"] = "00000000-0000-4000-8000-000000000003"
    rows[0]["status"] = "in_progress"
    _patch(monkeypatch, sessions=rows)
    with pytest.raises(HTTPException) as caught:
        _run(sessions_module.get_full_test_summary(
            "p1", p2_id="p2", p3_id="p3", authorization="Bearer token",
        ))
    assert caught.value.status_code == 409


def test_sealed_mock_never_queries_or_returns_feedback_and_scores(monkeypatch):
    db = _patch(monkeypatch, sessions=_sessions(sitting_id="sit-1"))
    monkeypatch.setattr("services.mock_exam_service.is_sealed", lambda sitting_id: sitting_id == "sit-1")
    output = _run(sessions_module.get_full_test_summary(
        "p1", p2_id=None, p3_id=None, authorization="Bearer token",
    ))

    assert output["result_status"] == "sealed"
    assert output["results_sealed"] is True
    assert output["overall_band"] is None
    assert output["top_strengths"] == []
    assert output["pronunciation"] is None
    assert "responses" not in db.calls


def test_question_lookup_failure_is_visible_instead_of_empty_summary(monkeypatch):
    _patch(monkeypatch, fail_tables={"questions"})
    with pytest.raises(HTTPException) as caught:
        _run(sessions_module.get_full_test_summary(
            "p1", p2_id=None, p3_id=None, authorization="Bearer token",
        ))
    assert caught.value.status_code == 500


def test_part_two_requires_owned_immediately_preceding_session(monkeypatch):
    _patch(monkeypatch, sessions=[])
    body = sessions_module.CreateSessionBody(
        mode="test_full", part=2, topic="Topic 2",
        previous_session_id="p1",
    )
    with pytest.raises(HTTPException) as caught:
        sessions_module._resolve_full_test_attempt_id("user-1", body)
    assert caught.value.status_code == 400


def test_part_create_retry_returns_existing_session_after_lost_response(monkeypatch):
    rows = _sessions()[:2]
    rows[0]["status"] = "in_progress"
    rows[1]["status"] = "in_progress"
    db = _patch(monkeypatch, sessions=rows)
    monkeypatch.setattr(sessions_module, "_require_active", lambda _user_id: None)
    monkeypatch.setattr(sessions_module, "_require_permission", lambda _user_id, _mode: None)

    output = _run(sessions_module.create_session(
        sessions_module.CreateSessionBody(
            mode="test_full",
            part=2,
            topic="Topic 2",
            previous_session_id="p1",
        ),
        authorization="Bearer token",
    ))

    assert output["session_id"] == "p2"
    assert output["full_test_attempt_id"] == rows[0]["full_test_attempt_id"]
    assert db.calls == ["sessions", "sessions"]


def test_part_create_retry_rejects_conflicting_payload(monkeypatch):
    rows = _sessions()[:2]
    rows[0]["status"] = "in_progress"
    rows[1]["status"] = "in_progress"
    _patch(monkeypatch, sessions=rows)
    monkeypatch.setattr(sessions_module, "_require_active", lambda _user_id: None)
    monkeypatch.setattr(sessions_module, "_require_permission", lambda _user_id, _mode: None)

    with pytest.raises(HTTPException) as caught:
        _run(sessions_module.create_session(
            sessions_module.CreateSessionBody(
                mode="test_full",
                part=2,
                topic="Different topic",
                previous_session_id="p1",
            ),
            authorization="Bearer token",
        ))
    assert caught.value.status_code == 409


def test_summary_validator_allows_historical_mismatch_only_with_explicit_compatibility():
    rows = _sessions()
    rows[1]["full_test_attempt_id"] = "00000000-0000-4000-8000-000000000002"
    rows[2]["full_test_attempt_id"] = "00000000-0000-4000-8000-000000000003"
    sessions_module._validate_full_test_chain(
        ["p1", "p2", "p3"], rows, allow_legacy_attempt_mismatch=True,
    )
    with pytest.raises(HTTPException) as caught:
        sessions_module._validate_full_test_chain(["p1", "p2", "p3"], rows)
    assert caught.value.status_code == 400


def test_canonical_migration_200_is_server_owned_indexed_and_race_safe():
    sql = (Path(__file__).resolve().parents[1] / "migrations" / "200_speaking_full_test_attempt_identity.sql").read_text()
    assert "ADD COLUMN IF NOT EXISTS full_test_attempt_id UUID" in sql
    assert "CREATE TRIGGER trg_sessions_full_test_attempt_id" in sql
    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_full_test_attempt_part" in sql
    assert "CHECK (mode <> 'test_full' OR full_test_attempt_id IS NOT NULL)" in sql
    assert "DROP TABLE" not in sql and "DROP COLUMN" not in sql
