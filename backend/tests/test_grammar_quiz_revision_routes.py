"""Concrete admin authorization/body/error and learner identity wire contracts."""
import json
from unittest.mock import AsyncMock,MagicMock
from uuid import uuid4

import pytest
from fastapi import FastAPI,HTTPException
from fastapi.testclient import TestClient
from routers import admin_quiz,quiz,admin
from services import grammar_quiz_revisions as revisions,quiz_service
from test_grammar_quiz_revision_boundary import CODE,pg,encoded
from test_grammar_quiz_revisions import SOURCE
from test_quiz_service import _FakeSupabase

ACTOR='11111111-1111-1111-1111-111111111111'
OLD='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
NEW='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
TOPIC='cccccccc-cccc-cccc-cccc-cccccccccccc'
PATH='/admin/quiz/grammar-revisions/'+CODE


@pytest.fixture
def wire(monkeypatch):
    async def admin_gate(token):
        if token=='Bearer admin':return {'id':ACTOR}
        raise HTTPException(401 if token is None else 403,'Permission denied')
    async def learner_gate(token):
        if token=='Bearer learner':return {'id':ACTOR}
        raise HTTPException(401,'Permission denied')
    monkeypatch.setattr(admin_quiz,'require_admin',admin_gate)
    monkeypatch.setattr(quiz,'get_supabase_user',learner_gate)
    monkeypatch.setattr(admin,'_db_engine','existing-configured-owner')
    app=FastAPI(); app.include_router(admin_quiz.router); app.include_router(quiz.router)
    return TestClient(app),app


def canonical():
    return {'canonical_code':CODE,'original_bank_id':OLD,'canonical_root_bank_id':OLD,'publication_available':True,'bank_ids':[OLD],'current_bank_id':OLD,'topic_id':TOPIC,
        'revision':'a'*64,'current_bank_revision':'b'*64,'original_questions_sha256':'c'*64,
        'original_metadata_sha256':'d'*64,'is_managed':False,'new_starts_enabled':True,
        'footprint':{'actors':0,'sessions':0,'stats':0,'attempts':0,'assignments':0,'open_sessions':0,
            'paused_sessions':0,'classifications':{},'authoritative_review_required':False}}


def preview_payload():return {'source_markdown':SOURCE,'expected_revision':'a'*64}

def commit_payload():return {**preview_payload(),'preview_fingerprint':'e'*64,'operation_id':str(uuid4())}


@pytest.mark.parametrize('suffix',['','/preview','/commit'])
@pytest.mark.parametrize('token,status',[(None,401),('Bearer learner',403)])
def test_denied_before_any_canonical_storage_action(wire,monkeypatch,suffix,token,status):
    client,_=wire
    actions={name:AsyncMock() for name in ('read_revision','preview_revision','commit_revision')}
    for name,action in actions.items():monkeypatch.setattr(revisions,name,action)
    headers={'Authorization':token} if token else {}
    response=client.get(PATH,headers=headers) if not suffix else client.post(PATH+suffix,headers=headers,
        json=commit_payload() if suffix=='/commit' else preview_payload())
    assert response.status_code==status
    for action in actions.values():action.assert_not_awaited()


def test_concrete_wire_uses_existing_engine_authenticated_actor_and_keeps_current_vs_committed(wire,monkeypatch):
    client,app=wire
    read=AsyncMock(return_value=canonical()); monkeypatch.setattr(revisions,'read_revision',read)
    response=client.get(PATH,headers={'Authorization':'Bearer admin'})
    assert response.status_code==200 and response.json()['footprint']['sessions']==0
    read.assert_awaited_once_with('existing-configured-owner',CODE)
    payload=commit_payload()
    result={'canonical_code':CODE,'operation_id':payload['operation_id'],'outcome':'already_applied',
        'original_bank_id':OLD,'corrected_bank_id':NEW,'source_sha256':'f'*64,'committed_revision':'a'*64,
        'current_revision':'b'*64,'current_matches_committed':False,'original_questions_sha256':'c'*64,
        'original_history_sha256':'d'*64,'canonical':canonical()}
    commit=AsyncMock(return_value=result); monkeypatch.setattr(revisions,'commit_revision',commit)
    response=client.post(PATH+'/commit',json=payload,headers={'Authorization':'Bearer admin'})
    assert response.status_code==200 and response.json()['current_matches_committed'] is False
    assert commit.await_args.args[:3]==('existing-configured-owner',CODE,ACTOR)
    assert commit.await_args.args[3].model_dump(mode='json')==payload
    schema=app.openapi(); paths=schema['paths']['/admin/quiz/grammar-revisions/{canonical_code}/commit']
    assert paths['post']['requestBody']['content']['application/json']['schema']['$ref'].endswith('GrammarRevisionCommitRequest')
    assert paths['post']['responses']['200']['content']['application/json']['schema']['$ref'].endswith('GrammarRevisionCommitResult')
    assert paths['post']['responses']['503']['content']['application/json']['schema']['$ref'].endswith('GrammarRevisionErrorResponse')
    assert 'ManagedGrammarSessionState' in schema['components']['schemas']


