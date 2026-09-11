"""Current cohort classification, never historical receipt aggregation."""
import asyncio
from copy import deepcopy
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from services import core_admission, core_writing_cohort as cohort


def snapshot():
    epoch, resource, principal, student = map(str, [uuid4(), uuid4(), uuid4(), uuid4()])
    return {'epoch_id': epoch, 'closed_at': '2026-09-10T12:00:00Z', 'snapshot_at': '2026-09-10T13:00:00Z',
        'episode_count': 1, 'episodes': [{'episode_id': str(uuid4()), 'first_epoch_id': epoch,
            'resource_id': resource, 'scope_key': resource, 'principal_id': principal, 'source_owner_id': principal,
            'binding': {'canonical_id': resource, 'principal_id': principal, 'domain': 'writing_assignment'},
            'commands': {'accepted': 0, 'bound': 1, 'fenced': 0},
            'origin': {'student_id': student, 'first_activity': 'admitted', 'invalidated_at': None, 'deleted_at': None},
            'source': {'id': resource, 'student_id': student, 'status': 'in_progress', 'essay_id': None,
                'essay': None, 'started_at': '2026-09-10T11:59:00Z', 'renderer_affinity': 'next',
                'renderer_affinity_expires_at': '2026-09-11T11:59:00Z'}}]}


def report(raw):
    from uuid import UUID
    return cohort.summarize_writing_cohort(raw, UUID(raw['epoch_id']))


def assert_state(raw, state):
    result = report(raw)
    assert result['admitted_episode_count'] == 1 and result['states'][state] == 1
    assert sum(result['states'].values()) == 1 and sum(result['reasons'].values()) == 1
    assert result['coverage'] == 'unknown' and result['gate_f'] == 'not_assessed'
    assert raw['episodes'][0]['principal_id'] not in str(result)
    assert raw['episodes'][0]['resource_id'] not in str(result)
    return result


def graded(raw):
    source = raw['episodes'][0]['source']; essay = str(uuid4())
    source.update(status='graded', essay_id=essay, essay={'id': essay, 'student_id': source['student_id'],
        'status': 'graded', 'is_flagged': False, 'deleted_at': None, 'current_version': 2,
        'feedback': [{'version': 2, 'overall_band_score': 6.5}], 'jobs': []})
    return source['essay']


def test_pending_source_and_expired_lease_are_distinct_never_abandoned():
    raw = snapshot(); assert_state(raw, 'pending')
    raw['episodes'][0]['source']['renderer_affinity_expires_at'] = '2026-09-10T12:30:00Z'
    assert_state(raw, 'unresumable')


def test_current_feedback_wins_over_old_failed_regrade_but_stale_version_does_not():
    raw = snapshot(); essay = graded(raw)
    essay['jobs'] = [{'job_type': 'analyze', 'status': 'failed', 'created_at': '2026-09-10T12:00:00Z', 'completed_at': '2026-09-10T12:02:00Z'}]
    assert_state(raw, 'success')
    essay['feedback'][0]['version'] = 1
    assert_state(raw, 'unknown')


def test_failure_then_retry_then_current_regrade_change_report_not_membership():
    raw = snapshot(); essay = graded(raw); essay.update(status='failed', feedback=[])
    essay['jobs'] = [{'job_type': 'analyze', 'status': 'failed', 'created_at': '2026-09-10T12:00:00Z', 'completed_at': '2026-09-10T12:02:00Z'}]
    assert_state(raw, 'failed')
    essay['jobs'].append({'job_type': 'analyze', 'status': 'queued'})
    assert_state(raw, 'pending')
    essay.update(status='graded', feedback=[{'version': 2, 'overall_band_score': 7.0}])
    assert_state(raw, 'success')


@pytest.mark.parametrize('fenced', [False, True])
def test_unbound_episodes_remain_in_denominator(fenced):
    raw = snapshot(); row = raw['episodes'][0]
    row.update(binding=None, commands={'accepted': 0 if fenced else 1, 'bound': 0, 'fenced': 1 if fenced else 0})
    row['origin']['first_activity'] = None
    row['source'].update(status='pending', started_at=None)
    assert_state(raw, 'unstarted_expired' if fenced else 'unstarted')
    row['source']['started_at'] = '2026-09-10T12:00:00Z'
    assert_state(raw, 'unknown')


@pytest.mark.parametrize('damage', ['source', 'owner', 'provenance', 'binding', 'commands', 'deleted', 'flagged', 'jobs'])
def test_incomplete_or_reassigned_source_never_disappears_from_count(damage):
    raw = snapshot(); row = raw['episodes'][0]
    if damage == 'source': row['source'] = None
    if damage == 'owner': row['source_owner_id'] = str(uuid4())
    if damage == 'provenance': row['origin']['invalidated_at'] = '2026-09-10T12:00:00Z'
    if damage == 'binding': row['binding']['canonical_id'] = str(uuid4())
    if damage == 'commands': row['commands'] = {'accepted': 0, 'bound': 0, 'fenced': 0}
    if damage == 'deleted': graded(raw)['deleted_at'] = '2026-09-10T12:00:00Z'
    if damage == 'flagged': graded(raw)['is_flagged'] = True
    if damage == 'jobs': graded(raw).update(status='failed', jobs=[{}] * 1001)
    assert_state(raw, 'unknown')


@pytest.mark.parametrize('damage', ['truncated', 'duplicate', 'wrong_epoch', 'clock', 'naive_clock', 'too_large', 'bool_count'])
def test_invalid_cohort_fails_as_whole_not_a_partial_success(damage):
    raw = snapshot()
    if damage == 'truncated': raw['episode_count'] = 2
    if damage == 'duplicate': raw['episodes'] *= 2; raw['episode_count'] = 2
    if damage == 'wrong_epoch': raw['episodes'][0]['first_epoch_id'] = str(uuid4())
    if damage == 'clock': raw['snapshot_at'] = '2026-09-10T11:00:00Z'
    if damage == 'naive_clock': raw['snapshot_at'] = '2026-09-10T13:00:00'
    if damage == 'too_large': raw['episode_count'] = 1001
    if damage == 'bool_count': raw['episode_count'] = True
    with pytest.raises(core_admission.AdmissionUncertain): report(raw)


def test_empty_closed_cohort_is_not_pass_and_summary_does_not_mutate_input():
    raw = snapshot(); before = deepcopy(raw); report(raw); assert raw == before
    raw.update(episode_count=0, episodes=[])
    result = report(raw)
    assert sum(result['states'].values()) == 0 and result['gate_f'] == 'not_assessed'


def test_service_uses_one_bounded_rpc_without_observer_receipts(monkeypatch):
    from uuid import UUID
    raw = snapshot(); call = AsyncMock(return_value=raw)
    monkeypatch.setattr(core_admission, '_rpc', call)
    result = asyncio.run(cohort.read_writing_cohort(UUID(raw['epoch_id'])))
    assert result['states']['pending'] == 1
    call.assert_awaited_once_with('fn_read_writing_admission_cohort', {'p_epoch_id': raw['epoch_id']})


def test_large_old_job_history_does_not_hide_valid_current_feedback():
    raw = snapshot(); graded(raw)['jobs'] = [{}] * 1001
    assert_state(raw, 'success')
