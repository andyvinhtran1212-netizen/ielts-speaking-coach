import asyncio
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
import pytest

from services import core_admission as admission


def request():
    return admission.PrepareAdmission(uuid4(), uuid4(), "writing_assignment", uuid4(),
        uuid4(), "start", datetime.now(timezone.utc) + timedelta(minutes=5))


def acknowledgment():
    return dict(command_id=str(uuid4()), episode_id=str(uuid4()), activity_epoch_id=str(uuid4()),
        phase="accepted", generation=0, execute_before="2026-09-10T12:00:00+00:00")


def transport(monkeypatch, handler):
    monkeypatch.setattr(admission.settings, "CORE_ADMISSION_LEDGER_ENABLED", True)
    client = httpx.AsyncClient
    monkeypatch.setattr(admission.httpx, "AsyncClient", lambda **kw: client(
        **kw, transport=httpx.MockTransport(handler)))


def test_default_off_performs_no_transport(monkeypatch):
    assert type(admission.settings).model_fields["CORE_ADMISSION_LEDGER_ENABLED"].default is False
    monkeypatch.setattr(admission.settings, "CORE_ADMISSION_LEDGER_ENABLED", False)
    def forbidden(**kw):
        pytest.fail("disabled admission must not create a client")
    monkeypatch.setattr(admission.httpx, "AsyncClient", forbidden)
    with pytest.raises(admission.AdmissionDisabled):
        asyncio.run(admission.prepare_admission(request()))


def test_nonce_and_semantic_fingerprints_are_stable_bounded_metadata():
    value = request()
    params = value.rpc_params()
    later = replace(value, execute_before=value.execute_before + timedelta(hours=1)).rpc_params()
    assert params["p_nonce_digest"] == later["p_nonce_digest"]
    assert params["p_semantic_digest"] == later["p_semantic_digest"]
    assert str(value.launch_nonce) not in str(params)
    assert len(params["p_nonce_digest"]) == len(params["p_semantic_digest"]) == 64
    for change in ({"resource_id": uuid4()}, {"scope_key": uuid4()}, {"action": "resume"}):
        assert replace(value, **change).rpc_params()["p_semantic_digest"] != params["p_semantic_digest"]
    with pytest.raises(admission.AdmissionInvalid):
        replace(value, principal_id=str(value.principal_id))
    with pytest.raises(admission.AdmissionInvalid):
        replace(value, execute_before=datetime(2026, 9, 10))


def test_prepare_uses_exact_rpc_and_validates_ack(monkeypatch):
    seen, ack = [], acknowledgment()
    def handler(req):
        seen.append(req)
        return httpx.Response(200, json=ack)
    transport(monkeypatch, handler)
    status = asyncio.run(admission.prepare_admission(request()))
    assert str(status.command_id) == ack["command_id"]
    assert len(seen) == 1 and seen[0].url.path.endswith("/rpc/fn_prepare_core_admission")


@pytest.mark.parametrize("raw", [None, [], {}, {**acknowledgment(), "generation": True},
    {**acknowledgment(), "phase": "success"}, {**acknowledgment(), "generation": 1},
    {**acknowledgment(), "execute_before": "2026-09-10T12:00:00"},
    {**acknowledgment(), "extra": "private"}])
def test_malformed_ack_is_uncertain_not_success(monkeypatch, raw):
    transport(monkeypatch, lambda req: httpx.Response(200, json=raw))
    with pytest.raises(admission.AdmissionUncertain):
        asyncio.run(admission.prepare_admission(request()))


@pytest.mark.parametrize("code,expected", [
    ("ZA001", admission.AdmissionInvalid), ("ZA002", admission.AdmissionConflict),
    ("ZA003", admission.AdmissionEpochUnavailable), ("23505", admission.AdmissionUncertain),
    ("ZA004", admission.AdmissionUncertain), (None, admission.AdmissionUncertain)])
def test_structured_errors_only_no_sensitive_details(monkeypatch, code, expected):
    calls = []
    def handler(req):
        calls.append(req)
        return httpx.Response(400, json={"code": code, "message": "private learner content", "details": "secret"})
    transport(monkeypatch, handler)
    with pytest.raises(expected) as error:
        asyncio.run(admission.prepare_admission(request()))
    assert "private" not in str(error.value) and "secret" not in str(error.value)
    assert len(calls) == 1  # Never silently retries or invokes legacy start.


def test_timeout_does_not_replay_or_fall_back(monkeypatch):
    seen = []
    def handler(req):
        seen.append(req)
        raise httpx.ReadTimeout("secret request details")
    transport(monkeypatch, handler)
    with pytest.raises(admission.AdmissionUncertain) as error:
        asyncio.run(admission.prepare_admission(request()))
    assert len(seen) == 1 and "secret" not in str(error.value)


def test_status_not_found_and_mismatched_command(monkeypatch):
    transport(monkeypatch, lambda req: httpx.Response(200, content=b"null"))
    assert asyncio.run(admission.get_admission(uuid4(), uuid4())) is None


def test_status_rejects_another_command(monkeypatch):
    transport(monkeypatch, lambda req: httpx.Response(200, json=acknowledgment()))
    with pytest.raises(admission.AdmissionUncertain):
        asyncio.run(admission.get_admission(uuid4(), uuid4()))


@pytest.mark.parametrize("raw", [
    {"fenced_commands": 1, "coverage": "unknown", "gate_f": "not_assessed"},
    {"fenced_commands": True, "coverage": "unknown", "gate_f": "not_assessed"},
    {"fenced_commands": 2, "coverage": "unknown", "gate_f": "not_assessed"},
    {"fenced_commands": 1, "coverage": "complete", "gate_f": "pass"},
])
def test_reconciler_bounded_unknown_contract(monkeypatch, raw):
    transport(monkeypatch, lambda req: httpx.Response(200, json=raw))
    if type(raw["fenced_commands"]) is int and raw["fenced_commands"] == 1 and raw["gate_f"] == "not_assessed":
        assert asyncio.run(admission.reconcile_admissions(1)).fenced_commands == 1
    else:
        with pytest.raises(admission.AdmissionUncertain):
            asyncio.run(admission.reconcile_admissions(1))
