"""Real router/wire contracts with scoped offline PostgREST fixtures."""
from __future__ import annotations

import copy
import hashlib
import json
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import test_listening_test_dictation as fixtures
from main import app
from routers import listening as router


def world(monkeypatch, *, enabled=True, text='— Hello there.'):
    db, auth = fixtures._patch(monkeypatch, user_id=str(uuid4()))
    test = fixtures._seed_test(db)
    fixtures._seed_section(db, test['id'], 1, text)
    monkeypatch.setattr(router.settings, 'DICTATION_LEXICAL_V2_ENABLED', enabled)
    return db, auth, test


def start(test, auth, version='lexical-v2'):
    return fixtures._run(router.start_dictation_attempt(test['id'], section_num=1,
        body=router.DictationAttemptStartRequest(grading_version=version, renderer_affinity_protocol='claim-v1'),
        authorization=auth))


def answer(attempt, auth, *, version='lexical-v2', digest=None, text='Hello there.'):
    return fixtures._run(router.grade_and_save_dictation_attempt_sentence(UUID(attempt['attempt_id']), 0,
        body=router.DictationAttemptAnswerRequest(user_transcript=text, grading_version=version,
            reference_sha256=digest if digest is not None else attempt.get('reference_sha256')),
        authorization=auth))


def submission(attempt, **changes):
    return router.DictationSessionRequest.model_validate({
        'attempt_id': attempt['attempt_id'], 'test_id': attempt['test_id'], 'section_num': 1,
        'client_request_id': str(uuid4()), 'grading_version': attempt['grading_version'],
        'reference_sha256': attempt.get('reference_sha256'),
        'sentences': [{'sentence_idx': 0, 'user_transcript': 'Hello there.'}], **changes})


def test_actual_start_grade_resume_complete_and_lost_ack_use_frozen_v2_after_rollback(monkeypatch):
    db, auth, test = world(monkeypatch)
    attempt = start(test, auth)
    assert attempt['grading_version'] == 'lexical-v2' and len(attempt['reference_sha256']) == 64
    assert attempt['units'][0]['text'] == '— Hello there.'
    # New starts off and edited canonical source must not affect existing work.
    monkeypatch.setattr(router.settings, 'DICTATION_LEXICAL_V2_ENABLED', False)
    db.tables['listening_content'][0]['transcript'] = 'Edited current source.'
    resumed = start(test, auth, None)
    assert resumed['created'] is False and resumed['reference_sha256'] == attempt['reference_sha256']
    graded = answer(attempt, auth)
    assert (graded['score'], graded['correct_words'], graded['total_words']) == (1, 2, 2)
    assert graded['grading_evidence']['reference'] == '— Hello there.'
    receipt = submission(attempt)
    report = fixtures._run(router.submit_listening_dictation_session(receipt, authorization=auth))
    frozen = copy.deepcopy(db.tables['dictation_sessions'])
    assert report['grading_version'] == 'lexical-v2' and report['accuracy'] == 1
    assert report['results'][0]['reference'] == '— Hello there.'
    retry = fixtures._run(router.submit_listening_dictation_session(receipt, authorization=auth))
    lookup = fixtures._run(router.get_listening_dictation_session_by_request(receipt.client_request_id, authorization=auth))
    assert retry == lookup == {**report, 'test_title': None}
    assert len(db.tables['dictation_sessions']) == 1 and db.tables['dictation_sessions'] == frozen


@pytest.mark.parametrize('version,digest', [(None, None), ('legacy-whitespace-v1', None),
                                         ('lexical-v2', 'a' * 64)])
def test_old_or_mismatched_consumer_cannot_write_active_v2_or_replay_v2_receipt(monkeypatch, version, digest):
    db, auth, test = world(monkeypatch)
    attempt = start(test, auth)
    body = router.DictationAttemptAnswerRequest(user_transcript='Hello there.', grading_version=version,
                                               reference_sha256=digest)
    before = copy.deepcopy(db.tables)
    with pytest.raises(HTTPException) as error:
        fixtures._run(router.grade_and_save_dictation_attempt_sentence(UUID(attempt['attempt_id']), 0,
            body=body, authorization=auth))
    assert error.value.status_code == 409 and db.tables == before
    answer(attempt, auth)
    receipt = submission(attempt)
    fixtures._run(router.submit_listening_dictation_session(receipt, authorization=auth))
    before = copy.deepcopy(db.tables)
    replay = receipt.model_copy(update={'grading_version': version, 'reference_sha256': digest})
    with pytest.raises(HTTPException) as error:
        fixtures._run(router.submit_listening_dictation_session(replay, authorization=auth))
    assert error.value.status_code == 409 and db.tables == before


@pytest.mark.parametrize('text', [' . — , ', "'cause we left'", '“unclosed'])
def test_new_invalid_or_ambiguous_source_does_not_retire_expired_parent(monkeypatch, text):
    db, auth, test = world(monkeypatch, text=text)
    old = start(test, auth, None)
    parent = db.tables['dictation_attempts'][0]
    parent['resume_expires_at'] = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    before = copy.deepcopy(db.tables)
    with pytest.raises(HTTPException) as error:
        start(test, auth)
    assert error.value.status_code == 422 and db.tables == before
    assert parent['id'] == old['attempt_id'] and parent['status'] == 'in_progress'


