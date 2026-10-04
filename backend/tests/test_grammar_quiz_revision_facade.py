"""Managed/unmanaged sync boundary, canonical identity and telemetry truth."""
from unittest.mock import patch
from copy import deepcopy

import pytest
from fastapi import HTTPException

from services import grammar_quiz_session as facade, quiz_service as quiz
from test_quiz_service import _FakeSupabase, _USER, _BANK, _SESS
from test_grammar_quiz_revision_boundary import CODE

REVISION='a'*64
CURRENT='cccccccc-cccc-cccc-cccc-cccccccccccc'


def bank(*,current=False):
    return {'id':_BANK,'code':CODE,'skill_area':'grammar','is_published':True,
        'grammar_canonical_code':CODE,'grammar_revision':REVISION,'grammar_is_current':current}


def state(*,current=False):
    return {'canonical_code':CODE,'bank_id':_BANK,'bank_revision':REVISION,'content_state':'current' if current else 'legacy',
        'new_starts_enabled':True,'can_continue_legacy':not current,'mastery_retained':False,
        'current_bank_id':CURRENT,'current_bank_revision':'b'*64}


def test_old_unversioned_reload_calls_owned_continuation_rpc_without_adopting_current_bank():
    response={'session_id':_SESS,'resume':[{'item_key':'old-key','skills_passed':['recognition']}],'grammar':state()}
    fake=_FakeSupabase({('quiz_banks','select'):[bank()],('rpc','grammar_quiz_start_service'):response})
    with patch.object(quiz,'supabase_admin',fake):
        result=quiz.start_session(user_id=_USER,bank_id=_BANK)
    assert result['grammar']['current_bank_id']==CURRENT and result['grammar']['bank_revision']==REVISION
    assert result['resume']==response['resume']
    rpc=next(call for call in fake.calls if call['op']=='rpc')
    assert rpc['payload']=={'p_user':_USER,'p_bank':_BANK,'p_revision':None,'p_admission_kind':None}
    assert not any(call['op']=='insert' for call in fake.calls)


def test_explicit_matching_ack_is_forwarded_without_default_or_retry_downgrade():
    response={'session_id':_SESS,'resume':[],'grammar':{**state(),'text_match_policy':'qid-exact-v1'}}
    fake=_FakeSupabase({('quiz_banks','select'):[bank()],('rpc','grammar_quiz_start_service'):response})
    with patch.object(quiz,'supabase_admin',fake):
        result=quiz.start_session(user_id=_USER,bank_id=_BANK,grammar_revision=REVISION,
            text_match_policy='qid-exact-v1')
    calls=[c for c in fake.calls if c['op']=='rpc']
    assert len(calls)==1 and calls[0]['payload']['p_text_match_policy']=='qid-exact-v1'
    assert result['grammar']['bank_id']==_BANK
    assert result['grammar']['text_match_policy']=='qid-exact-v1'


def test_frozen_bank_echo_cannot_be_replaced_by_current_mapping_and_absent_capability_is_omitted():
    value=facade.state(state(),bank())
    assert value['bank_id']==_BANK and value['current_bank_id']==CURRENT
    assert 'text_match_policy' not in value
    with pytest.raises(HTTPException) as error:
        facade.state({**state(),'bank_id':CURRENT},bank())
    assert error.value.status_code==503


def test_reset_stale_is_typed_409_without_direct_write_fallback():
    fake=_FakeSupabase({('quiz_sessions','select'):[{'id':_SESS,'user_id':_USER,'bank_id':_BANK}],
        ('quiz_banks','select'):[bank()],('rpc','grammar_quiz_progress_service'):Exception('grammar_reset_stale')})
    with patch.object(quiz,'supabase_admin',fake),pytest.raises(HTTPException) as error:
        quiz.log_progress(user_id=_USER,session_id=_SESS,attempts=[],word_stats=[])
    assert error.value.status_code==409 and error.value.detail['error_code']=='grammar_reset_stale'
    assert not any(c['op'] in ('insert','upsert','update') for c in fake.calls)


