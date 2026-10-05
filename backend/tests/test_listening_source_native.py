"""Native question delivery, exact source binding and protected study boundary."""
from copy import deepcopy
import asyncio
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
import httpx
import pytest
from models.listening_source_collection import SOURCE_CONTRACT
from routers import listening_source_collection as router
from services import listening_source_collection as collection
from services import listening_source_native as native
from services.listening_test_grader import strip_answer_keys

BINDINGS = json.loads((Path(__file__).parent / 'fixtures/listening_source_round1/native-presentation-bindings.json').read_text())['blocks']
TABLE = '80-days:day-55:table_completion:block-1'
RESOURCE = '80-days:day-60:source-key'


def test_complete_native_topology_and_svg_safety():
    content = native.revision()
    assert content['days'] == list(range(1, 81))
    assert len(content['blocks']) == 453  # 350 question blocks, 10 vocabulary, 93 resources
    questions = [q for row in content['blocks'].values() for q in row['presentation']['questions']]
    assert len(questions) == 1676 == len({q['item_id'] for q in questions})
    assert sum(bool(q['fields']) for q in questions) == 12
    assert sum(len(q['fields']) for q in questions) == 25
    figures = [f for row in content['blocks'].values() for f in row['presentation']['figures']]
    assert len(figures) == 32 and len({f['figure_id'] for f in figures}) == 31
    for figure in figures:
        native.validate_svg(figure['svg'])
    def keys(value):
        if isinstance(value, dict):
            for key, child in value.items():
                yield key
                yield from keys(child)
        if isinstance(value, list):
            for child in value: yield from keys(child)
    assert not {'answer', 'printed_key', 'evidence', 'explanation', 'transcript', 'reference_answer', 'storage_path'} & set(keys(content))
    assert all(len(row) == len(p['columns']) for b in content['blocks'].values() if (p := b['presentation'])['columns'] for row in p['rows'])


def test_exact_source_binding_survives_player_allowlist_and_never_signs_crops():
    block = deepcopy(BINDINGS[TABLE]); original = deepcopy(block)
    block['native'] = {'text': 'INJECTED_PROTECTED_ANSWER'}
    safe = strip_answer_keys([{'payload': {'source_contract': SOURCE_CONTRACT, 'source_blocks': [block]}}])[0]['payload']['source_blocks'][0]
    assert 'INJECTED_PROTECTED_ANSWER' not in str(safe)
    delivered = collection.sign_source_block(safe, lambda _: pytest.fail('No archival raster signing'))
    assert delivered['images'] == []
    assert delivered['native']['title'] == 'Festival program'
    assert len(delivered['native']['rows']) == 10
    assert delivered['native']['rows'][1] == ['Claude and Jacques', 'mime artists', '3', '8:00']
    block.pop('native')
    assert block == original


@pytest.mark.parametrize('mutation', [lambda b: b['instruction'].update(word_limit=99), lambda b: b['item_ids'].reverse(), lambda b: b['images'][0].update(storage_path='source-collections/other/revision.png')])
def test_changed_source_cannot_receive_native_content_or_crop_fallback(mutation):
    block = deepcopy(BINDINGS[TABLE]); mutation(block)
    result = collection.sign_source_block(block, lambda _: pytest.fail('No crop fallback'))
    assert result['native'] is None and result['images'] == []


@pytest.mark.parametrize('body', ['<script>alert(1)</script>', '<image href="https://external/x.png"/>', '<foreignObject/>', '<rect onclick="alert(1)"/>', '<rect fill="url(https://external)"/>'])
def test_svg_rejects_executable_or_external_content(body):
    with pytest.raises(ValueError): native.validate_svg(f'<svg xmlns="http://www.w3.org/2000/svg">{body}</svg>')