@pytest.mark.parametrize('mutation',[{'actor_id':ACTOR},{'bank_id':OLD},{'source_markdown':'\ud800'},{'expected_revision':True},{'operation_id':'invalid'}])
def test_invalid_or_extra_command_fields_are_rejected_without_service_write(wire,monkeypatch,mutation):
    client,_=wire; action=AsyncMock(); monkeypatch.setattr(revisions,'commit_revision',action)
    payload={**commit_payload(),**mutation}
    response=client.post(PATH+'/commit',content=json.dumps(payload),headers={'Authorization':'Bearer admin','Content-Type':'application/json'})
    assert response.status_code==422; action.assert_not_awaited()


def test_original_raw_body_cap_cannot_be_evaded_with_whitespace(wire,monkeypatch):
    client,_=wire; action=AsyncMock(); monkeypatch.setattr(revisions,'commit_revision',action)
    response=client.post(PATH+'/commit',content=json.dumps(commit_payload()).encode()+b' '*(256*1024),
        headers={'Authorization':'Bearer admin','Content-Type':'application/json'})
    assert response.status_code==422 and response.json()['detail']['error_code']=='grammar_source_too_large'
    action.assert_not_awaited()


@pytest.mark.parametrize('status,code',[(404,'grammar_revision_scope_not_found'),(409,'grammar_preview_conflict'),(503,'grammar_receipt_unavailable')])
def test_safe_domain_errors_keep_status_and_revision(wire,monkeypatch,status,code):
    client,_=wire
    action=AsyncMock(side_effect=revisions.GrammarRevisionError(status,code,'Thông tin cần kiểm tra.','a'*64))
    monkeypatch.setattr(revisions,'read_revision',action)
    response=client.get(PATH,headers={'Authorization':'Bearer admin'})
    assert response.status_code==status
    assert response.json()['detail']=={'error_code':code,'message':'Thông tin cần kiểm tra.','current_revision':'a'*64}


def test_learner_start_passes_explicit_ack_and_keeps_legacy_without_grammar_property(wire,monkeypatch):
    client,_=wire
    starter=MagicMock(return_value={'session_id':OLD,'resume':[]})
    monkeypatch.setattr(quiz_service,'start_session',starter)
    payload={'bank_id':NEW,'grammar_revision':'b'*64,'admission_kind':'review'}
    response=client.post('/api/quiz/sessions',json=payload,headers={'Authorization':'Bearer learner'})
    assert response.status_code==201 and response.json()=={'session_id':OLD,'resume':[]}
    starter.assert_called_once_with(user_id=ACTOR,bank_id=NEW,kind='run',assignment_item_id=None,
        grammar_revision='b'*64,admission_kind='review',text_match_policy=None)
    starter.reset_mock()
    for invalid in ({'grammar_revision':True},{'admission_kind':'continuation'},
                    {'text_match_policy':True},{'text_match_policy':'unknown'}):
        response=client.post('/api/quiz/sessions',json={'bank_id':NEW,**invalid},headers={'Authorization':'Bearer learner'})
        assert response.status_code==422
    starter.assert_not_called()


def test_actual_start_wire_has_typed_matching_ack_and_frozen_bank_echo(wire,monkeypatch):
    client,app=wire
    grammar={'canonical_code':CODE,'bank_id':OLD,'bank_revision':'a'*64,'content_state':'legacy',
        'new_starts_enabled':False,'can_continue_legacy':True,'can_continue_current':False,
        'current_bank_id':NEW,'current_bank_revision':'b'*64,'text_match_policy':'qid-exact-v1'}
    starter=MagicMock(return_value={'session_id':TOPIC,'resume':[],'grammar':grammar,'legacy_timer':None})
    monkeypatch.setattr(quiz_service,'start_session',starter)
    response=client.post('/api/quiz/sessions',json={'bank_id':OLD,'grammar_revision':'a'*64,
        'text_match_policy':'qid-exact-v1'},headers={'Authorization':'Bearer learner'})
    assert response.status_code==201
    assert response.json()['grammar']==grammar and response.json()['legacy_timer'] is None
    assert starter.call_args.kwargs['text_match_policy']=='qid-exact-v1'
    schema=app.openapi()['components']['schemas']
    assert schema['StartSessionBody']['properties']['text_match_policy']['anyOf'][0]['const']=='qid-exact-v1'
    assert 'bank_id' in schema['ManagedGrammarSessionState']['required']


