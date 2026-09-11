"""Writing admission HTTP/auth/error contract and actual async transport models."""
import asyncio
import json
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers import writing_student as writing
from services import core_admission as admission


@pytest.fixture
def identity():
    return dict(user=uuid4(), student=uuid4(), assignment=uuid4(), command=uuid4())


def result(ids):
    return admission.WritingAdmissionResult.model_validate({
        "command": {"command_id": str(ids["command"]), "episode_id": str(uuid4()),
            "activity_epoch_id": str(uuid4()), "phase": "bound", "generation": 0,
            "execute_before": "2026-09-10T12:00:00+00:00"},
        "assignment": {"id": str(ids["assignment"]), "status": "in_progress",
            "is_timed": True, "time_limit_minutes": 40,
            "started_at": "2026-09-10T11:59:00+00:00", "auto_submitted": False}})


@pytest.fixture
def client(monkeypatch, identity):
    app = FastAPI()
    app.include_router(writing.router)
    app.dependency_overrides[writing.get_current_student] = lambda: {
        "id": str(identity["student"]), "user_id": str(identity["user"])}
    monkeypatch.setattr(admission.settings, "CORE_ADMISSION_LEDGER_ENABLED", True)
    with TestClient(app) as test_client:
        yield test_client


def url(ids):
    return f"/api/writing/my-assignments/{ids['assignment']}/admissions/{ids['command']}"


def prepare_url(ids):
    return f"/api/writing/my-assignments/{ids['assignment']}/admissions"


def test_preparation_uses_authenticated_identity_and_recovers_same_intent(client, monkeypatch, identity):
    value, nonce = result(identity), uuid4()
    prepare = AsyncMock(return_value=value)
    monkeypatch.setattr(admission, "prepare_writing_admission", prepare)
    body = {"protocol": "admission-v1", "launch_nonce": str(nonce)}
    for _ in range(2):
        response = client.post(prepare_url(identity), json=body)
        assert response.status_code == 200 and response.json()["command"]["command_id"] == str(identity["command"])
        assert response.headers["cache-control"] == "private, no-store"
    assert prepare.await_count == 2
    prepare.assert_awaited_with(identity["user"], identity["student"], identity["assignment"], nonce)


def test_execute_authenticated_identity_response_and_owned_status(client, monkeypatch, identity):
    value = result(identity)
    execute = AsyncMock(return_value=value)
    read = AsyncMock(return_value=value)
    monkeypatch.setattr(admission, "execute_writing_admission", execute)
    monkeypatch.setattr(admission, "get_writing_admission", read)
    response = client.post(url(identity) + "/execute", json={"protocol": "admission-v1", "generation": 0})
    assert response.status_code == 200 and response.json()["started"] is True
    assert response.json()["timer"]["started_at"] == "2026-09-10T11:59:00Z"
    assert response.json()["timer"]["status"] == "in_progress"
    assert response.headers["cache-control"] == "private, no-store"
    execute.assert_awaited_once_with(identity["user"], identity["student"], identity["assignment"], identity["command"], 0)
    response = client.get(url(identity))
    assert response.status_code == 200 and response.headers["cache-control"] == "private, no-store"
    read.assert_awaited_once_with(identity["user"], identity["student"], identity["assignment"], identity["command"])


def test_default_off_never_calls_executor_or_status(client, monkeypatch, identity):
    monkeypatch.setattr(admission.settings, "CORE_ADMISSION_LEDGER_ENABLED", False)
    execute, read, prepare = AsyncMock(), AsyncMock(), AsyncMock()
    monkeypatch.setattr(admission, "execute_writing_admission", execute)
    monkeypatch.setattr(admission, "get_writing_admission", read)
    monkeypatch.setattr(admission, "prepare_writing_admission", prepare)
    assert client.post(prepare_url(identity), json={"protocol": "admission-v1", "launch_nonce": str(uuid4())}).status_code == 404
    assert client.post(url(identity) + "/execute", json={"protocol": "admission-v1", "generation": 0}).status_code == 404
    assert client.get(url(identity)).status_code == 404
    execute.assert_not_called()
    read.assert_not_called()
    prepare.assert_not_called()


@pytest.mark.parametrize("body", [{"generation": 0}, {"protocol": "old", "generation": 0},
    {"protocol": "admission-v1", "generation": True}, {"protocol": "admission-v1", "generation": -1},
    {"protocol": "admission-v1", "generation": 0, "user_id": "someone-else"}])
def test_invalid_protocol_or_client_owner_fields_rejected(client, monkeypatch, identity, body):
    execute = AsyncMock()
    monkeypatch.setattr(admission, "execute_writing_admission", execute)
    assert client.post(url(identity) + "/execute", json=body).status_code == 422
    execute.assert_not_called()


