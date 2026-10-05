"""Real quiz-parser policy gates; pure/synthetic transport, no database locks."""
import json
from copy import deepcopy
from unittest.mock import Mock

import pytest
import yaml
from pydantic import ValidationError

from models.grammar_quiz_revisions import ManagedGrammarSessionState
from routers.quiz import StartSessionBody
from services import grammar_quiz_policy as policy, quiz_import, grammar_quiz_session as facade

CODE = 'G-tenses-present-simple'
QUESTION = {'qid': 'form', 'type': 'gap_text', 'input': 'text', 'accept': ['runs']}
META = '''---
kind: quiz
code: G-tenses-present-simple
skill_area: grammar
correct_to_master: 1
require_distinct_skill: false
text_match_by_qid: {form: exact}
---
'''
BLOCK = '''---
id: form
type: gap_text
input: text
headword: form-pool
skill: production
prompt: "Use Present Simple: she ____ (run)."
accept: [runs]
---
'''
SOURCE = META + '\n' + BLOCK


def validate(value, questions=None, **identity):
    return policy.validate_text_match_policy({'text_match_by_qid': value},
        questions if questions is not None else [QUESTION],
        code=identity.get('code', CODE), skill_area=identity.get('skill_area', 'grammar'))


def test_absent_empty_exact_and_explicit_typo_keep_distinct_defensive_shapes():
    assert policy.validate_text_match_policy({}, [QUESTION]) is None
    assert validate({}) == {}
    original = {'form': 'exact'}
    result = validate(original)
    result['form'] = 'typo_tolerant'
    assert original == {'form': 'exact'}
    assert validate({'form': 'typo_tolerant'}) == {'form': 'typo_tolerant'}


@pytest.mark.parametrize('value', [None, [], '', 1, True, {'form': None}, {'form': []},
    {'form': {}}, {'form': True}, {'form': 1}, {'form': 'EXACT'}, {'form': ' exact'},
    {'unknown': 'exact'}, {True: 'exact'}, {1: 'exact'}, {'__proto__': 'exact'},
    {'prototype': 'exact'}, {'constructor': 'exact'}])
def test_present_invalid_map_never_becomes_legacy(value):
    with pytest.raises(policy.GrammarQuizPolicyInvalid):
        validate(value)


@pytest.mark.parametrize('change', [{'input': 'choice'}, {'type': 'mcq'},
    {'accept': []}, {'accept': ['']}, {'accept': ['\x85\x1c']}, {'accept': [1]},
    {'accept': [True]}, {'accept': ['runs', None]}, {'accept': ['\ud800']}, {'qid': 1}, {'qid': ''}])
def test_owned_target_requires_supported_text_and_real_nonempty_accepts(change):
    with pytest.raises(policy.GrammarQuizPolicyInvalid):
        validate({'form': 'exact'}, [{**QUESTION, **change}])


def test_duplicate_owned_qids_fail_even_for_present_empty_map_but_banks_are_local():
    with pytest.raises(policy.GrammarQuizPolicyInvalid):
        validate({}, [QUESTION, deepcopy(QUESTION)])
    assert validate({'form': 'exact'}) == {'form': 'exact'}
    assert validate({'form': 'typo_tolerant'}, code='G-tenses-past-perfect') == {'form': 'typo_tolerant'}


@pytest.mark.parametrize('identity', [{'code': 'G-other'}, {'skill_area': 'vocab'}])
def test_nonempty_policy_is_bounded_to_reviewed_grammar_codes(identity):
    with pytest.raises(policy.GrammarQuizPolicyInvalid):
        validate({'form': 'exact'}, **identity)
    assert validate({}, **identity) == {}


