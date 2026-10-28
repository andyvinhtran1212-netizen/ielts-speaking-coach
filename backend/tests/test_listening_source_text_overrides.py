"""Reviewed source text overrides replace only the audited stray CJK fragments."""
from copy import deepcopy
import asyncio
import hashlib
import json
import re
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI, HTTPException
import httpx
import pytest
from models.listening_source_collection import SOURCE_CONTRACT, SOURCE_PROGRAMME
from routers import listening_source_collection as router
from services import listening_source_collection as collection
from services import listening_source_native as native
from services import listening_source_text_overrides as overrides

FIXTURES = Path(__file__).parent / 'fixtures/listening_source_round1'
BINDINGS = json.loads((FIXTURES / 'native-presentation-bindings.json').read_text())
SOURCES = json.loads((FIXTURES / 'text-override-sources.json').read_text())
MANIFEST = SOURCES['source_manifest_sha256']
CJK = re.compile('[　-〿぀-ヿ㐀-䶿一-鿿가-힯＀-￯]')
DAY1 = '80-days:day-01:part-1:block-2'
DAY37 = '80-days:day-37:part-1:block-1'
DAY48 = '80-days:day-48:resource:part-time-story'
STORIES = [f'80-days:day-{day}:story-1' for day in (63, 64, 66, 68)]
HEADING = 'IELTS Authentic Listening — Story Edition'
BLOCKS = {**SOURCES['blocks'], DAY1: BINDINGS['blocks'][DAY1]}


def audited_sources():
    """The exact staging texts the CJK audit reported as learner-visible."""
    yield DAY1, None, 'instruction.source_en', BLOCKS[DAY1]['instruction']['source_en']
    question = next(q for q in SOURCES['practice_questions'][DAY37] if q['source_item_id'] == '80-days:day-37:main:q-07')
    yield DAY37, question['source_item_id'], 'options.D', question['options']['D']
    yield DAY48, None, 'description', SOURCES['study'][DAY48]['description']
    for block_id in STORIES:
        yield block_id, None, 'instruction.source_en', BLOCKS[block_id]['instruction']['source_en']


def test_revision_is_bound_to_the_native_manifest_and_covers_only_the_audited_strings():
    content = json.loads(overrides.CONTENT.read_text(encoding='utf-8'))
    assert content['source_manifest_sha256'] == native.revision()['source_manifest_sha256'] == MANIFEST
    keys = {(row['block_id'], row.get('item_id'), row['field']) for row in content['overrides']}
    assert keys == {(block_id, item_id, field) for block_id, item_id, field, _ in audited_sources()}
    assert all(block_id in native.revision()['blocks'] for block_id, _, _ in keys)
    # Day 55's printed key keeps the book's own "、"; no override may target it.
    assert not any(row['block_id'].startswith('80-days:day-55:') for row in content['overrides'])


@pytest.mark.parametrize('block_id, item_id, field, original', list(audited_sources()))
def test_each_audited_text_loses_only_its_cjk_fragment(block_id, item_id, field, original):
    row = overrides.revision()['index'][(block_id, item_id, field)]
    assert hashlib.sha256(original.encode()).hexdigest() == row['source_sha256']
    corrected = overrides.override_text(original, field=field, block_id=block_id, item_id=item_id, manifest_sha256=MANIFEST)
    assert CJK.search(original) and not CJK.search(corrected)
    assert corrected == original.replace(row['find'], row['replace'])


def test_reviewed_wording():
    texts = {block_id: overrides.override_text(original, field=field, block_id=block_id, item_id=item_id, manifest_sha256=MANIFEST)
             for block_id, item_id, field, original in audited_sources()}
    assert texts[DAY1].endswith('connect the number of the word you hear with its synonym (từ đồng nghĩa).')
    assert texts[DAY37] == 'The room is full of people.'
    assert 'không cho người dưới năm hai làm việc bán thời gian. Có việc Sports Center' in texts[DAY48]
    assert all(texts[block_id] == HEADING for block_id in STORIES)


@pytest.mark.parametrize('mutation', [
    lambda kw: kw.update(manifest_sha256=None), lambda kw: kw.update(manifest_sha256=''),
    lambda kw: kw.update(manifest_sha256='a' * 64), lambda kw: kw.update(value=kw['value'] + ' '),
    lambda kw: kw.update(block_id='80-days:day-01:part-1:block-1'), lambda kw: kw.update(field='options.A'),
    lambda kw: kw.update(item_id='80-days:day-37:main:q-06'),
])
def test_other_manifests_sources_or_targets_are_returned_unchanged(mutation):
    for block_id, item_id, field, original in audited_sources():
        kwargs = {'value': original, 'field': field, 'block_id': block_id, 'item_id': item_id, 'manifest_sha256': MANIFEST}
        mutation(kwargs)
        assert overrides.override_text(**kwargs) == kwargs['value']


def lesson(day, block_id):
    return {'id': f'lesson-{day}', 'sequence_num': day, 'title': f'Day {day}', 'metadata': {'source_book': {
        'source_contract': SOURCE_CONTRACT, 'group': 'vocabulary', 'availability': {}, 'source_position_count': 0,
        'source_only_count': 0, 'parts': [], 'blocks': [deepcopy(BLOCKS[block_id])]},
        'source_study': {block_id: deepcopy(SOURCES['study'][block_id])}}}