@pytest.mark.parametrize("error,status", [(admission.AdmissionNotFound, 404),
    (admission.AdmissionExpired, 410), (admission.AdmissionBaselineConflict, 409),
    (admission.AdmissionConflict, 409), (admission.AdmissionInvalid, 422),
    (admission.AdmissionUncertain, 503), (admission.AdmissionEpochUnavailable, 503)])
def test_failures_are_sanitized_and_never_fall_back(client, monkeypatch, identity, error, status):
    execute = AsyncMock(side_effect=error("sensitive SQL/learner data"))
    legacy = AsyncMock(side_effect=AssertionError("legacy start must not run"))
    monkeypatch.setattr(admission, "execute_writing_admission", execute)
    monkeypatch.setattr(writing, "start_assignment", legacy)
    response = client.post(url(identity) + "/execute", json={"protocol": "admission-v1", "generation": 0})
    assert response.status_code == status and "sensitive" not in response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert execute.await_count == 1
    legacy.assert_not_called()


def test_missing_status_is_404(client, monkeypatch, identity):
    monkeypatch.setattr(admission, "get_writing_admission", AsyncMock(return_value=None))
    response = client.get(url(identity))
    assert response.status_code == 404 and response.headers["cache-control"] == "private, no-store"


def test_real_entitlement_dependency_blocks_before_execute(client, monkeypatch, identity):
    monkeypatch.setattr(writing, "get_user_access_code_permissions", lambda user: [])
    monkeypatch.setattr(writing, "student_has_writing_assignment", lambda student: False)
    execute = AsyncMock()
    monkeypatch.setattr(admission, "execute_writing_admission", execute)
    prepare = AsyncMock()
    monkeypatch.setattr(admission, "prepare_writing_admission", prepare)
    assert client.post(url(identity) + "/execute", json={"protocol": "admission-v1", "generation": 0}).status_code == 403
    assert client.post(prepare_url(identity), json={"protocol": "admission-v1", "launch_nonce": str(uuid4())}).status_code == 403
    execute.assert_not_called()
    prepare.assert_not_called()


def test_real_auth_chain_blocks_missing_token(monkeypatch, identity):
    app = FastAPI()
    app.include_router(writing.router)
    auth = AsyncMock(side_effect=HTTPException(401, "auth required"))
    execute = AsyncMock()
    prepare = AsyncMock()
    monkeypatch.setattr(writing, "get_supabase_user", auth)
    monkeypatch.setattr(admission, "execute_writing_admission", execute)
    monkeypatch.setattr(admission, "prepare_writing_admission", prepare)
    with TestClient(app) as client:
        assert client.post(url(identity) + "/execute", json={"protocol": "admission-v1", "generation": 0}).status_code == 401
        assert client.post(prepare_url(identity), json={"protocol": "admission-v1", "launch_nonce": str(uuid4())}).status_code == 401
    assert auth.await_count == 2
    auth.assert_awaited_with(None)
    execute.assert_not_called()
    prepare.assert_not_called()


@pytest.mark.parametrize("body", [
    {"protocol": "admission-v1"}, {"protocol": "old", "launch_nonce": str(uuid4())},
    {"protocol": "admission-v1", "launch_nonce": "not-a-uuid"},
    {"protocol": "admission-v1", "launch_nonce": str(uuid4()), "user_id": str(uuid4())},
    {"protocol": "admission-v1", "launch_nonce": str(uuid4()), "execute_before": "2099-01-01"},
])
def test_preparation_rejects_invalid_nonce_or_client_policy_fields(client, monkeypatch, identity, body):
    prepare = AsyncMock()
    monkeypatch.setattr(admission, "prepare_writing_admission", prepare)
    assert client.post(prepare_url(identity), json=body).status_code == 422
    prepare.assert_not_called()


@pytest.mark.parametrize("error,status", [(admission.AdmissionNotFound, 404),
    (admission.AdmissionBaselineConflict, 409), (admission.AdmissionConflict, 409),
    (admission.AdmissionUncertain, 503), (admission.AdmissionEpochUnavailable, 503)])
def test_preparation_failure_never_calls_executor_or_legacy(client, monkeypatch, identity, error, status):
    prepare = AsyncMock(side_effect=error("private SQL/learner content"))
    execute, legacy = AsyncMock(), AsyncMock()
    monkeypatch.setattr(admission, "prepare_writing_admission", prepare)
    monkeypatch.setattr(admission, "execute_writing_admission", execute)
    monkeypatch.setattr(writing, "start_assignment", legacy)
    response = client.post(prepare_url(identity), json={"protocol": "admission-v1", "launch_nonce": str(uuid4())})
    assert response.status_code == status and "private SQL" not in response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert prepare.await_count == 1
    execute.assert_not_called()
    legacy.assert_not_called()