def test_exact_entry_count_and_multibyte_json_byte_boundaries():
    questions = [{**QUESTION, 'qid': f'q{i}'} for i in range(201)]
    assert len(validate({q['qid']: 'exact' for q in questions[:200]}, questions)) == 200
    with pytest.raises(policy.GrammarQuizPolicyInvalid):
        validate({q['qid']: 'exact' for q in questions}, questions)
    # {"<qid>":"exact"} has 12 fixed ASCII bytes, with no spaces/escapes.
    qid = '界' * ((16384 - 12) // 3) + 'a' * ((16384 - 12) % 3)
    assert len(json.dumps({qid: 'exact'}, ensure_ascii=False, separators=(',', ':')).encode()) == 16384
    assert validate({qid: 'exact'}, [{**QUESTION, 'qid': qid}]) == {qid: 'exact'}
    with pytest.raises(policy.GrammarQuizPolicyInvalid):
        validate({qid + '界': 'exact'}, [{**QUESTION, 'qid': qid + '界'}])


RAW_INVALID = [
    SOURCE.replace('text_match_by_qid: {form: exact}', 'text_match_by_qid: {form: exact}\ntext_match_by_qid: {form: exact}'),
    SOURCE.replace('{form: exact}', '{form: exact, form: exact}'),
    SOURCE.replace('{form: exact}', '{form: exact, "\\u0066orm": exact}'),
    SOURCE.replace('text_match_by_qid: {form: exact}', 'text_match_by_qid: &rules {form: exact}\nother: *rules'),
    SOURCE.replace('text_match_by_qid: {form: exact}', 'rules: &rules {form: exact}\ntext_match_by_qid: {<<: *rules}'),
    SOURCE.replace('code: G-tenses-present-simple', 'code: G-tenses-present-simple\ncode: G-tenses-present-simple'),
    META + '\n' + SOURCE,
    SOURCE + '\n' + META.replace('text_match_by_qid: {form: exact}\n', ''),
    META.replace('text_match_by_qid: {form: exact}\n', '') + '\n' + SOURCE,
    SOURCE.replace('id: form', 'id: form\nid: form'),
    SOURCE.replace('accept: [runs]', 'accept: &accepted [runs]'),
    SOURCE.replace('accept: [runs]', 'accept: *missing'),
    SOURCE.replace('accept: [runs]', 'accept: [runs'),
    # Valid absent-map first META cannot hide an unparseable policy declaration.
    META.replace('text_match_by_qid: {form: exact}\n', '') + '\n' + BLOCK + '\n' +
        META.replace('{form: exact}', '[form: exact'),
]


@pytest.mark.parametrize('raw', RAW_INVALID)
def test_raw_guard_precedes_every_safe_load_and_any_transport(raw, monkeypatch):
    forbidden = Mock(side_effect=AssertionError('Invalid raw policy must fail before safe_load/transport'))
    monkeypatch.setattr(yaml, 'safe_load', forbidden)
    monkeypatch.setattr(quiz_import.supabase_admin, 'table', forbidden)
    monkeypatch.setattr(quiz_import.supabase_admin, 'rpc', forbidden)
    result = quiz_import.import_quiz_file(raw, dry_run=False, topic_id='synthetic')
    assert result['validation_errors'] and result['committed_bank_id'] is None
    forbidden.assert_not_called()


def test_real_parser_keeps_actual_meta_and_nonempty_map_commit_has_no_transport(monkeypatch):
    preview = quiz_import.import_quiz_file(SOURCE, dry_run=True)
    assert preview['validation_errors'] == []
    assert preview['meta']['meta']['text_match_by_qid'] == {'form': 'exact'}
    forbidden = Mock(side_effect=AssertionError('Mapped publication requires bounded cutover'))
    monkeypatch.setattr(quiz_import.supabase_admin, 'table', forbidden)
    monkeypatch.setattr(quiz_import.supabase_admin, 'rpc', forbidden)
    blocked = quiz_import.import_quiz_file(SOURCE, dry_run=False, topic_id='synthetic')
    assert blocked['committed_bank_id'] is None
    assert any(e['field'] == 'text_match_by_qid' for e in blocked['validation_errors'])
    forbidden.assert_not_called()


def test_legacy_unmanaged_absent_policy_retains_existing_multiple_meta_contract():
    legacy = SOURCE.replace('text_match_by_qid: {form: exact}\n', '').replace(CODE, 'unmanaged-test')
    second = META.replace('text_match_by_qid: {form: exact}\n', '').replace(CODE, 'unmanaged-test')
    result = quiz_import.import_quiz_file(legacy + '\n' + second, dry_run=True)
    assert result['validation_errors'] == []
    assert 'text_match_by_qid' not in result['meta']['meta']
    with pytest.raises(policy.GrammarQuizPolicyInvalid):
        policy.guard_quiz_source(legacy + '\n' + second, bounded=True)


@pytest.mark.parametrize('marker', [True, 1, 'legacy', [], {}])
def test_concrete_start_capability_rejects_unsupported_or_coerced_marker(marker):
    with pytest.raises(ValidationError):
        StartSessionBody.model_validate({'bank_id': 'old', 'text_match_policy': marker})


def test_frozen_managed_state_bank_echo_is_required_and_capability_is_optional():
    raw = {'canonical_code': CODE, 'bank_id': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'bank_revision': 'a' * 64, 'content_state': 'legacy', 'new_starts_enabled': False,
        'can_continue_legacy': True, 'current_bank_id': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        'current_bank_revision': 'b' * 64}
    assert ManagedGrammarSessionState.model_validate(raw).text_match_policy is None
    assert ManagedGrammarSessionState.model_validate({**raw, 'text_match_policy': 'qid-exact-v1'}).bank_id != \
        ManagedGrammarSessionState.model_validate(raw).current_bank_id
    missing = {k: v for k, v in raw.items() if k != 'bank_id'}
    with pytest.raises(ValidationError):
        ManagedGrammarSessionState.model_validate(missing)


@pytest.mark.parametrize('raw',[None,[],True,{'form':'exact'}])
def test_unmanaged_present_invalid_or_nonempty_map_never_selects_legacy(raw):
    from fastapi import HTTPException
    bank={'code':CODE,'skill_area':'grammar','meta':{'text_match_by_qid':raw}}
    with pytest.raises(HTTPException) as error:
        facade.validate_bank_policy(bank,[QUESTION])
    assert error.value.status_code==503


def test_absent_and_empty_unmanaged_policy_keep_legacy_and_supported_redundant_shape():
    assert facade.validate_bank_policy({'meta':{}}) is None
    assert facade.validate_bank_policy({'meta':{'text_match_by_qid':{}}})=={}