def test_default_legacy_remains_legacy_even_when_new_starts_are_enabled(monkeypatch):
    db, auth, test = world(monkeypatch)
    attempt = start(test, auth, None)
    persisted = db.tables['dictation_attempts'][0]
    assert 'grading_version' not in persisted and 'reference_sha256' not in persisted
    assert attempt['grading_version'] == 'legacy-whitespace-v1' and attempt['reference_sha256'] is None
    resumed = start(test, auth)
    assert resumed['grading_version'] == 'legacy-whitespace-v1' and resumed['created'] is False
    graded = answer(attempt, auth, version=None)
    assert (graded['score'], graded['total_words']) == (.6667, 3)
    assert 'grading_evidence' not in db.tables['dictation_attempt_answers'][0]


def test_disabled_new_policy_fails_before_any_attempt_mutation(monkeypatch):
    db, auth, test = world(monkeypatch, enabled=False)
    before = copy.deepcopy(db.tables)
    with pytest.raises(HTTPException) as error:
        start(test, auth)
    assert error.value.status_code == 503 and db.tables == before
    capabilities = fixtures._run(router.dictation_grading_capabilities(authorization=auth))
    assert capabilities['new_start_versions'] == ['legacy-whitespace-v1']
    assert capabilities['readable_versions'] == ['legacy-whitespace-v1', 'lexical-v2']


def test_existing_fingerprint_is_identical_with_missing_or_explicit_legacy_ack(monkeypatch):
    _, auth, test = world(monkeypatch)
    attempt = start(test, auth, None)
    old = submission(attempt, grading_version=None, reference_sha256=None)
    original_payload = old.model_dump(mode='json', exclude={'client_request_id', 'grading_version', 'reference_sha256'})
    digest = hashlib.sha256(json.dumps(original_payload, ensure_ascii=False, sort_keys=True,
                                       separators=(',', ':')).encode()).hexdigest()
    assert router._dictation_submission_fingerprint(old) == digest
    assert router._dictation_submission_fingerprint(old.model_copy(update={
        'grading_version': 'legacy-whitespace-v1'})) == digest
    assert router._dictation_submission_fingerprint(old.model_copy(update={
        'grading_version': 'lexical-v2', 'reference_sha256': 'a' * 64})) != digest


def test_n_minus_one_receipt_can_finish_and_retry_an_explicit_legacy_parent_with_a_frozen_hash(monkeypatch):
    db, auth, test = world(monkeypatch)
    attempt = start(test, auth, 'legacy-whitespace-v1')
    assert attempt['reference_sha256'] is not None
    old_answer = router.DictationAttemptAnswerRequest(user_transcript='Hello there.')
    graded = fixtures._run(router.grade_and_save_dictation_attempt_sentence(UUID(attempt['attempt_id']), 0,
        body=old_answer, authorization=auth))
    assert graded['grading_version'] == 'legacy-whitespace-v1' and graded['score'] == .6667
    old_receipt = submission(attempt, grading_version=None, reference_sha256=None)
    client = TestClient(app)
    headers = {'Authorization': auth}
    response = client.post('/api/listening/tests/dictation/session', headers=headers,
                           json=old_receipt.model_dump(mode='json'))
    assert response.status_code == 200, response.text
    stored = response.json()
    assert stored['grading_version'] == 'legacy-whitespace-v1'
    assert stored['reference_sha256'] == attempt['reference_sha256']
    before = copy.deepcopy(db.tables)
    replay = client.post('/api/listening/tests/dictation/session', headers=headers,
                         json=old_receipt.model_dump(mode='json'))
    recovered = client.get('/api/listening/tests/dictation/session/by-request/' + str(old_receipt.client_request_id), headers=headers)
    assert replay.status_code == recovered.status_code == 200
    assert replay.json()['session_id'] == recovered.json()['session_id'] == stored['session_id']
    assert db.tables == before
    explicit_ack = old_receipt.model_copy(update={'grading_version': 'legacy-whitespace-v1',
                                                'reference_sha256': attempt['reference_sha256']})
    assert router._dictation_submission_fingerprint(explicit_ack) == router._dictation_submission_fingerprint(old_receipt)


def test_actual_http_wire_exposes_strict_policy_and_unicode_evidence(monkeypatch):
    db, auth, test = world(monkeypatch)
    client = TestClient(app)
    url = f"/api/listening/tests/{test['id']}/dictation/attempts?section_num=1"
    before = copy.deepcopy(db.tables)
    unsupported = client.post(url, headers={'Authorization': auth}, json={'grading_version': 'lexical-v3'})
    assert unsupported.status_code == 422 and db.tables == before
    response = client.post(url, headers={'Authorization': auth}, json={'grading_version': 'lexical-v2',
                                                                       'renderer_affinity_protocol': 'claim-v1'})
    assert response.status_code == 200, response.text
    attempt = response.json()
    response = client.post(f"/api/listening/tests/dictation/attempts/{attempt['attempt_id']}/sentences/0",
        headers={'Authorization': auth}, json={'user_transcript': 'Hello there.', 'grading_version': 'lexical-v2',
                                               'reference_sha256': attempt['reference_sha256']})
    assert response.status_code == 200, response.text
    graded = response.json()
    assert graded['offset_unit'] == 'unicode_codepoint'
    assert graded['reference_segments'][0]['raw'] == '—'
    assert graded['grading_evidence']['diff'] == graded['diff']
    schema = app.openapi()
    route_schema = schema['paths'][f'/api/listening/tests/dictation/attempts/{{attempt_id}}/sentences/{{sentence_idx}}']['post']
    assert route_schema['responses']['200']['content']['application/json']['schema']['$ref'].endswith('/DictationSentenceGrade')
    assert route_schema['responses']['409']['content']['application/json']['schema']['$ref'].endswith('/DictationPolicyErrorResponse')