def test_authenticated_day_and_explicit_study_serialization(monkeypatch):
    block = deepcopy(BINDINGS[RESOURCE]); full = native.native_presentation(block, study_opened=True)
    assert full and full['text'] and full['figures']
    lesson = {'id': 'lesson', 'sequence_num': 60, 'title': 'Day 60', 'metadata': {'source_book': {
        'source_contract': SOURCE_CONTRACT, 'group': 'teaching', 'availability': {}, 'source_position_count': 0,
        'source_only_count': 0, 'parts': [], 'blocks': [block]}, 'source_study': {
        RESOURCE: {'resource_only': True, 'items': [], 'description': 'Opened study', 'transcript': []}}}}
    package = {'package_id': 'source', 'manifest_sha256': 'revision'}
    calls = []
    async def auth(token):
        if token != 'Bearer learner': raise HTTPException(401, 'Sign in')
        calls.append('auth'); return {'id': 'learner'}
    monkeypatch.setattr(router, 'get_supabase_user', auth)
    monkeypatch.setattr(router, '_context', lambda day: (calls.append('content') or package, [lesson]))
    monkeypatch.setattr(collection, 'source_forms', lambda *_: [])
    from routers import listening
    monkeypatch.setattr(listening, '_programme_attempt_state', lambda *_: ({}, False))
    monkeypatch.setattr(router, '_sign', lambda _: pytest.fail('Never sign PDF crops'))
    app = FastAPI(); app.include_router(router.router)
    async def check():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://fixture') as client:
            path = '/api/listening/source-collections/80-days/days/60'
            assert (await client.get(path)).status_code == 401
            assert calls == []
            before = await client.get(path, headers={'Authorization':'Bearer learner'})
            assert before.status_code == 200
            assert before.json()['blocks'][0]['native'] is None
            assert full['text'] not in before.text and full['figures'][0]['svg'] not in before.text
            opened = await client.post(path+'/study', json={'block_ids':[RESOURCE]}, headers={'Authorization':'Bearer learner'})
            assert opened.status_code == 200
            assert opened.json()['independent_practice'] is False
            assert opened.json()['blocks'][0]['native'] == full
            assert opened.json()['blocks'][0]['images'] == []
    asyncio.run(check())


def test_serialized_player_boundary_uses_native_blocks_without_answers_or_signed_crops(monkeypatch):
    from routers import listening
    from types import SimpleNamespace
    block = deepcopy(BINDINGS[TABLE])
    payload = {'variant': 'programme_form_v1', 'source_contract': SOURCE_CONTRACT, 'source_day': 55,
               'source_blocks': [block], 'questions': [{'q_num': 1, 'source_item_id': block['item_ids'][0],
                   'source_block_id': TABLE, 'prompt': 'Festival blank 1', 'response_type': 'short_answer',
                   'options': {}, 'visual_storage_path': 'PRIVATE_CROP_PATH'}],
               'answers': [{'q_num': 1, 'answers': ['PROTECTED_ANSWER']}],
               'self_review': {'1': {'reference_answers': ['PROTECTED_ANSWER']}}}
    monkeypatch.setattr(listening, '_student_audio_url_for_test', lambda _: ('/authorized.mp3', None, 90))
    monkeypatch.setattr(listening, '_sign_programme_visual_url', lambda _: pytest.fail('No PDF crop signing'))
    class Query:
        def __init__(self, table): self.table = table
        def select(self, *_): return self
        def eq(self, *_): return self
        def in_(self, *_): return self
        def order(self, *_): return self
        def execute(self):
            return SimpleNamespace(data=[{'id':'section','section_num':1,'title':'Part'}] if self.table=='listening_content'
                else [{'content_id':'section','order_num':1,'payload':payload}])
    monkeypatch.setattr(listening, 'supabase_admin', SimpleNamespace(table=Query))
    from models.listening_source_collection import SOURCE_PROGRAMME
    result = listening._assemble_listening_player_payload({'id':'native-form','programme_id':SOURCE_PROGRAMME})
    body = json.loads(json.dumps(result))
    assert body['source_blocks'][0]['native']['title'] == 'Festival program'
    assert body['source_blocks'][0]['images'] == []
    assert 'PROTECTED_ANSWER' not in json.dumps(body) and 'PRIVATE_CROP_PATH' not in json.dumps(body)
    assert body['sections'][0]['exercises'][0]['payload']['source_blocks'][0]['native']
