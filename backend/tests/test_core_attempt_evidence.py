"""Evidence failures cannot change learner outcomes or become green receipts."""

import asyncio
import json
import time
from dataclasses import asdict, replace
from unittest.mock import Mock
from uuid import uuid4

import pytest
import httpx

from services import core_attempt_evidence as evidence

REAL_ASYNC_CLIENT = httpx.AsyncClient


def wire(monkeypatch, handler):
    monkeypatch.setattr(evidence.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", True)
    monkeypatch.setattr(evidence.settings, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(evidence.httpx, "AsyncClient", lambda **kwargs: REAL_ASYNC_CLIENT(
        transport=httpx.MockTransport(handler), **kwargs,
    ))


def send(event):
    return asyncio.run(evidence.try_record_event(**asdict(event)))


def started(**overrides):
    values = dict(
        event_id=uuid4(), operation_id=uuid4(), surface="reading_exam",
        canonical_attempt_id=uuid4(), operation="start", event_kind="started",
        start_observed=True,
    )
    return evidence.EvidenceEvent(**(values | overrides))


@pytest.mark.parametrize("surface", sorted(evidence.SURFACES))
def test_all_surfaces_keep_canonical_identity_and_unknown_attribution(surface):
    event = started(surface=surface, attempt_kind="speaking_session" if surface == "speaking" else "default")
    params = event.rpc_params()
    assert params["p_canonical_attempt_id"] == str(event.canonical_attempt_id)
    assert params["p_traffic_class"] == "unknown"
    assert params["p_renderer"] is None
    assert params["p_release_id"] is None
    assert "user_id" not in params and "answers" not in params


@pytest.mark.parametrize("change", [
    {"surface": "other"}, {"operation": "click"}, {"event_kind": "page_view"},
    {"renderer": "browser-says-next"}, {"traffic_class": "production"},
    {"release_id": "shortsha"}, {"outcome": "success"},
    {"error_code": "raw exception containing learner text"},
    {"canonical_attempt_id": None}, {"event_id": "not-a-uuid"},
    {"start_observed": 1}, {"operation": "submit"},
    {"event_kind": "operation_succeeded"},
])
def test_rejects_ambiguous_or_sensitive_payloads(change):
    with pytest.raises(ValueError):
        started(**change)


def test_operation_failure_is_not_a_failed_attempt():
    event = started(event_kind="operation_failed", start_observed=False,
                    operation="submit", error_code="timeout")
    assert event.outcome is None
    with pytest.raises(ValueError):
        replace(event, outcome="failed")


def test_pre_insert_failure_has_no_fabricated_attempt():
    event = started(event_kind="operation_failed", start_observed=False,
                    canonical_attempt_id=None, error_code="server_error")
    assert event.rpc_params()["p_canonical_attempt_id"] is None
    with pytest.raises(ValueError):
        replace(event, operation="save")


def test_speaking_canonical_namespace_is_explicit():
    with pytest.raises(ValueError):
        started(surface="speaking")
    with pytest.raises(ValueError):
        started(attempt_kind="speaking_full_test")
    for kind in ("speaking_session", "speaking_full_test"):
        assert started(surface="speaking", attempt_kind=kind).rpc_params()["p_attempt_kind"] == kind


def test_disabled_does_not_touch_database(monkeypatch):
    client = Mock()
    monkeypatch.setattr(evidence.httpx, "AsyncClient", client)
    monkeypatch.setattr(evidence.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", False)
    assert send(started()) is evidence.ReceiptStatus.DISABLED
    client.assert_not_called()


def test_exact_receipt_required_and_transport_retry_reuses_event(monkeypatch):
    event = started()
    payloads = []
    def handler(request):
        payloads.append(json.loads(request.content))
        if len(payloads) == 1:
            raise httpx.ReadTimeout("secret transcript")
        return httpx.Response(200, json=str(event.event_id))
    wire(monkeypatch, handler)
    assert send(event) is evidence.ReceiptStatus.UNAVAILABLE
    assert send(event) is evidence.ReceiptStatus.RECORDED
    assert payloads[0] == payloads[1]


@pytest.mark.parametrize("data", [None, [], {}, str(uuid4()), {"ok": True}])
def test_missing_or_wrong_receipt_is_not_success(monkeypatch, data, caplog):
    wire(monkeypatch, lambda request: httpx.Response(200, json=data))
    event = started()
    assert send(event) is evidence.ReceiptStatus.UNAVAILABLE
    assert str(event.canonical_attempt_id) not in caplog.text


def test_failure_logging_does_not_expose_payload_or_exception(monkeypatch, caplog):
    def handler(request):
        raise RuntimeError("credential-and-learner-sentinel")
    wire(monkeypatch, handler)
    event = started()
    send(event)
    assert "core_attempt_evidence_unavailable" in caplog.text
    assert "credential-and-learner-sentinel" not in caplog.text
    assert str(event.event_id) not in caplog.text


@pytest.mark.parametrize("status,code", [(400, "22023"), (400, "23514"), (404, "PGRST202"), (401, "secret"), (403, "secret")])
def test_permanent_server_rejection_is_invalid_not_transport(monkeypatch, caplog, status, code):
    wire(monkeypatch, lambda request: httpx.Response(status, json={"code": code, "message": "private-sentinel"}))
    assert send(started()) is evidence.ReceiptStatus.INVALID
    assert "private-sentinel" not in caplog.text


@pytest.mark.parametrize("status", [408, 429, 500, 503])
def test_transient_server_rejection_remains_unavailable(monkeypatch, status):
    wire(monkeypatch, lambda request: httpx.Response(status, text="private-sentinel"))
    assert send(started()) is evidence.ReceiptStatus.UNAVAILABLE


@pytest.mark.parametrize("change", [{"surface": "learner-secret"}, {"release_id": "wrong"},
                                     {"operation": []}, {"unexpected_key": "secret"}])
def test_public_boundary_never_raises_validation_into_learner_request(monkeypatch, caplog, change):
    wire(monkeypatch, lambda request: pytest.fail("invalid event must not call DB"))
    assert asyncio.run(evidence.try_record_event(**(asdict(started()) | change))) is evidence.ReceiptStatus.INVALID
    assert "learner-secret" not in caplog.text


def test_conflict_is_explicit_non_retryable_and_does_not_log_payload(monkeypatch, caplog):
    wire(monkeypatch, lambda request: httpx.Response(409, json={
        "code": "23505", "message": "evidence_event_conflict", "details": "private-sentinel",
    }))
    assert send(started()) is evidence.ReceiptStatus.CONFLICT
    assert "private-sentinel" not in caplog.text


def test_hanging_request_has_total_deadline_and_does_not_block_loop(monkeypatch):
    async def handler(request):
        await asyncio.sleep(5)
        pytest.fail("deadline must cancel this request")
    wire(monkeypatch, handler)
    monkeypatch.setattr(evidence, "RECEIPT_TIMEOUT_SECONDS", 0.03)
    started_at = time.monotonic()
    assert send(started()) is evidence.ReceiptStatus.UNAVAILABLE
    assert time.monotonic() - started_at < 0.5


def test_cancellation_propagates_without_fabricating_receipt(monkeypatch):
    async def handler(request):
        raise asyncio.CancelledError()
    wire(monkeypatch, handler)
    with pytest.raises(asyncio.CancelledError):
        send(started())
