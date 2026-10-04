"""Public CTA selects canonical current revision; empty/error are distinct."""
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4
import asyncio

import pytest
from fastapi import HTTPException
from routers import grammar, quiz
from services import quiz_service
from services.grammar_quiz_resolution import current_banks
from services.grammar_quiz_revision_source import REVIEWED_SOURCES
from test_grammar_quiz_revision_boundary import CODE


def revised():
    old={'id':str(uuid4()),'code':CODE,'topic_id':str(uuid4()),'grammar_canonical_code':CODE,
        'grammar_revision':'a'*64,'grammar_is_current':False,'grammar_predecessor_bank_id':None,
        'grammar_new_starts_enabled':True,'words_count':13,'title':'Present Simple'}
    current={**old,'id':str(uuid4()),'code':CODE+'~'+REVIEWED_SOURCES[CODE][0][:16],
        'grammar_revision':'b'*64,'grammar_is_current':True,'grammar_predecessor_bank_id':old['id']}
    return old,current


def test_current_mapping_keeps_old_bank_id_and_public_canonical_article_code():
    old,current=revised(); before=deepcopy([old,current])
    selected=current_banks([current,old])
    assert len(selected)==1 and selected[0]['id']==current['id'] and selected[0]['code']==CODE
    assert [old,current]==before


def test_learner_bank_list_uses_current_revision_without_exposing_physical_code(monkeypatch):
    from test_quiz_service import _FakeSupabase
    old,current=revised()
    old.update(skill_area='grammar',updated_at='2026-10-04T00:00:00Z')
    current.update(skill_area='grammar',updated_at='2026-10-04T01:00:00Z')
    vocabulary={'id':str(uuid4()),'topic_id':str(uuid4()),'code':'L14',
        'title':'Vocabulary','skill_area':'vocab','words_count':20,'updated_at':None}
    stored=[current,vocabulary,old]
    before=deepcopy(stored)
    fake=_FakeSupabase({('quiz_banks','select'):stored})
    monkeypatch.setattr(quiz_service,'supabase_admin',fake)
    async def signed_in(_authorization): return {'id':str(uuid4())}
    monkeypatch.setattr(quiz,'get_supabase_user',signed_in)
    result=asyncio.run(quiz.list_banks(skill_area=None,topic_id=None,authorization='test'))
    assert result==[{key:value for key,value in {**current,'code':CODE}.items()
        if key in {'id','topic_id','code','title','skill_area','words_count','updated_at'}},vocabulary]
    assert stored==before
    assert all(call['op']=='select' for call in fake.calls)


@pytest.mark.parametrize('response',[
    SimpleNamespace(data=[],count=None),
    SimpleNamespace(data=[{'skill_area':'grammar','code':CODE}],count=2),
])
def test_learner_bank_list_refuses_partial_current_mapping(monkeypatch,response):
    class QuizListQuery(Query):
        def neq(self,*args): return self
    monkeypatch.setattr(quiz_service,'supabase_admin',QuizListQuery(response))
    with pytest.raises(HTTPException) as error:
        quiz_service.list_published_banks(skill_area='grammar')
    assert error.value.status_code==503


def test_learner_bank_list_preserves_unmanaged_grammar_and_course_exclusion(monkeypatch):
    from test_quiz_service import _FakeSupabase
    bank={'id':str(uuid4()),'topic_id':str(uuid4()),'code':CODE,'title':'Present Simple',
        'skill_area':'grammar','words_count':13,'updated_at':None}
    fake=_FakeSupabase({('quiz_banks','select'):[bank]})
    monkeypatch.setattr(quiz_service,'supabase_admin',fake)
    assert quiz_service.list_published_banks(skill_area='grammar',topic_id=bank['topic_id'])==[bank]
    assert ('neq','skill_area','course') in fake.calls[-1]['filters']
    assert ('topic_id',bank['topic_id']) in fake.calls[-1]['filters']
    assert quiz_service.list_published_banks(skill_area='course')==[]


@pytest.mark.parametrize('problem',['two_current','missing_current','unmanaged_duplicate','wrong_predecessor','wrong_source','wrong_topic','nonboolean_pause','missing_pause'])
def test_ambiguous_or_corrupt_mapping_is_unavailable_never_first_match(problem):
    old,current=revised()
    if problem=='two_current': old['grammar_is_current']=True
    elif problem=='missing_current': current['grammar_is_current']=False
    elif problem=='unmanaged_duplicate': old['grammar_canonical_code']=current['grammar_canonical_code']=None; current['code']=CODE
    elif problem=='wrong_predecessor': current['grammar_predecessor_bank_id']=str(uuid4())
    elif problem=='wrong_source': current['code']=CODE+'~'+'f'*16
    elif problem=='wrong_topic': current['topic_id']=str(uuid4())
    elif problem=='nonboolean_pause': current['grammar_new_starts_enabled']=0
    else: current.pop('grammar_new_starts_enabled')
    with pytest.raises(HTTPException) as error: current_banks([old,current])
    assert error.value.status_code==503


class Query:
    def __init__(self,response): self.response=response
    def table(self,*a): return self
    def select(self,*a,**kw): assert kw['count']=='exact'; return self
    def eq(self,*a): return self
    def order(self,*a): return self
    def execute(self):
        if isinstance(self.response,Exception): raise self.response
        return self.response


@pytest.mark.parametrize('response',[SimpleNamespace(data=[],count=None),SimpleNamespace(data=[{'code':'G-other'}],count=2),Exception('private transport failure')])
def test_storage_failure_or_partial_read_is_not_an_empty_exercise_list(monkeypatch,response):
    monkeypatch.setattr(grammar,'supabase_admin',Query(response))
    with pytest.raises(HTTPException) as error: asyncio.run(grammar.list_exercises())
    assert error.value.status_code==503 and 'private transport' not in str(error.value.detail)


def test_empty_exact_read_is_truthful_and_paused_current_keeps_readable_availability(monkeypatch):
    monkeypatch.setattr(grammar,'supabase_admin',Query(SimpleNamespace(data=[],count=0)))
    assert asyncio.run(grammar.get_article_exercise('tenses','present-simple'))=={'available':False,'code':CODE}
    old,current=revised(); current['grammar_new_starts_enabled']=False
    monkeypatch.setattr(grammar,'supabase_admin',Query(SimpleNamespace(data=[old,current],count=2)))
    result=asyncio.run(grammar.get_article_exercise('tenses','present-simple'))
    assert result['bank_id']==current['id'] and result['grammar_revision']=='b'*64
    assert result['available'] is True and result['new_starts_enabled'] is False
