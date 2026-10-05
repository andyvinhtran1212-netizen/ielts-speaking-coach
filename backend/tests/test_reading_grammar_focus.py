"""Strict request, projection/fingerprint and safe unavailable contracts."""
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from pydantic import ValidationError

from models.reading_grammar_focus import (
    ReadingGrammarFocusEditRequest, ReadingGrammarFocusItem,
)
from services import reading_grammar_focus as service


def request(**changes):
    return {'expected_revision': 'a' * 64, 'operation_id': str(uuid4()),
            'grammar_focus': [{'point': 'Complex sentence', 'analysis': 'Main clause.'}], **changes}


def state_row(**changes):
    return {'id': uuid4(), 'slug': 'synthetic-reading', 'library': 'l1_vocab',
            'title': 'Synthetic source', 'status': 'published',
            'body_markdown': 'Ostrom showed that communities had managed resources.',
            'metadata': {'translation_vi': 'Bản dịch', 'grammar_focus': [{'point': 'Grammar'}]},
            'updated_at': datetime(2026, 9, 30, tzinfo=timezone.utc), **changes}


@pytest.mark.parametrize('changes', [
    {'unknown': 'ignored?'}, {'expected_revision': None}, {'expected_revision': 123},
    {'expected_revision': 'bad'}, {'operation_id': None}, {'operation_id': 'not-a-uuid'},
    {'grammar_focus': None}, {'grammar_focus': {}}, {'grammar_focus': [None]},
    {'grammar_focus': [{'point': ''}]}, {'grammar_focus': [{'point': ' \n '}]},
    {'grammar_focus': [{'point': 123}]}, {'grammar_focus': [{'point': 'x', 'analysis': None}]},
    {'grammar_focus': [{'point': 'x', 'example': 3}]},
    {'grammar_focus': [{'point': 'x', 'unknown': 'value'}]},
    {'grammar_focus': [{'point': 'x'}] * 21},
    {'grammar_focus': [{'point': 'x' * 501}]},
    {'grammar_focus': [{'point': 'x', 'example': 'x' * 5001}]},
    {'grammar_focus': [{'point': 'x', 'analysis': 'x' * 10001}]},
    {'grammar_focus': [{'point': 'x', 'review': 'x' * 5001}]},
    {'grammar_focus': [{'point': 'x', 'tip': 'x' * 3001}]},
    {'grammar_focus': [{'point': 'x', 'analysis': '越' * 10000}] * 10},
])
def test_request_rejects_malformed_unknown_oversize_and_multibyte_input(changes):
    with pytest.raises(ValidationError):
        ReadingGrammarFocusEditRequest.model_validate(request(**changes))


def test_request_preserves_unicode_text_order_omitted_and_explicit_empty_optional_keys():
    focus = [{'point': '  Ngữ pháp 🙂  ', 'analysis': '  showed\n→ had managed  '},
             {'point': 'Ngữ pháp 🙂', 'example': '', 'tip': 'Đừng mất dấu'}]
    parsed = ReadingGrammarFocusEditRequest.model_validate(request(grammar_focus=focus))
    assert parsed.model_dump(mode='json')['grammar_focus'] == focus
    assert ReadingGrammarFocusEditRequest.model_validate(request(grammar_focus=[])).grammar_focus == []
    assert ReadingGrammarFocusItem.model_validate({'point': 'legacy', 'analysis': 'x' * 11000}).analysis == 'x' * 11000


def test_stable_fingerprints_include_all_source_metadata_and_question_values_without_projection_leaks():
    row = state_row(image_url='https://example.test/image', glossary=[{'term': 'commons'}])
    question = {'id': str(uuid4()), 'answer': {'answer': 'PRIVATE_ANSWER'}, 'payload': {'nested': [1, 2]}}
    first = service._state(row, [question])
    reordered = {**row, 'metadata': dict(reversed(list(row['metadata'].items())))}
    assert service._state(reordered, [{key: question[key] for key in reversed(question)}]).revision == first.revision
    for changed in [
        {**row, 'body_markdown': 'Changed body'}, {**row, 'title': 'Changed title'},
        {**row, 'glossary': []},
        {**row, 'metadata': {**row['metadata'], 'translation_vi': 'Dịch khác'}},
    ]:
        assert service._state(changed, [question]).revision != first.revision
    assert service._state(row, [{**question, 'answer': {'answer': 'OTHER_PRIVATE'}}]).revision != first.revision
    projected = first.public().model_dump_json()
    for private in ('PRIVATE_ANSWER', 'translation_vi', 'glossary', 'image_url'):
        assert private not in projected


@pytest.mark.parametrize('metadata', [[], None, 'invalid', {'grammar_focus': {}},
    {'grammar_focus': [{'point': 'x', 'tip': None}]}, {'grammar_focus': [{'point': ' '}]},
    {'grammar_focus': [{'point': 'x', 'unknown': 'value'}]}])
def test_malformed_canonical_state_is_explicit_unavailable(metadata):
    with pytest.raises(service.ReadingGrammarFocusError) as error:
        service._state(state_row(metadata=metadata), [])
    assert error.value.status_code == 503
    assert error.value.error_code == 'reading_grammar_focus_invalid_state'


@pytest.mark.parametrize('metadata', [{}, {'grammar_focus': None}, {'grammar_focus': []}])
def test_valid_legacy_empty_focus_never_rewrites_metadata_on_read(metadata):
    state = service._state(state_row(metadata=metadata), [])
    assert state.public().grammar_focus == []
    assert state.row['metadata'] == metadata


def test_malformed_source_timestamp_fails_before_mutation():
    with pytest.raises(service.ReadingGrammarFocusError):
        service._state(state_row(updated_at=datetime(2026, 9, 30)), [])
    with pytest.raises(service.ReadingGrammarFocusError):
        service._state(state_row(status='unknown'), [])


@pytest.mark.asyncio
async def test_missing_configured_engine_is_safe_unavailable_for_read_and_edit():
    parsed = ReadingGrammarFocusEditRequest.model_validate(request())
    for operation in [service.read_focus(None, 'synthetic'), service.edit_focus(None, 'synthetic', uuid4(), parsed)]:
        with pytest.raises(service.ReadingGrammarFocusError) as error:
            await operation
        assert error.value.status_code == 503
        assert error.value.as_detail() == {'error_code': 'reading_grammar_focus_unavailable',
                                         'message': 'Chưa có kết nối transaction Reading khả dụng. Chưa lưu thay đổi.'}
