"""Durable report workflow and lost acknowledgments, mocked transport only."""
import asyncio
from copy import deepcopy
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from services import core_admission, core_writing_reports as reports
from services.core_writing_cohort import summarize_writing_cohort
from test_core_writing_cohort import snapshot


def artifact():
    source = snapshot()
    return {'id': str(uuid4()), 'epoch_id': source['epoch_id'], 'classifier_profile': reports.PROFILE,
        'policy_digest': 'a'*64, 'snapshot_digest': 'b'*64, 'source_snapshot': source,
        'summary': None, 'summary_digest': None, 'created_at': '2026-09-10T13:00:00+00:00',
        'updated_at': '2026-09-10T13:00:00+00:00', 'finalized_at': None}


def complete(raw):
    final = deepcopy(raw)
    final.update(summary=summarize_writing_cohort(raw['source_snapshot'], UUID(raw['epoch_id'])),
        summary_digest='c'*64, finalized_at='2026-09-10T13:01:00+00:00', updated_at='2026-09-10T13:01:00+00:00')
    return final


def run(raw):
    return asyncio.run(reports.create_or_resume_writing_report(UUID(raw['id']), UUID(raw['epoch_id'])))


def test_capture_then_finalize_same_snapshot_without_source_in_output(monkeypatch):
    raw = artifact(); final = complete(raw)
    rpc = AsyncMock(side_effect=[None, raw, final]); monkeypatch.setattr(core_admission, '_rpc', rpc)
    result = run(raw)
    assert result['summary']['states']['pending'] == 1 and 'source_snapshot' not in result
    assert raw['source_snapshot']['episodes'][0]['principal_id'] not in str(result)
    assert [c.args[0] for c in rpc.await_args_list] == ['fn_get_writing_cohort_report','fn_capture_writing_cohort_report','fn_finalize_writing_cohort_report']
    assert rpc.await_args_list[-1].args[1] == {'p_report_id': raw['id'], 'p_snapshot_digest': raw['snapshot_digest'], 'p_summary': final['summary']}


def test_lost_capture_ack_resumes_stored_snapshot_without_recapture(monkeypatch):
    raw = artifact(); rpc = AsyncMock(side_effect=[None, core_admission.AdmissionUncertain('lost'), raw, complete(raw)])
    monkeypatch.setattr(core_admission, '_rpc', rpc)
    with pytest.raises(core_admission.AdmissionUncertain): run(raw)
    assert run(raw)['summary'] is not None
    assert [c.args[0] for c in rpc.await_args_list].count('fn_capture_writing_cohort_report') == 1


def test_lost_finalize_ack_returns_stored_report_without_reclassification_write(monkeypatch):
    raw = artifact(); final = complete(raw)
    rpc = AsyncMock(side_effect=[raw, core_admission.AdmissionUncertain('lost'), final])
    monkeypatch.setattr(core_admission, '_rpc', rpc)
    with pytest.raises(core_admission.AdmissionUncertain): run(raw)
    result = run(raw)
    assert result['summary'] == final['summary']
    assert [c.args[0] for c in rpc.await_args_list] == ['fn_get_writing_cohort_report','fn_finalize_writing_cohort_report','fn_get_writing_cohort_report']


def test_unknown_read_does_not_capture_new_report(monkeypatch):
    raw = artifact(); rpc = AsyncMock(side_effect=core_admission.AdmissionUncertain('unavailable'))
    monkeypatch.setattr(core_admission, '_rpc', rpc)
    with pytest.raises(core_admission.AdmissionUncertain): run(raw)
    assert rpc.await_count == 1


@pytest.mark.parametrize('damage', ['identity','epoch','digest','profile','snapshot','count','not_finalized'])
def test_corrupt_or_mismatched_ack_cannot_be_reported_complete(monkeypatch, damage):
    raw = artifact(); damaged = complete(raw)
    if damage == 'identity': damaged['id'] = str(uuid4())
    if damage == 'epoch': damaged['epoch_id'] = str(uuid4())
    if damage == 'digest': damaged['snapshot_digest'] = 'bad'
    if damage == 'profile': damaged['classifier_profile'] = 'unknown'
    if damage == 'snapshot': damaged['source_snapshot']['episode_count'] = 2
    if damage == 'count': damaged['summary']['states']['success'] = 5
    if damage == 'not_finalized': damaged['finalized_at'] = None
    monkeypatch.setattr(core_admission, '_rpc', AsyncMock(return_value=damaged))
    with pytest.raises(core_admission.AdmissionUncertain): run(raw)


def test_finalize_ack_must_preserve_original_source_and_expected_summary(monkeypatch):
    raw = artifact(); damaged = complete(raw)
    damaged['source_snapshot']['episodes'][0]['source']['renderer_affinity'] = 'legacy'
    monkeypatch.setattr(core_admission, '_rpc', AsyncMock(side_effect=[raw, damaged]))
    with pytest.raises(core_admission.AdmissionUncertain): run(raw)


def test_getter_missing_and_summary_only(monkeypatch):
    raw = artifact(); rpc = AsyncMock(side_effect=[None, complete(raw)])
    monkeypatch.setattr(core_admission, '_rpc', rpc)
    assert asyncio.run(reports.get_writing_report(UUID(raw['id']))) is None
    result = asyncio.run(reports.get_writing_report(UUID(raw['id'])))
    assert 'source_snapshot' not in result and result['summary']['admitted_episode_count'] == 1


@pytest.mark.parametrize('epoch', [None, '', 'not-a-uuid'])
def test_invalid_epoch_never_reaches_transport(monkeypatch, epoch):
    rpc = AsyncMock(); monkeypatch.setattr(core_admission, '_rpc', rpc)
    with pytest.raises(core_admission.AdmissionInvalid):
        asyncio.run(reports.create_or_resume_writing_report(uuid4(), epoch))
    rpc.assert_not_called()
