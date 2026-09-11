"""Admin-only receipt report cannot certify eligibility or hide unavailable data."""
import asyncio
import copy
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from postgrest.exceptions import APIError
import httpx

from routers import admin_core_attempt_evidence as route
from services import core_attempt_aggregate as aggregate


def sample():
    end = datetime.now(timezone.utc) - timedelta(seconds=1)
    start = end - timedelta(days=1)
    counts = {field: 0 for field in aggregate.ObservationCounts.model_fields
              if field not in {"surface", "attempt_kind"}}
    payload = {"contract": "core-attempt-observations-v1", "window_start": start.isoformat(),
               "window_end": end.isoformat(), "snapshot_scope": "single_receipt_snapshot",
               "rows": [{**counts, "surface": surface, "attempt_kind": kind}
                        for surface, kind in sorted(aggregate.STREAMS)]}
    return start, end, payload


def wire(monkeypatch, payload=None, error=None):
    execute = AsyncMock(return_value=SimpleNamespace(data=payload), side_effect=error)
    rpc = Mock(return_value=SimpleNamespace(execute=execute))
    db = SimpleNamespace(rpc=rpc)
    monkeypatch.setattr(aggregate, "get_supabase_async", AsyncMock(return_value=db))
    return db


@pytest.mark.parametrize("capture", [False, True])
def test_empty_snapshot_is_available_but_never_certifies_zero_eligible_or_gate_pass(monkeypatch, capture):
    start, end, payload = sample()
    db = wire(monkeypatch, payload)
    monkeypatch.setattr(aggregate.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", capture)
    result = asyncio.run(aggregate.get_observation_aggregate(start, end))
    assert result.status == "available" and len(result.summary.rows) == 6
    assert result.capture_enabled_on_this_instance is capture
    assert result.eligible_attempt_denominator is None and result.coverage == "unknown"
    assert result.gate_f == result.eligibility == "not_assessed"
    assert "receipt_cohort_not_all_admissions" in result.missing_evidence
    assert ("capture_disabled_on_this_instance" in result.missing_evidence) is (not capture)
    assert "receipt_window_not_commit_watermarked" in result.missing_evidence
    db.rpc.assert_called_once_with("fn_core_attempt_observation_aggregate", {
        "p_window_start": start.isoformat(), "p_window_end": end.isoformat(),
    })


@pytest.mark.parametrize("broken", ["none", "array", "missing_stream", "duplicate_stream", "window", "window_end", "contract", "snapshot_scope", "extra", "negative", "boolean", "partition"])
def test_malformed_or_wrong_scope_snapshot_is_unavailable_not_zero(monkeypatch, broken):
    start, end, payload = sample()
    if broken == "none": payload = None
    if broken == "array": payload = []
    if broken == "missing_stream": payload["rows"].pop()
    if broken == "duplicate_stream": payload["rows"][-1] = payload["rows"][0]
    if broken == "window": payload["window_start"] = (start - timedelta(hours=1)).isoformat()
    if broken == "window_end": payload["window_end"] = (end + timedelta(seconds=1)).isoformat()
    if broken == "contract": payload["contract"] = "future-contract"
    if broken == "snapshot_scope": payload["snapshot_scope"] = "current-outcomes"
    if broken == "extra": payload["learner_content"] = "private content"
    if broken == "negative": payload["rows"][0]["receipts"] = -1
    if broken == "boolean": payload["rows"][0]["receipts"] = False
    if broken == "partition": payload["rows"][0]["organic_receipts"] = 1
    wire(monkeypatch, payload)
    result = asyncio.run(aggregate.get_observation_aggregate(start, end))
    assert result.status == "unavailable" and result.summary is None
    assert result.unavailable_reason == "contract_mismatch"
    assert result.requested_window_start == start and result.requested_window_end == end
    assert result.eligible_attempt_denominator is None
    assert "private content" not in result.model_dump_json()


def test_rpc_error_is_sanitized_and_cancellation_drains(monkeypatch, caplog):
    start, end, _ = sample()
    wire(monkeypatch, error=RuntimeError("private database details"))
    result = asyncio.run(aggregate.get_observation_aggregate(start, end))
    assert result.status == "unavailable" and result.summary is None
    assert "private database details" not in caplog.text

    async def check():
        entered, stopped = asyncio.Event(), asyncio.Event()
        async def pending_db():
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()
        monkeypatch.setattr(aggregate, "get_supabase_async", pending_db)
        task = asyncio.create_task(aggregate.get_observation_aggregate(start, end))
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert stopped.is_set()
        monkeypatch.setattr(aggregate, "READ_BUDGET_SECONDS", 0.01)
        stopped.clear()
        result = await aggregate.get_observation_aggregate(start, end)
        assert result.status == "unavailable" and stopped.is_set()
    asyncio.run(check())


@pytest.mark.parametrize("bad", ["naive_start", "naive_end", "overflow", "reversed", "empty", "too_long"])
def test_invalid_window_never_queries_database(monkeypatch, bad):
    start, end, _ = sample()
    if bad == "naive_start": start = start.replace(tzinfo=None)
    if bad == "naive_end": end = end.replace(tzinfo=None)
    if bad == "overflow": start = datetime.min.replace(tzinfo=timezone(timedelta(hours=1)))
    if bad == "reversed": start, end = end, start
    if bad == "empty": start = end
    if bad == "too_long": start = end - timedelta(days=31, microseconds=1)
    db = wire(monkeypatch)
    with pytest.raises(ValueError): asyncio.run(aggregate.get_observation_aggregate(start, end))
    db.rpc.assert_not_called()


def test_mixed_outcome_counts_overlap_intentionally_and_invalid_excess_is_rejected():
    _, _, payload = sample()
    row = copy.deepcopy(payload["rows"][0])
    row.update(canonical_attempts=1, start_unknown_at_registration=1, receipts=2,
               bound_attempt_operations=1, server_observation_operations=1,
               attempts_with_success=1, attempts_with_failed=1, mixed_outcome_attempts=1,
               renderer_unknown_receipts=2, traffic_unknown_receipts=2, release_unknown_receipts=2)
    assert aggregate.ObservationCounts.model_validate(row).canonical_attempts == 1
    row["mixed_outcome_attempts"] = 0
    with pytest.raises(ValidationError): aggregate.ObservationCounts.model_validate(row)


@pytest.mark.parametrize("allowed,unavailable", [(False, False), (True, False), (True, True)])
def test_http_admin_guard_no_store_and_unavailable_status(monkeypatch, allowed, unavailable):
    start, end, payload = sample()
    db = wire(monkeypatch, payload=None if unavailable else payload)
    auth = AsyncMock(return_value={"role": "admin"}, side_effect=None if allowed else HTTPException(403, "denied"))
    monkeypatch.setattr(route, "require_admin", auth)
    app = FastAPI()
    app.include_router(route.router)
    with TestClient(app) as client:
        response = client.get("/admin/core-attempt-evidence", params={
            "window_start": start.isoformat(), "window_end": end.isoformat(),
        }, headers={"Authorization": "Bearer synthetic"})
    auth.assert_awaited_once_with("Bearer synthetic")
    assert response.status_code == (403 if not allowed else 503 if unavailable else 200)
    if not allowed:
        db.rpc.assert_not_called()
        assert response.headers["cache-control"] == "no-store"
    else:
        assert response.headers["cache-control"] == "no-store"
        assert response.json()["eligible_attempt_denominator"] is None
        assert response.json()["gate_f"] == "not_assessed"


def test_main_app_mounts_aggregate_without_shadowing_inspector():
    from main import app
    document = app.openapi()
    paths = document["paths"]
    assert "/admin/core-attempt-evidence" in paths
    assert "/admin/core-attempt-evidence/{surface}/{canonical_attempt_id}" in paths
    responses = paths["/admin/core-attempt-evidence"]["get"]["responses"]
    for status in ("422", "503"):
        schemas = responses[status]["content"]["application/json"]["schema"]["anyOf"]
        assert {item["$ref"].rsplit("/", 1)[-1] for item in schemas} == {"ObservationReport", "ObservationHTTPError"}
    report_schema = document["components"]["schemas"]["ObservationReport"]
    assert "missing_evidence" in report_schema["required"]
    assert report_schema["properties"]["missing_evidence"]["readOnly"] is True


@pytest.mark.parametrize("error,status", [(HTTPException(500, "private DB connection"), 500),
                                         (HTTPException(401, "private token details"), 401),
                                         (HTTPException(403, "private role details"), 403),
                                         (RuntimeError("private credential"), 503)])
def test_admin_guard_internal_errors_are_sanitized_and_not_cached(monkeypatch, error, status):
    start, end, _ = sample()
    db = wire(monkeypatch)
    monkeypatch.setattr(route, "require_admin", AsyncMock(side_effect=error))
    app = FastAPI()
    app.include_router(route.router)
    with TestClient(app) as client:
        response = client.get("/admin/core-attempt-evidence", params={
            "window_start": start.isoformat(), "window_end": end.isoformat(),
        })
    assert response.status_code == status and response.headers["cache-control"] == "no-store"
    assert "private" not in response.text
    db.rpc.assert_not_called()


def test_api_rejects_naive_window_after_admin_auth_without_query(monkeypatch):
    start, end, _ = sample()
    db = wire(monkeypatch)
    auth = AsyncMock(return_value={"role": "admin"})
    monkeypatch.setattr(route, "require_admin", auth)
    app = FastAPI()
    app.include_router(route.router)
    with TestClient(app) as client:
        response = client.get("/admin/core-attempt-evidence", params={
            "window_start": start.replace(tzinfo=None).isoformat(), "window_end": end.isoformat(),
        })
    assert response.status_code == 422 and response.headers["cache-control"] == "no-store"
    auth.assert_awaited_once()
    db.rpc.assert_not_called()


def test_window_limit_measures_elapsed_utc_time_not_dst_wall_time():
    from zoneinfo import ZoneInfo
    zone = ZoneInfo("America/New_York")
    # Fall-back gives 31 calendar days an extra elapsed hour.
    start = datetime(2025, 10, 15, tzinfo=zone)
    end = datetime(2025, 11, 15, tzinfo=zone)
    with pytest.raises(ValueError): aggregate.validate_window(start, end)
    aggregate.validate_window(end - timedelta(days=30), end)


def test_mutually_inconsistent_outcome_counts_cannot_exceed_receipts():
    _, _, payload = sample()
    row = payload["rows"][0]
    row.update(canonical_attempts=1, start_unknown_at_registration=1, receipts=1,
               bound_attempt_operations=1, server_observation_operations=1,
               attempts_with_success=1, attempts_with_failed=1, mixed_outcome_attempts=1,
               renderer_unknown_receipts=1, traffic_unknown_receipts=1, release_unknown_receipts=1)
    with pytest.raises(ValidationError): aggregate.ObservationCounts.model_validate(row)


@pytest.mark.parametrize("code,reason", [
    ("42501", "permission_denied"), ("ZC003", "window_rejected"),
    ("PGRST202", "schema_unavailable"), ("42P01", "schema_unavailable"),
    ("42703", "schema_unavailable"), ("42883", "schema_unavailable"), ("57014", "query_cancelled"),
    ("ZC001", "window_too_large"), ("ZC002", "contract_mismatch"),
    ("54000", "unavailable"), ("22000", "unavailable"), ("22023", "unavailable"),
    ("private unknown code", "unavailable"),
])
def test_database_failures_have_allowlisted_reason_and_request_echo(monkeypatch, caplog, code, reason):
    start, end, _ = sample()
    wire(monkeypatch, error=APIError({"code": code, "message": "private message",
                                    "details": "private details", "hint": "private hint"}))
    result = asyncio.run(aggregate.get_observation_aggregate(start, end))
    assert result.unavailable_reason == reason and result.summary is None
    assert result.requested_window_start == start and result.requested_window_end == end
    assert "private" not in result.model_dump_json() + caplog.text
    assert f"core_attempt_aggregate_unavailable reason={reason}" in caplog.text


@pytest.mark.parametrize("error,reason", [(httpx.ConnectError("private host"), "transport_error"),
                                         (TimeoutError("private timeout"), "timeout")])
def test_transport_errors_are_classified_without_details(monkeypatch, error, reason):
    start, end, _ = sample()
    wire(monkeypatch, error=error)
    result = asyncio.run(aggregate.get_observation_aggregate(start, end))
    assert result.unavailable_reason == reason and "private" not in result.model_dump_json()


def test_default_cutoff_uses_database_time_even_if_database_clock_is_ahead(monkeypatch):
    start, _, payload = sample()
    db_end = datetime.now(timezone.utc) + timedelta(minutes=5)
    payload["window_end"] = db_end.isoformat()
    db = wire(monkeypatch, payload)
    monkeypatch.setattr(route, "require_admin", AsyncMock(return_value={"role": "admin"}))
    app = FastAPI()
    app.include_router(route.router)
    with TestClient(app) as client:
        response = client.get("/admin/core-attempt-evidence", params={"window_start": start.isoformat()})
    assert response.status_code == 200
    body = response.json()
    assert body["requested_window_end"] is None and body["unavailable_reason"] is None
    assert datetime.fromisoformat(body["summary"]["window_end"]) == db_end
    db.rpc.assert_called_once_with("fn_core_attempt_observation_aggregate", {
        "p_window_start": start.isoformat(), "p_window_end": None,
    })


@pytest.mark.parametrize("code,reason", [("ZC003", "window_rejected"), ("ZC001", "window_too_large")])
def test_database_window_rejection_returns_422_no_store_and_preserves_omitted_cutoff(monkeypatch, code, reason):
    start, _, _ = sample()
    wire(monkeypatch, error=APIError({"code": code, "message": "private details"}))
    monkeypatch.setattr(route, "require_admin", AsyncMock(return_value={"role": "admin"}))
    app = FastAPI()
    app.include_router(route.router)
    with TestClient(app) as client:
        response = client.get("/admin/core-attempt-evidence", params={"window_start": start.isoformat()})
    assert response.status_code == 422 and response.headers["cache-control"] == "no-store"
    assert response.json()["unavailable_reason"] == reason
    assert response.json()["requested_window_end"] is None


def test_missing_evidence_cannot_be_cleared_by_constructor(monkeypatch):
    start, end, payload = sample()
    wire(monkeypatch, payload)
    report = asyncio.run(aggregate.get_observation_aggregate(start, end))
    fields = {name: getattr(report, name) for name in aggregate.ObservationReport.model_fields}
    with pytest.raises(ValidationError):
        aggregate.ObservationReport(**fields, missing_evidence=())


@pytest.mark.parametrize("response_kind,reason", [("object", None), ("array", "contract_mismatch"),
                                                ("error", "permission_denied"), ("malformed_error", "unavailable")])
def test_installed_postgrest_rpc_client_parses_scalar_json_object(monkeypatch, response_kind, reason):
    from postgrest import AsyncPostgrestClient
    start, end, payload = sample()
    requests = []

    def handler(request):
        requests.append(request)
        assert request.method == "POST"
        assert request.url.path == "/rest/v1/rpc/fn_core_attempt_observation_aggregate"
        assert json.loads(request.content) == {"p_window_start": start.isoformat(), "p_window_end": None}
        if response_kind == "error":
            return httpx.Response(403, json={"code": "42501", "message": "private error", "details": "private details", "hint": None})
        if response_kind == "malformed_error":
            return httpx.Response(503, text="private proxy failure")
        return httpx.Response(200, json=[payload] if response_kind == "array" else payload)

    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = AsyncPostgrestClient("https://aggregate.invalid/rest/v1", http_client=http)
            monkeypatch.setattr(aggregate, "get_supabase_async", AsyncMock(return_value=client))
            return await aggregate.get_observation_aggregate(start, None)
    result = asyncio.run(check())
    assert len(requests) == 1 and result.unavailable_reason == reason
    if reason is None:
        assert result.summary.window_end == end and result.status == "available"
    else:
        assert result.summary is None and "private" not in result.model_dump_json()


def test_unexpected_context_exit_failure_discards_prepared_summary(monkeypatch):
    start, end, payload = sample()
    wire(monkeypatch, payload)

    class FailingExit:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): raise TimeoutError("private context failure")

    # Defense in depth, not proof of a real asyncio.timeout race: normal
    # __aexit__ does not suspend after the synchronous parsing branch.
    monkeypatch.setattr(aggregate.asyncio, "timeout", lambda _: FailingExit())
    report = asyncio.run(aggregate.get_observation_aggregate(start, end))
    assert report.status == "unavailable" and report.summary is None
    assert report.unavailable_reason == "timeout"


@pytest.mark.parametrize("path,params", [
    ("/admin/core-attempt-evidence", {"window_start": "private-invalid-input"}),
    ("/admin/core-attempt-evidence", {}),
    ("/admin/core-attempt-evidence/reading_exam/private-invalid-input", {}),
])
def test_framework_validation_is_private_and_not_cached_before_auth(monkeypatch, path, params):
    db = wire(monkeypatch)
    auth = AsyncMock()
    monkeypatch.setattr(route, "require_admin", auth)
    app = FastAPI()
    app.include_router(route.router)
    with TestClient(app) as client:
        response = client.get(path, params=params)
    assert response.status_code == 422 and response.headers["cache-control"] == "no-store"
    assert "private-invalid-input" not in response.text
    auth.assert_not_awaited()
    db.rpc.assert_not_called()