@pytest.mark.asyncio
@pytest.mark.parametrize('terminal_repeat',[False,True])
async def test_actual_pg_end_rows_through_real_asgi_facade_keep_frozen_identity_and_explicit_null(pg,wire,monkeypatch,terminal_repeat):
    """Actual PG rows/RPC output, real facade/route; synthetic transport/auth only."""
    client,app=wire
    await pg.enroll()
    admission=await pg.start(current=True) if not terminal_repeat else {'session_id':str(pg.predecessor)}
    from uuid import UUID
    session_id=UUID(admission['session_id'])
    pending=json.loads(await pg.c.fetchval('SELECT to_jsonb(s)::text FROM quiz_sessions s WHERE id=$1',session_id))
    ended=await pg.rpc('grammar_quiz_end_service',pg.user,session_id,encoded({'ended_by':'paused'}))
    stored=json.loads(await pg.c.fetchval('SELECT to_jsonb(s)::text FROM quiz_sessions s WHERE id=$1',session_id))
    actual_bank=json.loads(await pg.c.fetchval('SELECT to_jsonb(b)::text FROM quiz_banks b WHERE id=$1',pg.old if terminal_repeat else pg.new))
    fake=_FakeSupabase({('quiz_sessions','select'):[stored if terminal_repeat else pending],
        ('quiz_banks','select'):[actual_bank],('rpc','grammar_quiz_end_service'):ended})
    async def owned_gate(_token): return {'id':str(pg.user)}
    monkeypatch.setattr(quiz,'get_supabase_user',owned_gate)
    monkeypatch.setattr(quiz_service,'supabase_admin',fake)
    response=client.patch('/api/quiz/sessions/'+str(session_id),json={'ended_by':'completed'},
        headers={'Authorization':'Bearer learner'})
    assert response.status_code==200
    actual=response.json()
    assert actual['id']==str(session_id) and actual['bank_id']==stored['bank_id']
    assert actual['grammar_revision']==(None if terminal_repeat else stored['grammar_revision'])
    assert actual['accuracy'] is None
    assert ('grammar' in actual)==(not terminal_repeat)
    if terminal_repeat:
        assert actual==stored
        assert len(fake.calls)==1 and fake.calls[0]['table']=='quiz_sessions'
    else:
        assert actual['grammar']['bank_id']==stored['bank_id']
        assert actual['grammar']['bank_revision']==stored['grammar_revision']
        assert len([call for call in fake.calls if call['op']=='rpc'])==1
    assert not any(call['op'] in ('insert','update','upsert') for call in fake.calls)
    schema=app.openapi()['components']['schemas']['QuizSessionEndResponse']
    assert 'bank_id' not in schema['required'] and 'grammar_revision' not in schema['required']
    assert schema['properties']['bank_id']['anyOf'][0]['format']=='uuid'
    assert schema['properties']['grammar_revision']['anyOf'][0]['pattern']=='^[0-9a-f]{64}$'


def test_unrelated_legacy_end_wire_keeps_omitted_identity_fields_and_explicit_other_null(wire,monkeypatch):
    client,_=wire
    ended={'id':OLD,'ended_at':'2026-09-30T00:00:00Z','ended_by':'paused','legacy_timer':None}
    finalizer=MagicMock(return_value=ended)
    monkeypatch.setattr(quiz_service,'end_session',finalizer)
    response=client.patch('/api/quiz/sessions/'+OLD,json={'ended_by':'paused'},headers={'Authorization':'Bearer learner'})
    assert response.status_code==200 and response.json()==ended
    assert 'bank_id' not in response.json() and 'grammar_revision' not in response.json()


@pytest.mark.parametrize('raw',[b'{"operation_id":NaN}',b'{"source_markdown":"x","source_markdown":"x"}',b'{"unrelated":"\\ud800"}',b'['*2000+b']'*2000])
def test_ambiguous_or_unencodable_json_cannot_break_422_or_reach_write(wire,monkeypatch,raw):
    client,_=wire; action=AsyncMock(); monkeypatch.setattr(revisions,'commit_revision',action)
    response=client.post(PATH+'/commit',content=raw,headers={'Authorization':'Bearer admin','Content-Type':'application/json'})
    assert response.status_code==422
    assert response.json()['detail'][0]['type']=='json_invalid'
    action.assert_not_awaited()
