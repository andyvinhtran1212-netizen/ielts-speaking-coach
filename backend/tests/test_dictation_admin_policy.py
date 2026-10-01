"""Persisted mixed-policy admin reads: no regrading or denominator pooling."""
from __future__ import annotations

import copy

import pytest
from fastapi.testclient import TestClient

import test_dictation_grading_routes as policy
import test_listening_test_dictation as fixtures
from main import app
from routers import listening as router

BASE = '/admin/listening/dictation-reports'


def completed_world(monkeypatch):
    db, auth, test = policy.world(monkeypatch)
    for version in (None, 'lexical-v2'):
        attempt = policy.start(test, auth, version)
        policy.answer(attempt, auth, version=version)
        fixtures._run(router.submit_listening_dictation_session(policy.submission(attempt), authorization=auth))
    return db, auth, test


def test_actual_http_admin_and_owner_reads_preserve_separate_frozen_policies(monkeypatch):
    db, auth, test = completed_world(monkeypatch)
    before = copy.deepcopy(db.tables)
    client = TestClient(app)
    headers = {'Authorization': auth}
    listed = client.get(BASE, headers=headers)
    assert listed.status_code == 200, listed.text
    assert {row['grading_version'] for row in listed.json()['items']} == {'legacy-whitespace-v1', 'lexical-v2'}
    aggregate = client.get(BASE + '/aggregate', headers=headers)
    assert aggregate.status_code == 200, aggregate.text
    body = aggregate.json()
    assert body['session_count'] == 2 and body['mean_accuracy'] == .8334
    assert body['mean_accuracy_basis'] == 'mean_of_session_sentence_scores'
    assert body['versions'] == [
        {'grading_version': 'legacy-whitespace-v1', 'session_count': 1, 'mean_accuracy': .6667},
        {'grading_version': 'lexical-v2', 'session_count': 1, 'mean_accuracy': 1.0}]
    for row in before['dictation_sessions']:
        detail = client.get(BASE + '/' + row['id'], headers=headers)
        own = client.get('/api/listening/tests/dictation/session/' + row['id'], headers=headers)
        assert detail.status_code == own.status_code == 200, (detail.text, own.text)
        for response in (detail.json(), own.json()):
            assert response['accuracy'] == row['accuracy']
            assert response['total_words'] == row['total_words']
            assert response['results'] == row['results']
            assert response['grading_version'] == row.get('grading_version', 'legacy-whitespace-v1')
            if row.get('grading_version') == 'lexical-v2':
                assert response['results'][0]['grading_evidence']['reference_segments'][0]['raw'] == '—'
                assert response['reference_sha256'] == row['reference_sha256']
    assert db.tables == before


@pytest.mark.parametrize('version,digest', [('lexical-v3', 'a' * 64), (False, None),
                                         ('', None), (None, 'a' * 64),
                                         ('lexical-v2', None), ('lexical-v2', 'bad')])
def test_list_and_aggregate_refuse_unknown_policy_instead_of_calling_it_legacy(monkeypatch, version, digest):
    db, auth, _ = completed_world(monkeypatch)
    row = db.tables['dictation_sessions'][0]
    row.update(grading_version=version, reference_sha256=digest)
    before = copy.deepcopy(db.tables)
    client = TestClient(app)
    for path in (BASE, BASE + '/aggregate', BASE + '/' + row['id']):
        response = client.get(path, headers={'Authorization': auth})
        assert response.status_code == 503, (path, response.text)
    assert db.tables == before


@pytest.mark.parametrize('accuracy', [None, True, -1, 2, 'nan', 'infinity', 'not-a-score'])
def test_aggregate_never_substitutes_zero_for_unavailable_or_corrupt_accuracy(monkeypatch, accuracy):
    db, auth, _ = completed_world(monkeypatch)
    db.tables['dictation_sessions'][0]['accuracy'] = accuracy
    before = copy.deepcopy(db.tables)
    response = TestClient(app).get(BASE + '/aggregate', headers={'Authorization': auth})
    assert response.status_code == 503, response.text
    assert db.tables == before


def test_v2_detail_refuses_corrupt_reference_proof_and_owner_route_keeps_authorization(monkeypatch):
    db, auth, _ = completed_world(monkeypatch)
    row = next(item for item in db.tables['dictation_sessions'] if item.get('grading_version') == 'lexical-v2')
    row['results'][0]['reference'] = 'Changed evidence.'
    before = copy.deepcopy(db.tables)
    client = TestClient(app)
    assert client.get(BASE + '/' + row['id'], headers={'Authorization': auth}).status_code == 503
    assert client.get('/api/listening/tests/dictation/session/' + row['id'], headers={'Authorization': auth}).status_code == 503
    async def other(_authorization):
        return {'id': 'another-owner'}
    monkeypatch.setattr(router, '_require_auth', other)
    assert client.get('/api/listening/tests/dictation/session/' + row['id'], headers={'Authorization': auth}).status_code == 403
    assert db.tables == before


def test_empty_version_breakdown_and_concrete_openapi_contracts(monkeypatch):
    db, auth, _ = policy.world(monkeypatch)
    response = TestClient(app).get(BASE + '/aggregate', headers={'Authorization': auth})
    assert response.status_code == 200 and response.json()['versions'] == []
    assert response.json()['session_count'] == 0
    schemas = app.openapi()['paths']
    for path, model in [(BASE, 'AdminDictationReportListResponse'),
                        (BASE + '/{session_id}', 'AdminDictationReportDetailResponse'),
                        (BASE + '/aggregate', 'DictationAggregateResponse'),
                        ('/api/listening/tests/dictation/session/{session_id}', 'DictationStoredSessionResponse')]:
        route = schemas[path]['get']
        assert route['responses']['200']['content']['application/json']['schema']['$ref'].endswith('/' + model)
        assert '503' in route['responses']
    assert not db.tables['dictation_sessions']
