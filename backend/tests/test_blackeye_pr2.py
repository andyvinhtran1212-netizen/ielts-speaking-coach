"""PR2 synthetic HTTP contracts; no claim of atomic assignment completion."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from models.listening_blackeye import BlackEyeAssignmentCreate, BlackEyePlayer
from test_listening_blackeye import BASE, env, leak_free, paper, start, visible
from services import listening_blackeye as svc


def seed_assignment(e, *, cohort='synthetic-course2', creator='synthetic-creator'):
    receipt = dict(assignment_id='synthetic-assignment', request_id=str(uuid4()), cohort_id=cohort,
        activities=[deepcopy(e.p['metadata']['blackeye']['binding'])], recipient_ids=['synthetic-student'],
        due_at=(datetime.now(timezone.utc)+timedelta(days=1)).isoformat(),
        deadline_timezone='Asia/Ho_Chi_Minh', replay_policy='allowed', completion_denominator=1)
    assignment = dict(id=receipt['assignment_id'], cohort_id=cohort, assigned_by=creator, skill='listening',
        content_id=e.p['id'], status='published', due_at=receipt['due_at'],
        content_config={'programme_id':svc.PROGRAMME, 'blackeye':{'binding':receipt['activities'][0], 'receipt':receipt}})
    e.db.rows['class_assignments'].append(assignment)
    e.db.rows['class_assignment_items'].append(dict(id='synthetic-item', assignment_id=assignment['id'], student_id='synthetic-student'))
    e.actor.update(id=creator, admin=True)
    return assignment, receipt


def command(e):
    return dict(request_id=str(uuid4()), activities=[deepcopy(e.p['metadata']['blackeye']['binding'])],
        recipient_ids=['synthetic-student'], due_at='2030-01-01T19:00:00+07:00',
        deadline_timezone='Asia/Ho_Chi_Minh', replay_policy='allowed')


@pytest.mark.parametrize('policy', ['once', '', 'repeat', None, 0])
def test_q16_replay_policy_only_allowed(policy, env):
    value = command(env); value['replay_policy'] = policy
    with pytest.raises(ValidationError): BlackEyeAssignmentCreate.model_validate(value)
    env.actor['admin'] = True
    r = env.client.post('/admin/cohorts/synthetic-course2/listening-source-assignments', json=value)
    assert r.status_code == 422
    assert env.db.rpcs == []
    leak_free(env, r)


def test_q16_default_is_allowed_and_locked_activities_rejected(env):
    value = command(env); value.pop('replay_policy')
    assert BlackEyeAssignmentCreate.model_validate(value).replay_policy == 'allowed'
    for activity in ('U1-A08','U1-A14','U1-A19'):
        value['activities'][0]['activity_id'] = activity
        with pytest.raises(ValidationError): BlackEyeAssignmentCreate.model_validate(value)


@pytest.mark.parametrize('role,expected', [('creator',200),('global',403),('other_cohort',404),('student',403)])
@pytest.mark.parametrize('surface', ['catalog','receipt','progress'])
def test_fr027_reader_matrix(env, monkeypatch, role, expected, surface):
    from services import class_membership_service
    assignment, receipt = seed_assignment(env)
    monkeypatch.setattr(class_membership_service, 'active_students_for_cohort', lambda *a: [dict(id='synthetic-student',user_id='synthetic-user',is_active=True)])
    if role == 'global': env.actor.update(id='synthetic-global')
    elif role == 'other_cohort':
        env.db.rows['class_assignments'].append({**assignment, 'id':'other-assignment', 'cohort_id':'other-cohort', 'assigned_by':'synthetic-other'})
        env.actor.update(id='synthetic-other')
    elif role == 'student': env.actor.update(admin=False)
    path = '/admin/cohorts/synthetic-course2/' + ('listening-source-catalog' if surface == 'catalog' else
        'listening-source-assignments/synthetic-assignment' + ('/progress' if surface == 'progress' else ''))
    r = env.client.get(path)
    assert r.status_code == expected, r.text
    assert r.headers['cache-control'] == 'private, no-store'
    assert not any('marking_rows' in cols or table == 'mock_paper_attempt_snapshots' for table,cols,_ in env.db.calls)
    if expected == 200:
        body = r.json()
        if surface == 'catalog':
            assert set(body) == {'inventory','eligible_recipient_ids','lookup_errors'}
            assert body['inventory']['activities'][0]['binding'] == receipt['activities'][0]
            assert 'SYNTHETIC_REFERENCE' not in r.text
        elif surface == 'receipt': assert body == receipt
        else: leak_free(env, r)
    else: leak_free(env, r)


def test_catalog_recipient_error_is_visible_and_not_a_claim_of_empty_roster(env, monkeypatch):
    from services import class_membership_service
    seed_assignment(env)
    def fail(*args): raise RuntimeError('SYNTHETIC_PRIVATE_ROSTER')
    monkeypatch.setattr(class_membership_service, 'active_students_for_cohort', fail)
    r = env.client.get('/admin/cohorts/synthetic-course2/listening-source-catalog')
    assert r.status_code == 200
    assert r.json()['lookup_errors'] == ['recipient_lookup_failed']
    assert 'SYNTHETIC_PRIVATE_ROSTER' not in r.text


def test_progress_persisted_status_reload_expired_history_and_no_live_revision(env):
    assignment, _ = seed_assignment(env)
    path = '/admin/cohorts/synthetic-course2/listening-source-assignments/synthetic-assignment/progress'
    def status():
        r = env.client.get(path); assert r.status_code == 200, r.text
        leak_free(env,r); return r.json()['cells'][0]
    assert status()['status'] == 'not_started'
    a = env.db.freeze(env.p); a['class_assignment_item_id'] = 'synthetic-item'
    assert status()['status'] == 'in_progress'
    a['resume_expires_at'] = (datetime.now(timezone.utc)-timedelta(seconds=1)).isoformat()
    assert status()['status'] == 'expired' and a['status'] == 'in_progress'
    a.update(status='submitted', submitted_at=datetime.now(timezone.utc).isoformat(), result_summary={'blank_count':2})
    assert status()['status'] == 'submitted' and status()['blank_count'] == 2
    env.db.rows['listening_tests'] = [] # progress must read the assignment snapshot
    first = env.client.get(path)
    assert first.content == env.client.get(path).content
    assert b'answer_set_revision' not in first.content
    assert b'score' not in first.content and b'accuracy' not in first.content
    assignment['status'] = 'archived'
    assert status()['status'] == 'unavailable'


def test_progress_lookup_failure_is_not_zero(env):
    seed_assignment(env); del env.db.rows['class_assignment_items']
    r = env.client.get('/admin/cohorts/synthetic-course2/listening-source-assignments/synthetic-assignment/progress')
    assert r.status_code == 503
    assert 'cells' not in r.json()


@pytest.mark.parametrize('actor', ['other-learner','global-admin'])
def test_player_attempt_idor_before_snapshot_or_signing(env, actor):
    a = env.db.freeze(env.p); env.actor.update(id=actor, admin=actor == 'global-admin')
    r = env.client.get(f'{BASE}/tests/{env.p["id"]}?attempt_id={a["id"]}')
    assert r.status_code == 404
    assert not any(t == 'mock_paper_attempt_snapshots' for t,_,_ in env.db.calls)
    leak_free(env,r)


def test_positive_player_uses_frozen_cells_no_protected_fields(env):
    a = env.db.freeze(env.p)
    env.p['metadata']['blackeye']['items'][0]['prompt'] = 'LIVE_CHANGED'
    r = env.client.get(f'{BASE}/tests/{env.p["id"]}?attempt_id={a["id"]}')
    assert r.status_code == 200, r.text
    BlackEyePlayer.model_validate(r.json()); leak_free(env,r)
    assert 'LIVE_CHANGED' not in r.text
    assert not any('marking_rows' in cols for _,cols,_ in env.db.calls)
    assert set(r.json()['audio']) == {'url','granularity','expires_in'}


def test_player_signer_exception_is_sanitized_in_logs(env, caplog):
    a = env.db.freeze(env.p)
    env.db.rows['mock_paper_attempt_snapshots'][0]['paper_row']['full_audio_storage_path'] = 'synthetic/audio.mp3'
    sentinel = 'SYNTHETIC_PRIVATE_AUDIO ' + env.db.user
    def fail(*args): raise RuntimeError(sentinel)
    env.db.storage = SimpleNamespace(from_=lambda *a: SimpleNamespace(create_signed_url=fail))
    r = env.client.get(f'{BASE}/tests/{env.p["id"]}?attempt_id={a["id"]}')
    assert r.status_code == 503
    assert sentinel not in caplog.text and sentinel not in r.text


def test_create_never_partially_fans_out_while_ledger_decision_pending(env):
    seed_assignment(env)
    r = env.client.post('/admin/cohorts/synthetic-course2/listening-source-assignments', json=command(env))
    assert r.status_code == 503
    assert len(env.db.rows['class_assignments']) == 1
    assert env.db.rpcs == [] and not any(patch for _,_,patch in env.db.calls)