@pytest.mark.parametrize("phase", ["accepted", "bound", "unstarted_expired", "wrong_assignment", "malformed"])
def test_prepare_transport_hashes_nonce_and_validates_ack(monkeypatch, identity, phase):
    raw, nonce, calls = result(identity).model_dump(mode="json"), uuid4(), []
    if phase == "wrong_assignment":
        raw["assignment"]["id"] = str(uuid4())
    elif phase == "malformed":
        raw = {}
    else:
        raw["command"]["phase"] = phase
        raw["command"]["generation"] = 1 if phase == "unstarted_expired" else 0
    def handler(req):
        calls.append(req)
        return httpx.Response(200, json=raw)
    original = httpx.AsyncClient
    monkeypatch.setattr(admission.settings, "CORE_ADMISSION_LEDGER_ENABLED", True)
    monkeypatch.setattr(admission.httpx, "AsyncClient", lambda **kw: original(**kw, transport=httpx.MockTransport(handler)))
    call = admission.prepare_writing_admission(identity["user"], identity["student"], identity["assignment"], nonce)
    if phase in {"wrong_assignment", "malformed"}:
        with pytest.raises(admission.AdmissionUncertain):
            asyncio.run(call)
    else:
        assert asyncio.run(call).command.phase == phase
    assert len(calls) == 1 and calls[0].url.path.endswith("/rpc/fn_prepare_writing_admission")
    params = json.loads(calls[0].content)
    assert set(params) == {"p_user_id", "p_student_id", "p_assignment_id", "p_nonce_digest"}
    assert len(params["p_nonce_digest"]) == 64 and str(nonce) not in calls[0].content.decode()


def test_prepare_transport_timeout_is_uncertain_and_does_not_retry(monkeypatch, identity):
    calls = []
    def handler(req):
        calls.append(req)
        raise httpx.ReadTimeout("private upstream detail")
    original = httpx.AsyncClient
    monkeypatch.setattr(admission.settings, "CORE_ADMISSION_LEDGER_ENABLED", True)
    monkeypatch.setattr(admission.httpx, "AsyncClient", lambda **kw: original(**kw, transport=httpx.MockTransport(handler)))
    with pytest.raises(admission.AdmissionUncertain) as error:
        asyncio.run(admission.prepare_writing_admission(identity["user"], identity["student"], identity["assignment"], uuid4()))
    assert len(calls) == 1 and "private upstream" not in str(error.value)


@pytest.mark.parametrize("change", ["valid", "wrong_assignment", "wrong_command", "not_bound", "missing_start"])
def test_executor_transport_validates_canonical_ack(monkeypatch, identity, change):
    raw = result(identity).model_dump(mode="json")
    if change == "wrong_assignment":
        raw["assignment"]["id"] = str(uuid4())
    elif change == "wrong_command":
        raw["command"]["command_id"] = str(uuid4())
    elif change == "not_bound":
        raw["command"]["phase"] = "accepted"
    elif change == "missing_start":
        raw["assignment"]["started_at"] = None
    calls = []
    def handler(req):
        calls.append(json.loads(req.content))
        return httpx.Response(200, json=raw)
    original = httpx.AsyncClient
    monkeypatch.setattr(admission.settings, "CORE_ADMISSION_LEDGER_ENABLED", True)
    monkeypatch.setattr(admission.httpx, "AsyncClient", lambda **kw: original(**kw, transport=httpx.MockTransport(handler)))
    call = admission.execute_writing_admission(identity["user"], identity["student"], identity["assignment"], identity["command"], 0)
    if change == "valid":
        assert asyncio.run(call).assignment.id == identity["assignment"]
    else:
        with pytest.raises(admission.AdmissionUncertain):
            asyncio.run(call)
    assert len(calls) == 1 and calls[0]["p_user_id"] == str(identity["user"])


@pytest.mark.parametrize('phase', ['accepted', 'bound', 'unstarted_expired'])
def test_owned_reconcile_uses_authenticated_identity_and_returns_canonical_status(client, monkeypatch, identity, phase):
    raw = result(identity).model_dump(mode='json')
    raw['command'].update(phase=phase, generation=1 if phase == 'unstarted_expired' else 0)
    value = admission.WritingAdmissionResult.model_validate(raw)
    reconcile = AsyncMock(return_value=value)
    monkeypatch.setattr(admission, 'reconcile_writing_admission', reconcile)
    response = client.post(url(identity) + '/reconcile', json={'protocol': 'admission-v1'})
    assert response.status_code == 200 and response.json()['command']['phase'] == phase
    assert response.headers['cache-control'] == 'private, no-store'
    reconcile.assert_awaited_once_with(identity['user'], identity['student'], identity['assignment'], identity['command'])


