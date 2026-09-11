"""HTTP/transport contract for owned read-only Writing nonce recovery."""
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


def path(ids, nonce):
    return f"/api/writing/my-assignments/{ids['assignment']}/admission-intents/{nonce}"


@pytest.mark.parametrize('found', [False, True])
def test_owned_lookup_is_content_free_private_and_never_mutates(client, monkeypatch, identity, found):
    find = AsyncMock(return_value=result(identity) if found else None)
    prepare, execute = AsyncMock(), AsyncMock()
    monkeypatch.setattr(admission, 'find_writing_admission', find)
    monkeypatch.setattr(admission, 'prepare_writing_admission', prepare)
    monkeypatch.setattr(admission, 'execute_writing_admission', execute)
    nonce = uuid4(); response = client.get(path(identity, nonce))
    assert response.status_code == 200 and response.json()['found'] is found
    assert response.headers['cache-control'] == 'private, no-store'
    assert set(response.json()) == {'found', 'admission'}
    if found: assert response.json()['admission']['command']['command_id'] == str(identity['command'])
    else: assert response.json()['admission'] is None
    find.assert_awaited_once_with(identity['user'], identity['student'], identity['assignment'], nonce)
    prepare.assert_not_called(); execute.assert_not_called()


def test_default_off_invalid_nonce_and_entitlement_fail_closed(client, monkeypatch, identity):
    find = AsyncMock(); monkeypatch.setattr(admission, 'find_writing_admission', find)
    assert client.get(path(identity, 'invalid')).status_code == 422
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_LEDGER_ENABLED', False)
    assert client.get(path(identity, uuid4())).status_code == 404
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_LEDGER_ENABLED', True)
    monkeypatch.setattr(writing, 'get_user_access_code_permissions', lambda user: [])
    monkeypatch.setattr(writing, 'student_has_writing_assignment', lambda student: False)
    assert client.get(path(identity, uuid4())).status_code == 403
    find.assert_not_called()


def test_actual_auth_chain_guards_lookup(monkeypatch, identity):
    app = FastAPI(); app.include_router(writing.router)
    auth = AsyncMock(side_effect=HTTPException(401, 'required'))
    find = AsyncMock(); monkeypatch.setattr(writing, 'get_supabase_user', auth)
    monkeypatch.setattr(admission, 'find_writing_admission', find)
    with TestClient(app) as http: assert http.get(path(identity, uuid4())).status_code == 401
    auth.assert_awaited_once(); find.assert_not_called()


@pytest.mark.parametrize('error,status', [(admission.AdmissionNotFound, 404), (admission.AdmissionInvalid, 422), (admission.AdmissionUncertain, 503)])
def test_error_is_not_reported_as_absence(client, monkeypatch, identity, error, status):
    monkeypatch.setattr(admission, 'find_writing_admission', AsyncMock(side_effect=error('PRIVATE_DETAIL')))
    response = client.get(path(identity, uuid4()))
    assert response.status_code == status and 'found' not in response.json()
    assert 'PRIVATE_DETAIL' not in response.text and response.headers['cache-control'] == 'private, no-store'


@pytest.mark.parametrize('mode', ['bound', 'missing', 'wrong_assignment', 'malformed', 'network', 'http_error'])
def test_transport_hashes_nonce_and_distinguishes_unknown_from_failure(client, monkeypatch, identity, mode):
    raw = result(identity).model_dump(mode='json'); calls = []
    if mode == 'wrong_assignment': raw['assignment']['id'] = str(uuid4())
    if mode == 'malformed': raw = {'command': {}}
    if mode == 'missing': raw = None
    def respond(req):
        calls.append(req)
        if mode == 'network': raise httpx.ReadTimeout('PRIVATE_DETAIL', request=req)
        return httpx.Response(503 if mode == 'http_error' else 200, content=json.dumps(raw))
    original = httpx.AsyncClient
    monkeypatch.setattr(admission.httpx, 'AsyncClient', lambda **kw: original(**kw, transport=httpx.MockTransport(respond)))
    nonce = uuid4()
    call = admission.find_writing_admission(identity['user'], identity['student'], identity['assignment'], nonce)
    if mode == 'bound': assert asyncio.run(call).command.command_id == identity['command']
    elif mode == 'missing': assert asyncio.run(call) is None
    else:
        with pytest.raises(admission.AdmissionUncertain): asyncio.run(call)
    assert len(calls) == 1 and calls[0].url.path.endswith('/rpc/fn_find_writing_admission')
    assert json.loads(calls[0].content) == {'p_user_id': str(identity['user']), 'p_student_id': str(identity['student']),
        'p_assignment_id': str(identity['assignment']), 'p_nonce_digest': hashlib.sha256(('admission-v1:' + str(nonce)).encode()).hexdigest()}