def test_marked_history_only_terminalization_still_returns_reset_stale_before_new_progress():
    session={'id':_SESS,'user_id':_USER,'bank_id':_BANK,'grammar_revision':REVISION,
        'grammar_reset_at':'2026-09-30T00:00:00Z','ended_at':'2026-09-30T00:01:00Z','ended_by':'paused'}
    fake=_FakeSupabase({('quiz_sessions','select'):[session],('quiz_banks','select'):[bank()],
        ('rpc','grammar_quiz_progress_service'):Exception('grammar_reset_stale')})
    with patch.object(quiz,'supabase_admin',fake),patch.object(quiz,'_record_quiz_kp_evidence') as evidence:
        with pytest.raises(HTTPException) as error:
            quiz.log_progress(user_id=_USER,session_id=_SESS,attempts=[],word_stats=[])
    assert error.value.status_code==409 and error.value.detail['error_code']=='grammar_reset_stale'
    evidence.assert_not_called()
    assert len([c for c in fake.calls if c['op']=='rpc'])==1
    assert not any(c['op'] in ('insert','upsert','update') for c in fake.calls)


@pytest.mark.parametrize('revision',[None,'f'*64])
def test_stale_or_unversioned_current_admission_is_explicit_conflict_no_direct_insert(revision):
    fake=_FakeSupabase({('quiz_banks','select'):[bank(current=True)],
        ('rpc','grammar_quiz_start_service'):Exception('grammar_content_revised')})
    with patch.object(quiz,'supabase_admin',fake),pytest.raises(HTTPException) as error:
        quiz.start_session(user_id=_USER,bank_id=_BANK,grammar_revision=revision)
    assert error.value.status_code==409 and error.value.detail['error_code']=='grammar_content_revised'
    assert not any(call['op']=='insert' for call in fake.calls)


def test_legacy_null_session_identity_uses_canonical_bank_rpc_and_only_new_attempts_feed_kp():
    session={'id':_SESS,'user_id':_USER,'bank_id':_BANK,'code':None,'grammar_revision':None}
    inserted={'id':'new-evidence','user_id':_USER,'session_id':_SESS,'bank_id':_BANK,'item_key':'item','is_correct':False}
    raw={'ok':True,'attempts':1,'word_stats':0,'grammar':state(),'newly_inserted_attempts':[inserted]}
    fake=_FakeSupabase({('quiz_sessions','select'):[session],('quiz_banks','select'):[bank()],
        ('rpc','grammar_quiz_progress_service'):raw})
    attempt={'qid':'q1','item_key':'item','skill':'recognition','type':'mcq','is_correct':False,'response_time_ms':4.8}
    with patch.object(quiz,'supabase_admin',fake),patch.object(quiz,'_record_quiz_kp_evidence') as evidence:
        result=quiz.log_progress(user_id=_USER,session_id=_SESS,attempts=[attempt],word_stats=[])
        evidence.assert_called_once_with(_USER,_BANK,[inserted])
        evidence.reset_mock()
        fake.responses[('rpc','grammar_quiz_progress_service')]={'ok':True,'attempts':0,'word_stats':0,'grammar':state(),'newly_inserted_attempts':[]}
        repeated=quiz.log_progress(user_id=_USER,session_id=_SESS,attempts=[attempt],word_stats=[])
        evidence.assert_called_once_with(_USER,_BANK,[])
    assert result['attempts']==1 and repeated['attempts']==0
    assert 'newly_inserted_attempts' not in result and 'newly_inserted_attempts' not in repeated
    rpc=next(call for call in fake.calls if call['op']=='rpc')
    assert rpc['payload']['p_attempts'][0]['response_time_ms']==5
    assert not any(call['op'] in ('insert','upsert') for call in fake.calls)


@pytest.mark.parametrize('raw',[None,[],{}, {'ok':True,'attempts':1,'word_stats':0,'grammar':state(),'newly_inserted_attempts':[]}])
def test_invalid_managed_write_ack_is_unavailable_and_never_direct_fallback(raw):
    fake=_FakeSupabase({('quiz_sessions','select'):[{'id':_SESS,'user_id':_USER,'bank_id':_BANK}],
        ('quiz_banks','select'):[bank()],('rpc','grammar_quiz_progress_service'):deepcopy(raw)})
    with patch.object(quiz,'supabase_admin',fake),pytest.raises(HTTPException) as error:
        quiz.log_progress(user_id=_USER,session_id=_SESS,attempts=[],word_stats=[])
    assert error.value.status_code==503
    assert not any(call['op'] in ('insert','upsert','update') for call in fake.calls)


