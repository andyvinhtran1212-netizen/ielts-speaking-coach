"""Omitted and explicit-empty focus keys agree across schema and actual routes."""
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from models.reading_grammar_focus import ReadingGrammarFocusEditItem, ReadingGrammarFocusItem
from routers import admin_reading


OPTIONAL_FIELDS = ('example', 'analysis', 'review', 'tip')
LIMITS = {'example': 5000, 'analysis': 10000, 'review': 5000, 'tip': 3000}
ITEMS = [
    {'point': 'Only a point 🙂'},
    {'point': '  Keep text  ', 'example': '', 'analysis': '  Clause\n→ complement  '},
    {'point': 'All keys', 'example': '', 'analysis': '', 'review': '', 'tip': ''},
]
ADMIN = '00000000-0000-0000-0000-000000000312'
PASSAGE = '00000000-0000-0000-0000-000000000313'
OPERATION = '00000000-0000-0000-0000-000000000314'
REVISION = 'a' * 64
PATH = '/admin/reading/content/passages/sample/grammar-focus'


@pytest.mark.parametrize('model', [ReadingGrammarFocusItem, ReadingGrammarFocusEditItem])
@pytest.mark.parametrize('mode', ['validation', 'serialization'])
def test_optional_keys_have_no_wire_defaults_or_nullable_alternatives(model, mode):
    schema = model.model_json_schema(mode=mode)
    assert schema['required'] == ['point']
    assert schema['additionalProperties'] is False
    for key in OPTIONAL_FIELDS:
        prop = schema['properties'][key]
        assert prop['type'] == 'string'
        assert 'default' not in prop
        assert 'anyOf' not in prop
        if model is ReadingGrammarFocusEditItem:
            assert prop['maxLength'] == LIMITS[key]
    if model is ReadingGrammarFocusEditItem:
        assert schema['properties']['point']['maxLength'] == 500


@pytest.mark.parametrize('model', [ReadingGrammarFocusItem, ReadingGrammarFocusEditItem])
@pytest.mark.parametrize('item', ITEMS)
def test_roundtrip_preserves_omissions_explicit_empty_and_exact_text(model, item):
    parsed = model.model_validate(item)
    assert parsed.model_fields_set == set(item)
    assert parsed.model_dump() == item
    assert parsed.model_dump(mode='json') == item
    assert model.model_validate_json(parsed.model_dump_json()).model_dump() == item


@pytest.mark.parametrize('model', [ReadingGrammarFocusItem, ReadingGrammarFocusEditItem])
@pytest.mark.parametrize('key', OPTIONAL_FIELDS)
@pytest.mark.parametrize('value', [None, False, 1, [], {}])
def test_present_optional_keys_still_require_strict_nonnullable_strings(model, key, value):
    with pytest.raises(ValidationError):
        model.model_validate({'point': 'Valid point', key: value})


@pytest.fixture
def route(monkeypatch):
    async def require_admin(authorization):
        return {'id': ADMIN, 'role': 'admin'}

    monkeypatch.setattr(admin_reading, 'require_admin', require_admin)
    monkeypatch.setattr(admin_reading, '_require_db_engine', lambda: 'existing-engine')
    app = FastAPI()
    app.include_router(admin_reading.router)
    return TestClient(app), app


@pytest.mark.parametrize('item', ITEMS)
def test_actual_read_and_edit_routes_preserve_optional_keys(route, monkeypatch, item):
    client, app = route
    state = {
        'passage_id': PASSAGE, 'slug': 'sample', 'library': 'l1_vocab',
        'title': 'Sample', 'status': 'published', 'body_markdown': 'Ostrom showed…',
        'grammar_focus': [item], 'updated_at': '2026-09-30T08:00:00Z',
        'revision': REVISION, 'source_sha256': 'b' * 64,
        'unrelated_metadata_sha256': 'c' * 64, 'questions_sha256': 'd' * 64,
    }
    result = {key: state[key] for key in (
        'passage_id', 'slug', 'library', 'updated_at', 'grammar_focus',
        'source_sha256', 'unrelated_metadata_sha256', 'questions_sha256',
    )}
    result.update(
        outcome='updated', operation_id=OPERATION, committed_revision=REVISION,
        current_revision=REVISION, current_matches_committed=True,
        current_source_sha256=state['source_sha256'],
        current_unrelated_metadata_sha256=state['unrelated_metadata_sha256'],
        current_questions_sha256=state['questions_sha256'],
    )
    read = AsyncMock(return_value=state)
    edit = AsyncMock(return_value=result)
    monkeypatch.setattr(admin_reading, 'read_focus', read)
    monkeypatch.setattr(admin_reading, 'edit_focus', edit)

    response = client.get(PATH, headers={'Authorization': 'Bearer admin'})
    assert response.status_code == 200
    assert response.json()['grammar_focus'] == [item]
    read.assert_awaited_once_with('existing-engine', 'sample')

    payload = {'expected_revision': REVISION, 'operation_id': OPERATION, 'grammar_focus': [item]}
    response = client.patch(PATH, json=payload, headers={'Authorization': 'Bearer admin'})
    assert response.status_code == 200
    assert response.json()['grammar_focus'] == [item]
    args = edit.await_args.args
    assert args[:3] == ('existing-engine', 'sample', ADMIN)
    assert args[3].model_dump(mode='json') == payload

    schemas = app.openapi()['components']['schemas']
    for name in ('ReadingGrammarFocusItem', 'ReadingGrammarFocusEditItem'):
        assert schemas[name]['required'] == ['point']
        for key in OPTIONAL_FIELDS:
            assert schemas[name]['properties'][key]['type'] == 'string'
            assert 'default' not in schemas[name]['properties'][key]
