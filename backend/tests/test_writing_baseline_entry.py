"""HTTP/auth/transport contracts for explicit baseline compatibility, all mocked."""
import asyncio
import hashlib
import json
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers import writing_student as writing
from services import core_admission as admission
from test_writing_admission import client, identity, result


def value(ids, kind='baseline_untracked', *, started=True):
    assignment = result(ids).assignment.model_dump(mode='json')
    if not started: assignment.update(started_at=None, status='pending')
    if kind == 'terminal': assignment['status'] = 'submitted'
    return admission.WritingEntryResult.model_validate({'kind': kind, 'assignment': assignment})


def path(ids, *, read=False):
    return f"/api/writing/my-assignments/{ids['assignment']}/{'entry' if read else 'baseline-entry'}"


@pytest.mark.parametrize('kind', ['eligible', 'admitted', 'baseline_untracked', 'baseline_unclaimed', 'terminal', 'blocked'])
def test_read_classification_is_owned_content_free_and_never_mutates(client, monkeypatch, identity, kind):
    get = AsyncMock(return_value=value(identity, kind, started=kind != 'eligible'))
    enter, prepare = AsyncMock(), AsyncMock()
    monkeypatch.setattr(admission, 'get_writing_entry', get)
    monkeypatch.setattr(admission, 'enter_writing_baseline', enter)
    monkeypatch.setattr(admission, 'prepare_writing_admission', prepare)
    response = client.get(path(identity, read=True))
    assert response.status_code == 200 and response.headers['cache-control'] == 'private, no-store'
    assert response.json()['kind'] == kind
    assert set(response.json()) == {'kind', 'assignment_id', 'started', 'timer'}
    get.assert_awaited_once_with(identity['user'], identity['student'], identity['assignment'])
    enter.assert_not_called(); prepare.assert_not_called()


def test_baseline_entry_passes_only_authenticated_identity_and_explicit_intent(client, monkeypatch, identity):
    enter = AsyncMock(return_value=value(identity))
    monkeypatch.setattr(admission, 'enter_writing_baseline', enter)
    nonce = uuid4()
    for allow in [False, True]:
        response = client.post(path(identity), json={'protocol': 'baseline-v1', 'launch_nonce': str(nonce), 'allow_start': allow})
        assert response.status_code == 200 and response.json()['kind'] == 'baseline_untracked'
        assert response.headers['cache-control'] == 'private, no-store'
        enter.assert_awaited_with(identity['user'], identity['student'], identity['assignment'], nonce, allow)


def test_baseline_default_body_is_resume_only(client, monkeypatch, identity):
    enter = AsyncMock(return_value=value(identity))
    monkeypatch.setattr(admission, 'enter_writing_baseline', enter)
    nonce = uuid4()
    assert client.post(path(identity), json={'protocol': 'baseline-v1', 'launch_nonce': str(nonce)}).status_code == 200
    enter.assert_awaited_once_with(identity['user'], identity['student'], identity['assignment'], nonce, False)


@pytest.mark.parametrize('body', [
    {'protocol': 'admission-v1', 'launch_nonce': str(uuid4())},
    {'protocol': 'baseline-v1'}, {'protocol': 'baseline-v1', 'launch_nonce': 'invalid'},
    {'protocol': 'baseline-v1', 'launch_nonce': str(uuid4()), 'allow_start': 'true'},
    {'protocol': 'baseline-v1', 'launch_nonce': str(uuid4()), 'allow_start': 1},
    {'protocol': 'baseline-v1', 'launch_nonce': str(uuid4()), 'user_id': str(uuid4())},
    {'protocol': 'baseline-v1', 'launch_nonce': str(uuid4()), 'kind': 'baseline_untracked'},
])
def test_browser_cannot_supply_classification_or_identity(client, monkeypatch, identity, body):
    enter = AsyncMock()
    monkeypatch.setattr(admission, 'enter_writing_baseline', enter)
    assert client.post(path(identity), json=body).status_code == 422
    enter.assert_not_called()


def test_default_off_and_missing_entitlement_block_both_endpoints(client, monkeypatch, identity):
    get, enter = AsyncMock(), AsyncMock()
    monkeypatch.setattr(admission, 'get_writing_entry', get)
    monkeypatch.setattr(admission, 'enter_writing_baseline', enter)
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_LEDGER_ENABLED', False)
    body = {'protocol': 'baseline-v1', 'launch_nonce': str(uuid4()), 'allow_start': True}
    assert client.get(path(identity, read=True)).status_code == 404
    assert client.post(path(identity), json=body).status_code == 404
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_LEDGER_ENABLED', True)
    monkeypatch.setattr(writing, 'get_user_access_code_permissions', lambda user: [])
    monkeypatch.setattr(writing, 'student_has_writing_assignment', lambda student: False)
    assert client.get(path(identity, read=True)).status_code == 403
    assert client.post(path(identity), json=body).status_code == 403
    get.assert_not_called(); enter.assert_not_called()