@pytest.mark.parametrize('body', [{}, {'protocol': 'wrong'},
    {'protocol': 'admission-v1', 'generation': 1}, {'protocol': 'admission-v1', 'limit': 100},
    {'protocol': 'admission-v1', 'user_id': str(uuid4())}, {'protocol': 'admission-v1', 'now': '2099-01-01'}])
def test_reconcile_rejects_client_clock_policy_and_identity(client, monkeypatch, identity, body):
    reconcile = AsyncMock()
    monkeypatch.setattr(admission, 'reconcile_writing_admission', reconcile)
    assert client.post(url(identity) + '/reconcile', json=body).status_code == 422
    reconcile.assert_not_called()


def test_reconcile_default_off_and_entitlement_are_checked_before_rpc(client, monkeypatch, identity):
    reconcile = AsyncMock()
    monkeypatch.setattr(admission, 'reconcile_writing_admission', reconcile)
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_LEDGER_ENABLED', False)
    assert client.post(url(identity) + '/reconcile', json={'protocol': 'admission-v1'}).status_code == 404
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_LEDGER_ENABLED', True)
    monkeypatch.setattr(writing, 'get_user_access_code_permissions', lambda user: [])
    monkeypatch.setattr(writing, 'student_has_writing_assignment', lambda student: False)
    assert client.post(url(identity) + '/reconcile', json={'protocol': 'admission-v1'}).status_code == 403
    reconcile.assert_not_called()


def test_reconcile_missing_auth_fails_closed(monkeypatch, identity):
    app = FastAPI()
    app.include_router(writing.router)
    auth = AsyncMock(side_effect=HTTPException(401, 'auth required'))
    reconcile = AsyncMock()
    monkeypatch.setattr(writing, 'get_supabase_user', auth)
    monkeypatch.setattr(admission, 'reconcile_writing_admission', reconcile)
    with TestClient(app) as client:
        assert client.post(url(identity) + '/reconcile', json={'protocol': 'admission-v1'}).status_code == 401
    auth.assert_awaited_once_with(None)
    reconcile.assert_not_called()


@pytest.mark.parametrize('error,status', [(admission.AdmissionNotFound, 404),
    (admission.AdmissionUncertain, 503), (admission.AdmissionConflict, 409)])
def test_reconcile_failure_never_starts_or_exposes_private_data(client, monkeypatch, identity, error, status):
    reconcile = AsyncMock(side_effect=error('private SQL and content'))
    execute, prepare, legacy = AsyncMock(), AsyncMock(), AsyncMock()
    monkeypatch.setattr(admission, 'reconcile_writing_admission', reconcile)
    monkeypatch.setattr(admission, 'execute_writing_admission', execute)
    monkeypatch.setattr(admission, 'prepare_writing_admission', prepare)
    monkeypatch.setattr(writing, 'start_assignment', legacy)
    response = client.post(url(identity) + '/reconcile', json={'protocol': 'admission-v1'})
    assert response.status_code == status and 'private SQL' not in response.text
    assert response.headers['cache-control'] == 'private, no-store'
    reconcile.assert_awaited_once()
    execute.assert_not_called(); prepare.assert_not_called(); legacy.assert_not_called()


@pytest.mark.parametrize('reply', ['accepted', 'bound', 'unstarted_expired', 'wrong_command', 'wrong_assignment', 'missing', 'timeout'])
def test_reconcile_transport_is_bounded_and_validates_reply(monkeypatch, identity, reply):
    raw, calls = result(identity).model_dump(mode='json'), []
    if reply in ['accepted', 'bound', 'unstarted_expired']:
        raw['command'].update(phase=reply, generation=1 if reply == 'unstarted_expired' else 0)
    if reply == 'wrong_command': raw['command']['command_id'] = str(uuid4())
    if reply == 'wrong_assignment': raw['assignment']['id'] = str(uuid4())
    if reply == 'missing': raw = None
    def handler(req):
        calls.append(req)
        if reply == 'timeout': raise httpx.ReadTimeout('private upstream')
        return httpx.Response(200, json=raw)
    original = httpx.AsyncClient
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_LEDGER_ENABLED', True)
    monkeypatch.setattr(admission.httpx, 'AsyncClient', lambda **kw: original(**kw, transport=httpx.MockTransport(handler)))
    call = admission.reconcile_writing_admission(identity['user'], identity['student'], identity['assignment'], identity['command'])
    if reply in ['accepted', 'bound', 'unstarted_expired']:
        assert asyncio.run(call).command.phase == reply
    else:
        with pytest.raises(admission.AdmissionUncertain): asyncio.run(call)
    assert len(calls) == 1 and calls[0].url.path.endswith('/rpc/fn_reconcile_writing_admission')
    assert json.loads(calls[0].content) == {'p_user_id': str(identity['user']), 'p_student_id': str(identity['student']),
        'p_assignment_id': str(identity['assignment']), 'p_command_id': str(identity['command'])}
