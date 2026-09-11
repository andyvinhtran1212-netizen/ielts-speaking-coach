"""Explicit recovery-only server mode; no deployment or capture activation."""
import asyncio
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest

from routers import writing_student as writing
from services import core_admission as admission
from test_writing_admission import client, identity, result
from test_writing_baseline_entry import value


@pytest.mark.parametrize('ledger,recovery', [(False, False), (False, True), (True, False), (True, True)])
@pytest.mark.parametrize('name,params,recoverable', [
    ('fn_prepare_core_admission', {}, False), ('fn_prepare_writing_admission', {}, False),
    ('fn_get_core_admission', {}, True), ('fn_get_writing_admission', {}, True),
    ('fn_find_writing_admission', {}, True), ('fn_get_writing_entry', {}, True),
    ('fn_execute_writing_admission', {}, True), ('fn_reconcile_writing_admission', {}, True),
    ('fn_reconcile_core_admission', {}, True),
    ('fn_read_writing_admission_cohort', {}, True),
    ('fn_get_writing_cohort_report', {}, True),
    ('fn_finalize_writing_cohort_report', {}, True),
    ('fn_capture_writing_cohort_report', {}, False),
    ('fn_enter_writing_baseline', {'p_allow_start': False}, True),
    ('fn_enter_writing_baseline', {'p_allow_start': True}, False),
    ('fn_enter_writing_baseline', {}, False),
])
def test_transport_gate_matrix(monkeypatch, ledger, recovery, name, params, recoverable):
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_LEDGER_ENABLED', ledger)
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_RECOVERY_ENABLED', recovery)
    calls = []
    def respond(req): calls.append(req); return httpx.Response(200, json={'ok': True})
    original = httpx.AsyncClient
    monkeypatch.setattr(admission.httpx, 'AsyncClient', lambda **kw: original(**kw, transport=httpx.MockTransport(respond)))
    if ledger or (recovery and recoverable):
        assert asyncio.run(admission._rpc(name, params)) == {'ok': True}
        assert len(calls) == 1
    else:
        with pytest.raises(admission.AdmissionDisabled): asyncio.run(admission._rpc(name, params))
        assert calls == []


def test_recovery_flag_default_off_and_unknown_or_nonboolean_baseline_cannot_bypass(monkeypatch):
    assert type(admission.settings).model_fields['CORE_ADMISSION_RECOVERY_ENABLED'].default is False
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_LEDGER_ENABLED', False)
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_RECOVERY_ENABLED', True)
    with pytest.raises(admission.AdmissionDisabled): admission.require_admission_access('unlisted_rpc')
    for supplied in [None, 0, '', 'false', []]:
        with pytest.raises(admission.AdmissionDisabled):
            admission.require_admission_access('fn_enter_writing_baseline', {'p_allow_start': supplied})


@pytest.fixture
def recovery(client, monkeypatch):
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_LEDGER_ENABLED', False)
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_RECOVERY_ENABLED', True)
    return client


@pytest.mark.parametrize('action', ['read', 'lookup', 'execute', 'reconcile', 'entry', 'baseline_resume'])
def test_owned_writing_recovery_routes_remain_available(recovery, monkeypatch, identity, action):
    root = f"/api/writing/my-assignments/{identity['assignment']}"
    command_path = root + '/admissions/' + str(identity['command'])
    nonce = uuid4()
    actions = {
        'read': ('get_writing_admission', 'GET', command_path, None),
        'lookup': ('find_writing_admission', 'GET', root + '/admission-intents/' + str(nonce), None),
        'execute': ('execute_writing_admission', 'POST', command_path + '/execute', {'protocol': 'admission-v1', 'generation': 0}),
        'reconcile': ('reconcile_writing_admission', 'POST', command_path + '/reconcile', {'protocol': 'admission-v1'}),
        'entry': ('get_writing_entry', 'GET', root + '/entry', None),
        'baseline_resume': ('enter_writing_baseline', 'POST', root + '/baseline-entry', {'protocol': 'baseline-v1', 'launch_nonce': str(nonce)}),
    }
    name, method, url, body = actions[action]
    handler = AsyncMock(return_value=value(identity) if action in {'entry','baseline_resume'} else result(identity))
    monkeypatch.setattr(admission, name, handler)
    response = recovery.request(method, url, json=body)
    assert response.status_code == 200 and response.headers['cache-control'] == 'private, no-store'
    handler.assert_awaited_once()
    assert handler.call_args.args[:3] == (identity['user'], identity['student'], identity['assignment'])
    if action == 'baseline_resume': assert handler.call_args.args[-1] is False


@pytest.mark.parametrize('baseline_start', [False, True])
def test_recovery_only_refuses_new_preparation_and_new_baseline_clock(recovery, monkeypatch, identity, baseline_start):
    prepare, baseline = AsyncMock(), AsyncMock()
    monkeypatch.setattr(admission, 'prepare_writing_admission', prepare)
    monkeypatch.setattr(admission, 'enter_writing_baseline', baseline)
    root = f"/api/writing/my-assignments/{identity['assignment']}"
    body = {'protocol': 'baseline-v1' if baseline_start else 'admission-v1', 'launch_nonce': str(uuid4())}
    if baseline_start: body['allow_start'] = True
    response = recovery.post(root + ('/baseline-entry' if baseline_start else '/admissions'), json=body)
    assert response.status_code == 404 and response.headers['cache-control'] == 'private, no-store'
    prepare.assert_not_called(); baseline.assert_not_called()


def test_recovery_mode_does_not_bypass_entitlement(recovery, monkeypatch, identity):
    read = AsyncMock(); monkeypatch.setattr(admission, 'get_writing_admission', read)
    monkeypatch.setattr(writing, 'get_user_access_code_permissions', lambda user: [])
    monkeypatch.setattr(writing, 'student_has_writing_assignment', lambda student: False)
    response = recovery.get(f"/api/writing/my-assignments/{identity['assignment']}/admissions/{identity['command']}")
    assert response.status_code == 403
    read.assert_not_called()