def test_real_auth_chain_blocks_read_and_write(monkeypatch, identity):
    app = FastAPI(); app.include_router(writing.router)
    auth = AsyncMock(side_effect=HTTPException(401, 'required'))
    get, enter = AsyncMock(), AsyncMock()
    monkeypatch.setattr(writing, 'get_supabase_user', auth)
    monkeypatch.setattr(admission, 'get_writing_entry', get)
    monkeypatch.setattr(admission, 'enter_writing_baseline', enter)
    with TestClient(app) as http:
        assert http.get(path(identity, read=True)).status_code == 401
        assert http.post(path(identity), json={'protocol': 'baseline-v1', 'launch_nonce': str(uuid4())}).status_code == 401
    assert auth.await_count == 2
    get.assert_not_called(); enter.assert_not_called()


@pytest.mark.parametrize('error,status', [(admission.AdmissionStartRequired, 409),
    (admission.AdmissionConflict, 409), (admission.AdmissionBaselineConflict, 409),
    (admission.AdmissionNotFound, 404), (admission.AdmissionExpired, 410), (admission.AdmissionUncertain, 503)])
def test_rejection_is_sanitized_without_legacy_start_or_adoption(client, monkeypatch, identity, error, status):
    enter = AsyncMock(side_effect=error('private database detail'))
    legacy, prepare = AsyncMock(), AsyncMock()
    monkeypatch.setattr(admission, 'enter_writing_baseline', enter)
    monkeypatch.setattr(admission, 'prepare_writing_admission', prepare)
    monkeypatch.setattr(writing, 'start_assignment', legacy)
    response = client.post(path(identity), json={'protocol': 'baseline-v1', 'launch_nonce': str(uuid4())})
    assert response.status_code == status and 'private database' not in response.text
    assert response.headers['cache-control'] == 'private, no-store'
    legacy.assert_not_called(); prepare.assert_not_called()


@pytest.mark.parametrize('raw_kind', ['baseline_untracked', 'baseline_unclaimed', 'terminal', 'eligible', 'wrong_id', 'missing_start', 'malformed', 'timeout'])
def test_enter_transport_hashes_guard_nonce_and_rejects_unconfirmed_results(monkeypatch, identity, raw_kind):
    raw = value(identity).model_dump(mode='json')
    if raw_kind == 'terminal': raw = value(identity, 'terminal').model_dump(mode='json')
    if raw_kind == 'baseline_unclaimed': raw['kind'] = raw_kind
    if raw_kind == 'eligible': raw = value(identity, 'eligible', started=False).model_dump(mode='json')
    if raw_kind == 'wrong_id': raw['assignment']['id'] = str(uuid4())
    if raw_kind == 'missing_start': raw = value(identity, started=False).model_dump(mode='json')
    if raw_kind == 'malformed': raw = {}
    calls = []
    def handler(req):
        calls.append(req)
        if raw_kind == 'timeout': raise httpx.ReadTimeout('private timeout')
        return httpx.Response(200, json=raw)
    original = httpx.AsyncClient
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_LEDGER_ENABLED', True)
    monkeypatch.setattr(admission.httpx, 'AsyncClient', lambda **kw: original(**kw, transport=httpx.MockTransport(handler)))
    nonce = uuid4()
    call = admission.enter_writing_baseline(identity['user'], identity['student'], identity['assignment'], nonce, True)
    if raw_kind in ['baseline_untracked', 'baseline_unclaimed', 'terminal']:
        assert asyncio.run(call).kind == raw_kind
    else:
        with pytest.raises(admission.AdmissionUncertain): asyncio.run(call)
    assert len(calls) == 1 and calls[0].url.path.endswith('/rpc/fn_enter_writing_baseline')
    assert json.loads(calls[0].content) == {'p_user_id': str(identity['user']), 'p_student_id': str(identity['student']),
        'p_assignment_id': str(identity['assignment']), 'p_nonce_digest': hashlib.sha256(('admission-v1:' + str(nonce)).encode()).hexdigest(),
        'p_allow_start': True}


def test_missing_entry_is_none_at_service_and_404_at_http(client, monkeypatch, identity):
    original = httpx.AsyncClient
    monkeypatch.setattr(admission.httpx, 'AsyncClient', lambda **kw: original(**kw,
        transport=httpx.MockTransport(lambda req: httpx.Response(200, content=b'null'))))
    assert asyncio.run(admission.get_writing_entry(identity['user'], identity['student'], identity['assignment'])) is None
    assert client.get(path(identity, read=True)).status_code == 404


def test_explicit_start_required_sql_code_is_not_misreported_as_uncertain(monkeypatch, identity):
    original = httpx.AsyncClient
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_LEDGER_ENABLED', True)
    monkeypatch.setattr(admission.httpx, 'AsyncClient', lambda **kw: original(**kw,
        transport=httpx.MockTransport(lambda req: httpx.Response(400, json={'code': 'ZA008', 'message': 'private'}))))
    with pytest.raises(admission.AdmissionStartRequired):
        asyncio.run(admission.enter_writing_baseline(identity['user'], identity['student'], identity['assignment'], uuid4(), False))
