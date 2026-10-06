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

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/listening_source_round1/native-presentation-bindings.json').read_text())
BINDINGS = FIXTURE['blocks']
SOURCE_MANIFEST = FIXTURE['source_manifest_sha256']
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
    delivered = collection.sign_source_block(safe, lambda _: pytest.fail('No archival raster signing'), manifest_sha256=SOURCE_MANIFEST)
    assert delivered['images'] == []
    assert delivered['native']['title'] == 'Festival program'
    assert len(delivered['native']['rows']) == 10
    assert delivered['native']['rows'][1] == ['Claude and Jacques', 'mime artists', '3', '8:00']
    block.pop('native')
    assert block == original


@pytest.mark.parametrize('mutation', [lambda b: b['instruction'].update(word_limit=99), lambda b: b['item_ids'].reverse(), lambda b: b['images'][0].update(storage_path='source-collections/other/revision.png')])
def test_changed_source_cannot_receive_native_content_or_crop_fallback(mutation):
    block = deepcopy(BINDINGS[TABLE]); mutation(block)
    result = collection.sign_source_block(block, lambda _: pytest.fail('No crop fallback'), manifest_sha256=SOURCE_MANIFEST)
    assert result['native'] is None and result['images'] == []


@pytest.mark.parametrize('block_id', [
    '80-days:day-01:part-1:block-2',
    '80-days:day-01:part-2:block-1',
    '80-days:day-80:part-1:block-fishing-summary',
])
def test_native_crop_directions_are_source_bound_and_preserve_word_limits(block_id):
    assert len([value for value in native.revision()['blocks'].values() if value.get('instruction_vi')]) == 3
    block = deepcopy(BINDINGS[block_id])
    before = deepcopy(block)
    delivered = collection.sign_source_block(block, lambda _: pytest.fail('No crop'), manifest_sha256=SOURCE_MANIFEST)
    assert delivered['instruction']['student_vi'] == native.revision()['blocks'][block_id]['instruction_vi']
    assert delivered['instruction']['word_limit'] == before['instruction'].get('word_limit')
    assert delivered['instruction']['source_en'] == before['instruction']['source_en']
    assert block == before
    block['instruction']['student_vi'] += ' Changed source.'
    assert native.native_instruction_vi(block, manifest_sha256=SOURCE_MANIFEST) is None


@pytest.mark.parametrize('body', ['<script>alert(1)</script>', '<image href="https://external/x.png"/>', '<foreignObject/>', '<rect onclick="alert(1)"/>', '<rect fill="url(https://external)"/>'])
def test_svg_rejects_executable_or_external_content(body):
    with pytest.raises(ValueError): native.validate_svg(f'<svg xmlns="http://www.w3.org/2000/svg">{body}</svg>')


@pytest.mark.parametrize('manifest', [SOURCE_MANIFEST, None, 'b'*64])
def test_authenticated_day_and_explicit_study_serialization(monkeypatch, manifest):
    block = deepcopy(BINDINGS[RESOURCE]); full = native.native_presentation(block, study_opened=True, manifest_sha256=SOURCE_MANIFEST)
    assert full and full['text'] and full['figures']
    lesson = {'id': 'lesson', 'sequence_num': 60, 'title': 'Day 60', 'metadata': {'source_book': {
        'source_contract': SOURCE_CONTRACT, 'group': 'teaching', 'availability': {}, 'source_position_count': 0,
        'source_only_count': 0, 'parts': [], 'blocks': [block]}, 'source_study': {
        RESOURCE: {'resource_only': True, 'items': [], 'description': 'Opened study', 'transcript': []}}}}
    package = {'package_id': 'source', 'manifest_sha256': manifest or ''}
    calls = []
    async def auth(token):
        if token != 'Bearer learner': raise HTTPException(401, 'Sign in')
        calls.append('auth'); return {'id': 'learner'}
    monkeypatch.setattr(router, 'get_supabase_user', auth)
    monkeypatch.setattr(router, '_context', lambda day: (calls.append('content') or package, [lesson]))
    monkeypatch.setattr(collection, 'source_forms', lambda *_: [])
    from routers import listening
    monkeypatch.setattr(listening, '_programme_attempt_state', lambda *_: ({}, False))
    def generated_only(path):
        assert '/figures/gpt-v1/' in path
        return 'https://private.example/generated.png'
    monkeypatch.setattr(router, '_sign', generated_only)
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
            assert opened.json()['blocks'][0]['native'] == ({**full, 'figures': []} if manifest == SOURCE_MANIFEST else None)
            images = opened.json()['blocks'][0]['images']
            assert len(images) == (len(full['figures']) if manifest == SOURCE_MANIFEST else 0)
            assert all(image['asset_id'].startswith('gpt-v1:') for image in images)
    asyncio.run(check())


