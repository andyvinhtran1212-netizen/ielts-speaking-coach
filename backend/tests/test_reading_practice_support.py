import copy
import json
from pathlib import Path

import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from fastapi.testclient import TestClient

from routers.reading_student import _grade_one
from services.reading_practice_support import checked_evidence, digest, plain_source, question_digest, validated_support


def sample():
    body = 'A **shared** pasture is depleted. Rules protect it.'
    vi = 'Một đồng cỏ chung bị cạn kiệt. Quy tắc bảo vệ nó.'
    q = {'q_num': 1, 'question_type': 'mcq_multi', 'prompt': 'Choose TWO.',
         'payload': {'options': [{'label': 'A', 'text': 'One'}, {'label': 'C', 'text': 'Two'}]},
         'answer': {'answer': 'A, C'}}
    support = {'schema_version': 1, 'source_sha256': digest(body), 'translation_sha256': digest(vi),
               'units': [{'id': 'p1-s1', 'source': 'A shared pasture is depleted.',
                          'translation_vi': 'Một đồng cỏ chung bị cạn kiệt.', 'precision': 'sentence',
                          'phrases': [{'source': 'depleted', 'target': 'cạn kiệt'}]}], 'illustrations': [],
               'question_evidence': {'1': {'question_sha256': question_digest(q),
                                         'source': 'A shared pasture is depleted.', 'precision': 'quote', 'illustrations': []}}}
    return body, {'translation_vi': vi, 'practice_support': support}, q


@pytest.mark.parametrize('answer,correct', [('A, C', True), ('C, A', True), ('c,a', True),
                                           ('A', False), ('A, C, D', False), ('A, A, C', False), ('', False)])
def test_multi_requires_the_complete_unique_set(answer, correct):
    _, _, q = sample()
    assert _grade_one(q, answer)['correct'] is correct


def test_array_primary_is_a_set_for_multi_and_alternatives_for_single():
    _, _, q = sample()
    q['answer']['answer'] = ['A', 'C']
    assert _grade_one(q, 'C,A')['correct']
    assert not _grade_one(q, 'C')['correct']
    q['question_type'] = 'short_answer'
    assert _grade_one(q, 'C')['correct']


def test_detail_support_withholds_evidence_and_rejects_drift():
    body, metadata, q = sample()
    assert 'question_evidence' not in validated_support(metadata, body).model_dump()
    assert checked_evidence(metadata, body, q)
    assert validated_support(metadata, body + ' Changed.') is None
    changed = copy.deepcopy(metadata); changed['translation_vi'] += ' Thay đổi.'
    assert validated_support(changed, body) is None
    q['prompt'] = 'Changed question.'
    assert checked_evidence(metadata, body, q) is None


@pytest.mark.parametrize('change', ['duplicate_unit', 'missing_phrase', 'overlap', 'unknown', 'unsafe_image'])
def test_malformed_alignment_fails_closed(change):
    body, metadata, _ = sample()
    support = metadata['practice_support']; unit = support['units'][0]
    if change == 'duplicate_unit': support['units'].append(copy.deepcopy(unit))
    if change == 'missing_phrase': unit['phrases'][0]['target'] = 'không tồn tại'
    if change == 'overlap': unit['phrases'].append({'source': 'is depleted', 'target': 'bị cạn kiệt'})
    if change == 'unknown': unit['answer'] = 'A'
    if change == 'unsafe_image': support['illustrations'] = [{'src': 'javascript:alert(1)', 'alt': 'x', 'caption': 'x'}]
    assert validated_support(metadata, body) is None


def test_authored_content_packet_is_revision_bound_and_preserves_keys():
    packet = json.loads((Path(__file__).parents[1] / 'content/reading-practice/20261014-repairs.json').read_text())
    passages = {item['passage_id']: item for item in packet['passages']}
    assert len({q['question_id'] for q in packet['questions']}) == len(packet['questions'])
    for passage in passages.values():
        assert digest(passage['source_body_markdown']) == passage['source_sha256']
        assert validated_support(passage['changes']['metadata'], passage['source_body_markdown'])
    for repair in packet['questions']:
        before = repair['before']; after = {**before, 'prompt': repair['after_prompt']}
        if 'after_payload' in repair: after['payload'] = repair['after_payload']
        passage = passages[before['passage_id']]
        assert plain_source(passage['source_body_markdown']).count(plain_source(repair['source_evidence'])) == 1
        assert before['answer'] == after['answer']
        assert checked_evidence(passage['changes']['metadata'], passage['source_body_markdown'], after)


def test_routes_hide_support_evidence_until_the_matching_question_is_checked(monkeypatch):
    from main import app
    from routers import reading_student
    body, metadata, question = sample()
    passage = {'id': 'p1', 'slug': 'commons', 'title': 'Commons', 'body_markdown': body,
               'metadata': metadata, 'glossary': []}
    question.update({'explanation': 'Checked explanation', 'skill_tag': 'detail', 'order_num': 1})

    class Query:
        def __init__(self, rows): self.rows = rows; self.columns = []
        def select(self, columns): self.columns = columns.split(','); return self
        def eq(self, *args): return self
        def order(self, *args): return self
        def limit(self, *args): return self
        def execute(self): return SimpleNamespace(data=[{key: row.get(key) for key in self.columns} for row in self.rows])

    monkeypatch.setattr(reading_student, '_require_auth', AsyncMock(return_value={'id': 'fixture-owner'}))
    monkeypatch.setattr(reading_student, 'supabase_admin', SimpleNamespace(table=lambda name: Query([passage] if name == 'reading_passages' else [question])))
    client = TestClient(app)
    response = client.get('/api/reading/skill/commons', headers={'Authorization': 'Bearer fake'})
    assert response.status_code == 200
    assert 'question_evidence' not in response.text and 'Checked explanation' not in response.text
    assert 'answer' not in response.json()['questions'][0]
    assert response.json()['practice_support']['units'][0]['source'] == 'A shared pasture is depleted.'
    response = client.post('/api/reading/skill/commons/check', json={'answers': [{'q_num': 1, 'user_answer': 'C, A'}]})
    assert response.status_code == 200
    assert response.json()['results'][0]['correct'] is True
    assert response.json()['results'][0]['evidence']['source'] == 'A shared pasture is depleted.'
    stale = client.post('/api/reading/skill/commons/check', json={'source_sha256': '0' * 64, 'answers': [{'q_num': 1, 'user_answer': 'C,A'}]})
    assert stale.status_code == 409 and 'results' not in stale.json()
    assert client.post('/api/reading/skill/commons/check', json={'answers': [{'q_num': 2, 'user_answer': 'A'}]}).json()['results'] == []