@pytest.mark.parametrize('bad', [{'can_continue_legacy':1},{'bank_revision':'z'*64},{'current_bank_id':'not-an-id'},{'private_cohort':[{'user_id':_USER}]}])
def test_read_state_is_strict_and_never_leaks_cohort(bad):
    with pytest.raises(HTTPException) as error: facade.state({**state(),**bad},bank())
    assert error.value.status_code==503


def test_managed_end_binds_server_owner_and_returns_frozen_legacy_identity():
    session={'id':_SESS,'user_id':_USER,'bank_id':_BANK,'code':CODE,'grammar_revision':None}
    ended={**session,'ended_at':'2026-09-30T00:00:00Z','ended_by':'paused','total_correct':2,'grammar':state()}
    fake=_FakeSupabase({('quiz_sessions','select'):[session],('quiz_banks','select'):[bank()],('rpc','grammar_quiz_end_service'):ended})
    with patch.object(quiz,'supabase_admin',fake):
        result=quiz.end_session(user_id=_USER,session_id=_SESS,data={'ended_by':'paused','total_correct':2,'user_id':'intruder'})
    rpc=next(call for call in fake.calls if call['op']=='rpc')
    assert rpc['payload']['p_user']==_USER and rpc['payload']['p_session']==_SESS
    assert result['bank_id']==_BANK and result['grammar']['current_bank_id']==CURRENT
    assert not any(call['op']=='update' for call in fake.calls)


@pytest.mark.parametrize('revision',[None,REVISION])
def test_concurrent_terminal_rpc_echo_preserves_stored_revision_without_optional_current_state(revision):
    session={'id':_SESS,'user_id':_USER,'bank_id':_BANK,'grammar_revision':revision}
    ended={**session,'ended_at':'2026-09-30T00:00:00Z','ended_by':'paused'}
    fake=_FakeSupabase({('rpc','grammar_quiz_end_service'):ended})
    assert facade.end(fake,user_id=_USER,session=session,bank=bank(),summary={'ended_by':'completed'})==ended
    assert len(fake.calls)==1 and fake.calls[0]['op']=='rpc'
    assert 'grammar' not in ended


@pytest.mark.parametrize('mutation',['missing_revision','grafted_revision','wrong_bank','wrong_owner','open','unexpected_terminal'])
def test_concurrent_terminal_rpc_malformed_frozen_echo_cannot_cover_missing_current_state(mutation):
    session={'id':_SESS,'user_id':_USER,'bank_id':_BANK,'grammar_revision':None}
    ended={**session,'ended_at':'2026-09-30T00:00:00Z','ended_by':'paused'}
    if mutation=='missing_revision': ended.pop('grammar_revision')
    elif mutation=='grafted_revision': ended['grammar_revision']=REVISION
    elif mutation=='wrong_bank': ended['bank_id']=CURRENT
    elif mutation=='wrong_owner': ended['user_id']=CURRENT
    elif mutation=='open': ended['ended_at']=None
    else: ended['ended_by']='unknown'
    fake=_FakeSupabase({('rpc','grammar_quiz_end_service'):ended})
    with pytest.raises(HTTPException) as error:
        facade.end(fake,user_id=_USER,session=session,bank=bank(),summary={'ended_by':'completed'})
    assert error.value.status_code==503
    assert len(fake.calls)==1 and fake.calls[0]['op']=='rpc'


def test_legacy_reset_remains_blocked_without_delete_fallback():
    fake=_FakeSupabase({('quiz_banks','select'):[bank()],('rpc','grammar_quiz_reset_service'):Exception('grammar_legacy_reset_forbidden')})
    with patch.object(quiz,'supabase_admin',fake),pytest.raises(HTTPException) as error:
        quiz.reset_progress(user_id=_USER,bank_id=_BANK)
    assert error.value.status_code==409
    assert not any(call['op']=='delete' for call in fake.calls)