@pytest.mark.parametrize('manifest, mutation, package_present', [
    (SOURCE_MANIFEST, None, True), (None, None, True), ('c'*64, None, True),
    (SOURCE_MANIFEST, None, False), (SOURCE_MANIFEST, 'prompt', True),
    (SOURCE_MANIFEST, 'options', True), (SOURCE_MANIFEST, 'fields', True),
])
def test_serialized_player_boundary_uses_native_blocks_without_answers_or_signed_crops(monkeypatch, manifest, mutation, package_present):
    from routers import listening
    from types import SimpleNamespace
    block = deepcopy(BINDINGS[TABLE])
    payload = {'variant': 'programme_form_v1', 'source_contract': SOURCE_CONTRACT, 'source_day': 55,
               'source_blocks': [block], 'questions': deepcopy(FIXTURE['practice_questions'][TABLE]),
               'answers': [{'q_num': 1, 'answers': ['PROTECTED_ANSWER']}],
               'self_review': {'1': {'reference_answers': ['PROTECTED_ANSWER']}}}
    if mutation == 'prompt': payload['questions'][0]['prompt'] += ' different question'
    if mutation == 'options': payload['questions'][0]['options'] = {'A': 'Different option'}
    if mutation == 'fields': payload['questions'][0]['fields'] = [{'field_id':'new','prompt':'Different blank'}]
    payload['questions'][0]['visual_storage_path'] = 'PRIVATE_CROP_PATH'
    monkeypatch.setattr(listening, '_student_audio_url_for_test', lambda _: ('/authorized.mp3', None, 90))
    monkeypatch.setattr(listening, '_sign_programme_visual_url', lambda _: pytest.fail('No PDF crop signing'))
    class Query:
        def __init__(self, table): self.table = table; self.filters = []
        def select(self, *_): return self
        def eq(self, key, value): self.filters.append((key, value)); return self
        def in_(self, *_): return self
        def order(self, *_): return self
        def limit(self, *_): return self
        def execute(self):
            if self.table == 'listening_content_packages':
                assert ('id', 'canonical-package') in self.filters
                assert ('status', 'published') in self.filters
                assert ('programme_id', 'ielts-80-days-listening') in self.filters
                return SimpleNamespace(data=[{'manifest_sha256': manifest}])
            return SimpleNamespace(data=[{'id':'section','section_num':1,'title':'Part'}] if self.table=='listening_content'
                else [{'content_id':'section','order_num':1,'payload':payload}])
    monkeypatch.setattr(listening, 'supabase_admin', SimpleNamespace(table=Query))
    from models.listening_source_collection import SOURCE_PROGRAMME
    result = listening._assemble_listening_player_payload({'id':'native-form','programme_id':SOURCE_PROGRAMME,'content_package_id':'canonical-package' if package_present else None, 'manifest_sha256':SOURCE_MANIFEST})
    body = json.loads(json.dumps(result))
    expected_native = manifest == SOURCE_MANIFEST and package_present and mutation is None
    assert bool(body['source_blocks'][0]['native']) is expected_native
    if expected_native: assert body['source_blocks'][0]['native']['title'] == 'Festival program'
    assert body['source_blocks'][0]['images'] == []
    assert 'PROTECTED_ANSWER' not in json.dumps(body) and 'PRIVATE_CROP_PATH' not in json.dumps(body)
    assert bool(body['sections'][0]['exercises'][0]['payload']['source_blocks'][0]['native']) is expected_native


@pytest.mark.parametrize('manifest', [None, '', 'a'*64])
def test_missing_or_wrong_manifest_never_receives_native_or_instruction_overrides(manifest):
    for block_id in [TABLE, RESOURCE, '80-days:day-01:part-1:block-2']:
        block = deepcopy(BINDINGS[block_id])
        result = collection.sign_source_block(block, lambda _: pytest.fail('No raster fallback'),
            study_opened=True, manifest_sha256=manifest)
        assert result['native'] is None and result['images'] == []
        assert native.native_instruction_vi(block, manifest_sha256=manifest) is None
        assert result['instruction']['student_vi'] == block['instruction']['student_vi']


@pytest.mark.parametrize('mutation', [
    lambda qs: qs[0].update(prompt=qs[0]['prompt']+' changed'),
    lambda qs: qs[0].update(options={'A':'Changed option'}),
    lambda qs: qs[0].update(fields=[{'field_id':'different','prompt':'Changed blank'}]),
    lambda qs: qs[0].update(source_display_number='99'),
    lambda qs: qs.pop(),
    lambda qs: qs.append(deepcopy(qs[0])),
])
def test_changed_runtime_question_display_does_not_receive_native(mutation):
    block = deepcopy(BINDINGS[TABLE]); questions = deepcopy(FIXTURE['practice_questions'][TABLE])
    assert native.native_presentation(block, manifest_sha256=SOURCE_MANIFEST, runtime_questions=questions)
    mutation(questions)
    result = collection.sign_source_block(block, lambda _: pytest.fail('No crop fallback'),
        manifest_sha256=SOURCE_MANIFEST, runtime_questions=questions)
    assert result['native'] is None and result['images'] == []


def test_question_binding_contains_only_display_fields_and_all_eligible_positions():
    expected = [item_id for row in native.revision()['blocks'].values() for item_id in row.get('practice_question_sha256', {})]
    assert len(expected) == 1572 == len(set(expected))
    question = deepcopy(FIXTURE['practice_questions'][TABLE][0])
    baseline = native.display_question_digest(question)
    question.update(answer='HIDDEN', explanation={'answer':'HIDDEN'}, transcript='HIDDEN')
    question['fields'] = [{**field, 'answer':'HIDDEN'} for field in question.get('fields') or []]
    assert native.display_question_digest(question) == baseline
