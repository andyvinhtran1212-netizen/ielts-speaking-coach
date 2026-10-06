"""Use actual next-item selection, including its pending fast path."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from services import grammar_diagnostic_service as service

@pytest.fixture
def selector(monkeypatch):
    item=dict(item_id='source-id',stimulus_family='source-family',parallel_set_id='source-parallel',
              attribute_id='M01',module='ALL',diagnostic_status='DIAGNOSTIC_APPROVED',prompt='Prompt.',options=['A','B'])
    calls=[]
    class Query:
        def __init__(self,name): self.name=name;self.rows=[]
        def select(self,*_):return self
        def eq(self,*_):return self
        def range(self,*_):return self
        def update(self,value):calls.append(('update',value));return self
        def insert(self,value):calls.append(('insert',value));return self
        def execute(self):return SimpleNamespace(data=self.rows)
    history={'item_ids':[],'stimulus_families':[],'parallel_set_ids':[]}
    def rpc(name,payload):
        assert name=='master30_full_practice_exposure' and payload=={'p_user_id':'user'}
        return SimpleNamespace(execute=lambda:SimpleNamespace(data=history))
    monkeypatch.setattr(service,'supabase_admin',SimpleNamespace(table=Query,rpc=rpc))
    monkeypatch.setattr(service,'_session',lambda *_:dict(status='in_progress',release_id='release',objective_limit=28,
                                                        test_length='QUICK',mode='REVIEW',module='GENERAL',current_phase='BASELINE'))
    monkeypatch.setattr(service,'_require_session_accepting',lambda *_:None)
    monkeypatch.setattr(service,'_content',lambda *_:{'items':[item],'by_id':{item['item_id']:item}})
    monkeypatch.setattr(service,'_responses',lambda *_:[])
    monkeypatch.setattr(service,'_exposures',lambda *_:[])
    return item,history,calls

@pytest.mark.parametrize('field',['item_ids','stimulus_families','parallel_set_ids'])
def test_all_practice_links_exhaust_pool_without_fake_exposure(selector,field):
    item,history,calls=selector
    history[field]=[item[{'item_ids':'item_id','stimulus_families':'stimulus_family','parallel_set_ids':'parallel_set_id'}[field]]]
    with pytest.raises(HTTPException) as exc: service.next_item('user','session')
    assert exc.value.detail['error_code']=='diagnostic_exhausted'
    assert calls[0][0]=='update' and calls[0][1]['status']=='exhausted'
    assert all(name!='insert' for name,_ in calls)

def test_pending_item_is_checked_against_actual_practice_before_return(selector,monkeypatch):
    item,history,calls=selector; history['stimulus_families']=[item['stimulus_family']]
    monkeypatch.setattr(service,'_exposures',lambda *_:[{'item_id':item['item_id'],'phase':'BASELINE'}])
    with pytest.raises(HTTPException) as exc: service.next_item('user','session')
    assert exc.value.detail['error_code']=='diagnostic_practice_exposed' and calls==[]

@pytest.mark.parametrize('broken',[{}, {'item_ids':[], 'stimulus_families':[None], 'parallel_set_ids':[]}])
def test_invalid_history_cannot_serve_even_a_pending_item(selector,monkeypatch,broken):
    item,history,calls=selector;history.clear();history.update(broken)
    monkeypatch.setattr(service,'_exposures',lambda *_:[{'item_id':item['item_id'],'phase':'BASELINE'}])
    with pytest.raises(HTTPException) as exc:service.next_item('user','session')
    assert exc.value.status_code==503 and exc.value.detail['error_code']=='exposure_history_unavailable'
    assert calls==[]

def test_independent_item_is_still_served_without_answer_key(selector):
    item,history,calls=selector
    value=service.next_item('user','session')
    assert value['item']['item_id']==item['item_id'] and 'correct_index' not in value['item']
    assert calls[0][0]=='insert'