@pytest.mark.parametrize('block_id', [DAY48, *STORIES])
@pytest.mark.parametrize('manifest', [MANIFEST, 'b' * 64])
def test_day_and_opened_study_serialize_the_correction_with_native_still_bound(monkeypatch, block_id, manifest):
    day = int(block_id.split(':')[1].removeprefix('day-'))
    package = {'package_id': 'source', 'manifest_sha256': manifest}
    async def auth(token):
        if token != 'Bearer learner': raise HTTPException(401, 'Sign in')
        return {'id': 'learner'}
    monkeypatch.setattr(router, 'get_supabase_user', auth)
    monkeypatch.setattr(router, '_context', lambda _: (package, [lesson(day, block_id)]))
    monkeypatch.setattr(collection, 'source_forms', lambda *_, **kwargs: [])
    from routers import listening
    monkeypatch.setattr(listening, '_programme_attempt_state', lambda *_: ({}, False))
    monkeypatch.setattr(router, '_sign', lambda _: pytest.fail('No archival raster signing'))
    app = FastAPI(); app.include_router(router.router)
    headers = {'Authorization': 'Bearer learner'}
    async def check():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://fixture') as client:
            path = f'/api/listening/source-collections/80-days/days/{day}'
            before = await client.get(path, headers=headers)
            assert before.status_code == 200 and not CJK.search(before.text)
            opened = await client.post(path + '/study', json={'block_ids': [block_id]}, headers=headers)
            assert opened.status_code == 200
            delivered = opened.json()['blocks'][0]
            bound = manifest == MANIFEST
            assert bool(delivered['native']) is bound
            source_en = BLOCKS[block_id]['instruction']['source_en']
            description = SOURCES['study'][block_id]['description']
            if block_id == DAY48:
                assert delivered['description'] == (description.replace('làm兼职', 'làm việc bán thời gian') if bound else description)
                assert delivered['instruction']['source_en'] == source_en
            else:
                assert delivered['instruction']['source_en'] == (HEADING if bound else source_en)
                assert delivered['description'] == description
            assert (CJK.search(opened.text) is None) is bound
    asyncio.run(check())


@pytest.mark.parametrize('block_id', [DAY1, DAY37])
@pytest.mark.parametrize('manifest', [MANIFEST, 'c' * 64])
def test_player_corrects_text_after_binding_native_to_the_original_questions(monkeypatch, block_id, manifest):
    from routers import listening
    questions = deepcopy((BINDINGS if block_id == DAY1 else SOURCES)['practice_questions'][block_id])
    original_questions = deepcopy(questions)
    payload = {'variant': 'programme_form_v1', 'source_contract': SOURCE_CONTRACT,
               'source_day': int(block_id.split(':')[1].removeprefix('day-')),
               'source_blocks': [deepcopy(BLOCKS[block_id])], 'questions': questions}
    monkeypatch.setattr(listening, '_student_audio_url_for_test', lambda _: ('/authorized.mp3', None, 90))
    monkeypatch.setattr(listening, '_sign_programme_visual_url', lambda _: pytest.fail('No PDF crop signing'))
    class Query:
        def __init__(self, table): self.table = table
        def select(self, *_): return self
        def eq(self, *_): return self
        def in_(self, *_): return self
        def order(self, *_): return self
        def limit(self, *_): return self
        def execute(self):
            if self.table == 'listening_content_packages':
                return SimpleNamespace(data=[{'manifest_sha256': manifest}])
            return SimpleNamespace(data=[{'id': 'section', 'section_num': 1, 'title': 'Part'}] if self.table == 'listening_content'
                                   else [{'content_id': 'section', 'order_num': 1, 'payload': payload}])
    monkeypatch.setattr(listening, 'supabase_admin', SimpleNamespace(table=Query))
    result = listening._assemble_listening_player_payload({'id': 'form', 'programme_id': SOURCE_PROGRAMME,
                                                           'content_package_id': 'canonical-package'})
    body = json.loads(json.dumps(result))
    bound = manifest == MANIFEST
    # Native binding is computed on the original rows, so the correction cannot unbind it.
    assert bool(body['source_blocks'][0]['native']) is bound
    delivered = body['sections'][0]['exercises'][0]['payload']['questions']
    source_en = BLOCKS[block_id]['instruction']['source_en']
    if block_id == DAY1:
        assert delivered == original_questions
        assert body['source_blocks'][0]['instruction']['source_en'] == (source_en.replace('(同义词)', '(từ đồng nghĩa)') if bound else source_en)
    else:
        assert body['source_blocks'][0]['instruction']['source_en'] == source_en
        expected = deepcopy(original_questions)
        if bound:
            expected[6]['options']['D'] = 'The room is full of people.'
        assert [q['options'] for q in delivered] == [q['options'] for q in expected]
    assert (CJK.search(json.dumps(body, ensure_ascii=False)) is None) is bound
    assert payload['questions'] == original_questions
