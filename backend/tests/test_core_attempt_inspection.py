"""Private inspection reads metadata only and cannot certify missing evidence."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers import admin, admin_core_attempt_evidence as route
from services import core_attempt_inspection as inspection
from test_core_attempt_outcomes import speaking, writing, dictation


def summary():
    counts = {name: 0 for name in (
        "receipts", "started", "operation_succeeded", "operation_failed", "outcome_observed",
        "pending", "success", "failed", "abandoned", "unknown", "renderer_next", "renderer_legacy",
        "renderer_unknown", "traffic_organic", "traffic_synthetic", "traffic_unknown",
        "release_unknown", "distinct_known_releases",
    )}
    return counts | {"start_observed": False, "first_registered_at": "2026-09-10T00:00:00Z",
                     "first_receipt_at": None, "last_receipt_at": None}


class Query:
    def __init__(self, db, source):
        self.db, self.source = db, source
        self.columns, self.filters, self.bound = None, [], None

    def select(self, columns):
        self.columns = columns
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def limit(self, bound):
        self.bound = bound
        return self

    async def execute(self):
        self.db.calls.append(self)
        if self.source in self.db.errors:
            raise RuntimeError("private learner answer and token must not appear")
        value = self.db.history if self.source == "rpc" else self.db.rows
        return SimpleNamespace(data=value)


class DB:
    def __init__(self, rows, history=None, errors=()):
        self.rows, self.history, self.errors, self.calls = rows, history, errors, []
        self.rpc_args = None

    def table(self, table):
        return Query(self, table)

    def rpc(self, name, params):
        assert name == "fn_inspect_core_attempt_evidence_v2"
        self.rpc_args = params
        return Query(self, "rpc")


@pytest.fixture
def wire(monkeypatch):
    def setup(rows, history=None, errors=()):
        db = DB(rows, history, errors)
        monkeypatch.setattr(inspection, "get_supabase_async", AsyncMock(return_value=db))
        return db
    return setup


@pytest.mark.parametrize("factory,surface,table,kind", [
    (writing, "writing_assignment", "writing_assignments", "default"),
    (dictation, "listening_dictation", "dictation_attempts", "default"),
    (lambda: speaking(False), "speaking", "sessions", "speaking_session"),
    (lambda: speaking(True), "speaking", "sessions", "speaking_full_test"),
])
@pytest.mark.parametrize("enabled", [False, True])
def test_current_result_without_history_never_certifies_coverage(wire, monkeypatch, factory, surface, table, kind, enabled):
    values = factory()
    attempt, data = values[:2]
    db = wire(data if isinstance(data, list) else [data])
    monkeypatch.setattr(inspection.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", enabled)
    result = asyncio.run(inspection.inspect_attempt(surface, kind, attempt))
    assert result.history.status == "not_observed" and result.history.summary is None
    assert result.canonical.outcome == "success"
    assert result.coverage == "unknown" and result.gate_f == result.eligibility == "not_assessed"
    assert result.capture_enabled_on_this_instance == enabled
    assert result.read_started_at <= result.read_finished_at
    assert [q.source for q in db.calls] == ["rpc", table]
    column = "full_test_attempt_id" if kind == "speaking_full_test" else "id"
    assert db.calls[-1].filters == [(column, str(attempt))]
    assert db.calls[-1].bound == (4 if surface == "speaking" else 2)
    assert db.rpc_args == {"p_surface": surface, "p_attempt_kind": kind, "p_canonical_attempt_id": str(attempt)}
    serialized = result.model_dump_json()
    for forbidden in ("student_id", "user_id", "overall_band", "transcript", "answers", "feedback"):
        # A machine reason may mention feedback, but no source field/body escapes.
        assert f'"{forbidden}":' not in serialized


def test_failure_history_does_not_override_restored_writing_success(wire):
    attempt, row = writing()
    row["essay"]["jobs"] = [{"job_type": "analyze", "status": "failed"}]
    history = summary() | {"receipts": 2, "operation_failed": 1, "outcome_observed": 1, "failed": 1,
                           "renderer_unknown": 2, "traffic_unknown": 2, "release_unknown": 2,
                           "first_receipt_at": "2026-09-10T01:00:00Z", "last_receipt_at": "2026-09-10T02:00:00Z"}
    wire([row], history)
    result = asyncio.run(inspection.inspect_attempt("writing_assignment", "default", attempt))
    assert result.history.summary.failed == 1 and result.history.summary.start_observed is False
    assert result.canonical.outcome == "success"
    assert result.snapshot_scope == "history_and_canonical_separate"


@pytest.mark.parametrize("surface,table", [("reading_exam", "reading_test_attempts"), ("listening_test", "listening_test_attempts")])
@pytest.mark.parametrize("status,outcome,reason", [
    ("in_progress", "pending", "exam_not_submitted"),
    ("abandoned", "abandoned", "exam_abandoned"),
    ("submitted", "unknown", "exam_result_readback_not_verified"),
    ("invalid", "unknown", "exam_state_incomplete"),
])
def test_exam_status_is_not_a_score_or_current_answer_key_certificate(wire, surface, table, status, outcome, reason):
    attempt = uuid4()
    db = wire([{"id": str(attempt), "status": status, "renderer_affinity": "next"}])
    result = asyncio.run(inspection.inspect_attempt(surface, "default", attempt))
    assert result.canonical.outcome == outcome and result.canonical.reason == reason
    assert db.calls[-1].source == table
    assert db.calls[-1].columns == "id,status,renderer_affinity,core_evidence_result_check"


@pytest.mark.parametrize("active_jobs,flag", [
    (0, True), (1, False), (2, False), (None, False), (False, False), (-1, False), ("0", False),
])
def test_grading_without_active_job_is_inspection_flag_not_failed_attempt(wire, active_jobs, flag):
    attempt, row = writing()
    # The bounded embedded list can be empty or stale/truncated; only the SQL
    # computed count from the same snapshot supports this missing-job warning.
    row["essay"].update(status="grading", jobs=[], core_evidence_job_summary={"active_analyze": active_jobs, "total": 2})
    db = wire([row])
    result = asyncio.run(inspection.inspect_attempt("writing_assignment", "default", attempt))
    assert result.canonical.outcome == "pending"
    assert result.canonical.flags == (["writing_grading_without_active_job"] if flag else [])
    assert "core_evidence_job_summary" in db.calls[-1].columns


@pytest.mark.parametrize("total,active,outcome", [(1100, 0, "unknown"), (1100, 1, "pending"), (1, 0, "failed"), (None, None, "unknown")])
def test_terminal_failure_requires_untruncated_job_history(wire, total, active, outcome):
    attempt, row = writing()
    row["essay"].update(status="failed", core_evidence_job_summary={"total": total, "active_analyze": active},
                        jobs=[{"job_type": "analyze", "status": "failed", "created_at": "2026-09-10T01:00:00Z",
                               "completed_at": "2026-09-10T02:00:00Z"}])
    wire([row])
    result = asyncio.run(inspection.inspect_attempt("writing_assignment", "default", attempt))
    assert result.canonical.outcome == outcome


@pytest.mark.parametrize("errors,history_status,canonical_status", [
    (("rpc",), "unavailable", "read"),
    (("writing_assignments",), "observed", "unavailable"),
    (("rpc", "writing_assignments"), "unavailable", "unavailable"),
])
def test_independent_unavailable_reads_never_become_empty_success(wire, caplog, errors, history_status, canonical_status):
    attempt, row = writing()
    wire([row], summary(), errors)
    result = asyncio.run(inspection.inspect_attempt("writing_assignment", "default", attempt))
    assert result.history.status == history_status and result.canonical.status == canonical_status
    assert "private learner" not in result.model_dump_json() + caplog.text
    if history_status == "unavailable":
        assert result.history.summary is None
    if canonical_status == "unavailable":
        assert result.canonical.outcome == "unknown"


@pytest.mark.parametrize("invalid", [[], {}, summary() | {"receipts": 1}, summary() | {"receipts": True},
                                     summary() | {"release_unknown": -1}, summary() | {"secret": "private"},
                                     summary() | {"first_registered_at": "2026-09-10T00:00:00"}])
def test_malformed_rpc_response_is_unavailable(wire, invalid):
    attempt = uuid4()
    wire([], invalid)
    result = asyncio.run(inspection.inspect_attempt("reading_exam", "default", attempt))
    assert result.history.status == "unavailable" and result.history.summary is None
    assert result.canonical.status == "not_found" and result.canonical.outcome == "unknown"


@pytest.mark.parametrize("phase", ["history", "canonical"])
@pytest.mark.parametrize("cancel", [False, True])
def test_deadlines_and_external_cancellation(monkeypatch, phase, cancel):
    calls = 0
    async def getter():
        nonlocal calls
        calls += 1
        if (phase == "history" and calls == 1) or (phase == "canonical" and calls == 2):
            if cancel:
                raise asyncio.CancelledError()
            await asyncio.Event().wait()
        return DB([])
    monkeypatch.setattr(inspection, "get_supabase_async", getter)
    monkeypatch.setattr(inspection, "READ_BUDGET_SECONDS", 0.01)
    async def run():
        return await asyncio.wait_for(inspection.inspect_attempt("reading_exam", "default", uuid4()), 1)
    if cancel:
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(run())
    else:
        result = asyncio.run(run())
        assert getattr(result, phase).status == "unavailable"


@pytest.mark.parametrize("role", [None, "student", "instructor", "admin"])
def test_actual_admin_guard_precedes_reads(monkeypatch, wire, role):
    async def auth(_authorization):
        if role is None:
            raise HTTPException(401, "unauthorized")
        return {"id": "admin-fixture"}
    class Roles:
        def table(self, name): assert name == "users"; return self
        def select(self, columns): assert columns == "role"; return self
        def eq(self, column, value): assert (column, value) == ("id", "admin-fixture"); return self
        def limit(self, bound): assert bound == 1; return self
        def execute(self): return SimpleNamespace(data=[{"role": role}])
    monkeypatch.setattr(admin, "get_supabase_user", auth)
    monkeypatch.setattr(admin, "supabase_admin", Roles())
    db = wire([])
    app = FastAPI()
    app.include_router(route.router)
    with TestClient(app) as client:
        response = client.get(f"/admin/core-attempt-evidence/reading_exam/{uuid4()}")
    if role == "admin":
        assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
        assert response.json()["gate_f"] == "not_assessed"
        assert len(db.calls) == 2
    else:
        assert response.status_code == (401 if role is None else 403)
        assert db.calls == []


@pytest.mark.parametrize(
    "error,expected_status",
    [
        (HTTPException(500, "private database failure"), 500),
        (RuntimeError("private provider failure"), 503),
    ],
)
def test_admin_verification_failure_is_private_and_not_cacheable(monkeypatch, wire, error, expected_status):
    monkeypatch.setattr(route, "require_admin", AsyncMock(side_effect=error))
    db = wire([])
    app = FastAPI()
    app.include_router(route.router)
    with TestClient(app) as client:
        response = client.get(f"/admin/core-attempt-evidence/reading_exam/{uuid4()}")
    assert response.status_code == expected_status
    assert response.headers["cache-control"] == "no-store"
    assert "private" not in response.text
    assert db.calls == []


@pytest.mark.parametrize("surface,kind", [("speaking", "default"), ("reading_exam", "speaking_session"), ("writing_assignment", "speaking_full_test")])
def test_invalid_namespace_does_not_query(monkeypatch, wire, surface, kind):
    monkeypatch.setattr(route, "require_admin", AsyncMock())
    db = wire([])
    app = FastAPI()
    app.include_router(route.router)
    with TestClient(app) as client:
        result = client.get(f"/admin/core-attempt-evidence/{surface}/{uuid4()}?attempt_kind={kind}")
    assert result.status_code == 422 and db.calls == []


def test_route_is_mounted_in_real_app():
    from main import app
    assert "/admin/core-attempt-evidence/{surface}/{canonical_attempt_id}" in app.openapi()["paths"]


@pytest.mark.parametrize("surface", ["reading_exam", "listening_test"])
@pytest.mark.parametrize("check,state", [("verified", "success"), ("unverified", "unknown"), ("invalid", "unknown"), (None, "unknown")])
def test_exam_current_result_uses_private_proof_not_history_recency(wire, surface, check, state):
    attempt = uuid4()
    wire([{"id": str(attempt), "status": "submitted", "renderer_affinity": "next", "core_evidence_result_check": check}])
    result = asyncio.run(inspection.inspect_attempt(surface, "default", attempt))
    assert result.canonical.outcome == state
    if check == "invalid":
        assert result.canonical.reason == "exam_state_incomplete"
    assert result.history.status == "not_observed"
    assert result.coverage == "unknown" and result.gate_f == "not_assessed"
