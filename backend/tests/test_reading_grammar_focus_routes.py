"""Actual bounded wire/auth routes; transaction behavior has real-PG tests."""
import json
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers import admin_reading
from services.reading_grammar_focus import ReadingGrammarFocusError

ADMIN = '00000000-0000-0000-0000-000000000312'
PASSAGE = '00000000-0000-0000-0000-000000000313'
OPERATION = '00000000-0000-0000-0000-000000000314'
REVISION = 'a' * 64
PATH = '/admin/reading/content/passages/sample/grammar-focus'


@pytest.fixture
def route(monkeypatch):
    async def require_admin(authorization):
        if authorization == 'Bearer admin':
            return {'id': ADMIN, 'role': 'admin'}
        raise HTTPException(401 if authorization is None else 403, 'Permission denied')
    monkeypatch.setattr(admin_reading, 'require_admin', require_admin)
    monkeypatch.setattr(admin_reading, '_require_db_engine', lambda: 'existing-engine')
    app = FastAPI()
    app.include_router(admin_reading.router)
    return TestClient(app), app


def payload():
    return {'expected_revision': REVISION, 'operation_id': OPERATION,
            'grammar_focus': [{'point': 'One reviewed grammar point'}]}


def current():
    return {'passage_id': PASSAGE, 'slug': 'sample', 'library': 'l1_vocab',
            'title': 'Sample', 'status': 'published', 'body_markdown': 'Ostrom showed…',
            'grammar_focus': [{'point': 'One reviewed grammar point'}],
            'updated_at': '2026-09-30T08:00:00Z', 'revision': REVISION,
            'source_sha256': 'b' * 64, 'unrelated_metadata_sha256': 'c' * 64,
            'questions_sha256': 'd' * 64}


@pytest.mark.parametrize('method', ['get', 'patch'])
@pytest.mark.parametrize('token,status', [(None, 401), ('Bearer learner', 403)])
def test_denied_before_any_canonical_read_or_edit(route, monkeypatch, method, token, status):
    client, _ = route
    read, edit = AsyncMock(), AsyncMock()
    monkeypatch.setattr(admin_reading, 'read_focus', read)
    monkeypatch.setattr(admin_reading, 'edit_focus', edit)
    headers = {'Authorization': token} if token else {}
    response = getattr(client, method)(PATH, headers=headers,
                                       **({'json': payload()} if method == 'patch' else {}))
    assert response.status_code == status
    read.assert_not_awaited()
    edit.assert_not_awaited()


def test_concrete_read_does_not_synthesize_optional_focus_keys(route, monkeypatch):
    client, app = route
    read = AsyncMock(return_value=current())
    monkeypatch.setattr(admin_reading, 'read_focus', read)
    response = client.get(PATH, headers={'Authorization': 'Bearer admin'})
    assert response.status_code == 200
    assert response.json()['grammar_focus'] == [{'point': 'One reviewed grammar point'}]
    read.assert_awaited_once_with('existing-engine', 'sample')
    schema = app.openapi()
    methods = schema['paths'][PATH.replace('sample', '{slug}')]
    assert methods['get']['responses']['200']['content']['application/json']['schema']['$ref'].endswith('ReadingGrammarFocusRead')
    assert methods['patch']['requestBody']['content']['application/json']['schema']['$ref'].endswith('ReadingGrammarFocusEditRequest')


def test_edit_uses_authenticated_actor_and_preserves_committed_vs_current_wire(route, monkeypatch):
    client, _ = route
    state = current()
    result = {key: value for key, value in state.items()
              if key in ('passage_id', 'slug', 'library', 'updated_at', 'grammar_focus',
                         'source_sha256', 'unrelated_metadata_sha256', 'questions_sha256')}
    result.update(outcome='already_applied', operation_id=OPERATION,
                  committed_revision=REVISION, current_revision='e' * 64,
                  current_matches_committed=False, current_source_sha256='f' * 64,
                  current_unrelated_metadata_sha256='0' * 64, current_questions_sha256='1' * 64)
    edit = AsyncMock(return_value=result)
    monkeypatch.setattr(admin_reading, 'edit_focus', edit)
    response = client.patch(PATH, json=payload(), headers={'Authorization': 'Bearer admin'})
    assert response.status_code == 200
    args = edit.await_args.args
    assert args[:3] == ('existing-engine', 'sample', ADMIN)
    assert args[3].model_dump(mode='json') == payload()
    assert response.json()['source_sha256'] != response.json()['current_source_sha256']
    assert response.json()['current_matches_committed'] is False


def test_original_oversized_json_is_rejected_before_decode_or_write(route, monkeypatch):
    client, _ = route
    edit = AsyncMock()
    monkeypatch.setattr(admin_reading, 'edit_focus', edit)
    # Valid compact JSON would pass model size limits. Original padding must
    # still be rejected; a malformed oversized body must not reach decoding.
    for data in (json.dumps(payload()).encode() + b' ' * (256 * 1024), b'[' * (256 * 1024 + 1)):
        response = client.patch(PATH, content=data, headers={
            'Authorization': 'Bearer admin', 'Content-Type': 'application/json'})
        assert response.status_code == 422
        assert response.json()['detail'][0]['type'] == 'payload_too_large'
    edit.assert_not_awaited()


@pytest.mark.parametrize('status,code', [(404, 'reading_grammar_focus_not_found'),
                                        (409, 'reading_grammar_focus_revision_conflict'),
                                        (503, 'reading_grammar_focus_unavailable')])
def test_safe_domain_errors_have_concrete_wire(route, monkeypatch, status, code):
    client, _ = route
    monkeypatch.setattr(admin_reading, 'read_focus', AsyncMock(side_effect=
        ReadingGrammarFocusError(status, code, 'Safe explanation', REVISION if status == 409 else None)))
    response = client.get(PATH, headers={'Authorization': 'Bearer admin'})
    assert response.status_code == status
    assert response.json()['detail']['error_code'] == code
    assert ('current_revision' in response.json()['detail']) == (status == 409)


def test_missing_existing_engine_fails_through_safe_service_boundary(route, monkeypatch):
    client, _ = route
    def absent():
        raise HTTPException(500, 'Internal DATABASE_URL detail')
    monkeypatch.setattr(admin_reading, '_require_db_engine', absent)
    response = client.get(PATH, headers={'Authorization': 'Bearer admin'})
    assert response.status_code == 503
    assert response.json()['detail']['error_code'] == 'reading_grammar_focus_unavailable'
    assert 'DATABASE_URL' not in response.text
