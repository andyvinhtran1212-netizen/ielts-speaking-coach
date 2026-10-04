"""Reviewed-source/parser contracts, never transport or production writes."""
from pathlib import Path

import pytest
from pydantic import ValidationError

from models.grammar_quiz_revisions import (
    GrammarRevisionCommitRequest, GrammarRevisionPreviewRequest,
)
from services import grammar_quiz_revision_source as source

BANKS = Path(__file__).resolve().parents[2] / 'docs/grammar-quiz-banks'


@pytest.mark.parametrize('code', source.REVIEWED_SOURCES)
def test_all_twelve_exact_sources_pass_real_parser_preserve_ids_order_and_integer_boolean(code, monkeypatch):
    def no_transport(*args, **kwargs):
        raise AssertionError('Reviewed Grammar source parsing must stay offline')
    monkeypatch.setattr(source.quiz_import.supabase_admin, 'table', no_transport)
    monkeypatch.setattr(source.quiz_import.supabase_admin, 'rpc', no_transport)
    parsed = source.parse_reviewed_source(code, (BANKS / (code + '.md')).read_text())
    assert parsed.metadata['code'] == code and parsed.metadata['skill_area'] == 'grammar'
    assert len({q['qid'] for q in parsed.questions}) == len(parsed.questions)
    assert [q['order'] for q in parsed.questions] == list(range(len(parsed.questions)))
    assert all(type(q['answer']) is int and q['answer'] in (0, 1)
               for q in parsed.questions if q['input'] == 'boolean')
    assert parsed.metadata['meta'].get('text_match_by_qid', {}) == source.REVIEWED_TEXT_MAPS[code]
    assert source.compare_reviewed_questions(parsed, parsed.questions) == []


def test_reviewed_stative_answer_identity_and_real_error_controls():
    def questions(code):
        return {q['qid']: q for q in source.parse_reviewed_source(code, (BANKS / (code + '.md')).read_text()).questions}
    continuous = questions('G-tenses-present-continuous')
    assert continuous['pc_stative_a1']['answer'] == 1  # contextual I'm loving
    assert continuous['pc_stative_a2']['answer'] == 0  # malformed is want
    past = questions('G-tenses-past-continuous')
    assert past['pc_stative_a1']['answer'] == 1
    assert past['pc_stative_a2']['answer'] == 0  # knowing the truth remains invalid
    perfect = questions('G-tenses-present-perfect-continuous')
    assert perfect['ppc_stative_a2']['answer'] == 1
    assert perfect['ppc_stative_i1']['options'][perfect['ppc_stative_i1']['answer']] == 'has been wanting'


def test_raw_source_hash_rejects_unreviewed_key_or_whitespace_change_and_other_code():
    code = 'G-tenses-present-simple'
    raw = (BANKS / (code + '.md')).read_text()
    for proposed_code, proposed in [(code, raw + '\n'), (code, raw.replace('answer:', 'arbitrary:')),
                                     ('G-tenses-future-simple', raw)]:
        with pytest.raises(source.GrammarSourceInvalid):
            source.parse_reviewed_source(proposed_code, proposed)


def test_canonical_diff_refuses_wider_set_or_mastery_change_but_keeps_reviewed_edit():
    code = 'G-tenses-present-simple'
    parsed = source.parse_reviewed_source(code, (BANKS / (code + '.md')).read_text())
    original = [{**q} for q in parsed.questions]
    affected = next(q for q in original if q['qid'] == 'ps_vspc_a1')
    affected['answer'] = 0
    changes = source.compare_reviewed_questions(parsed, original)
    assert [(q['qid'], q['fields']) for q in changes] == [('ps_vspc_a1', ['answer'])]
    for key, value in [('item_key', 'other-concept'), ('counts_toward_mastery', False), ('order', 900)]:
        changed = [{**q} for q in original]
        next(q for q in changed if q['qid'] == 'ps_vspc_a1')[key] = value
        with pytest.raises(source.GrammarSourceInvalid):
            source.compare_reviewed_questions(parsed, changed)
    changed = [{**q} for q in original]
    next(q for q in changed if q['qid'] == 'ps_3s_b2')['prompt'] = 'Unreviewed unrelated content'
    with pytest.raises(source.GrammarSourceInvalid):
        source.compare_reviewed_questions(parsed, changed)
    with pytest.raises(source.GrammarSourceInvalid):
        source.compare_reviewed_questions(parsed, original[:-1])


def test_named_question_does_not_authorize_other_fields_or_another_banks_qid():
    parsed = source.parse_reviewed_source('G-tenses-present-simple',
        (BANKS / 'G-tenses-present-simple.md').read_text())
    before = [{**q} for q in parsed.questions]
    # ps_3s_i2's requested-form prompt is reviewed, its accepted set is retained.
    next(q for q in before if q['qid'] == 'ps_3s_i2')['accept'] = ['unreviewed extra form']
    with pytest.raises(source.GrammarSourceInvalid):
        source.compare_reviewed_questions(parsed, before)


@pytest.mark.parametrize('changes', [{'arbitrary_bank_id': 'other'}, {'source_markdown': None},
    {'source_markdown': 3}, {'expected_revision': 'F' * 64}, {'source_markdown': '界' * 90000}])
def test_strict_preview_contract_rejects_unknown_null_coercion_invalid_hash_and_multibyte_oversize(changes):
    with pytest.raises(ValidationError):
        GrammarRevisionPreviewRequest.model_validate({'source_markdown': 'source',
                                                     'expected_revision': 'a' * 64, **changes})


def test_commit_requires_real_uuid_and_preview_fingerprint():
    with pytest.raises(ValidationError):
        GrammarRevisionCommitRequest.model_validate({'source_markdown': 'source',
            'expected_revision': 'a' * 64, 'preview_fingerprint': 'b' * 64, 'operation_id': 'guess'})
