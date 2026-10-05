"""Frozen policy contracts preserve old work and fail before incompatible writes."""
from __future__ import annotations

import copy
import hashlib

import pytest

from services.dictation_grading_version import (
    DictationPolicyError, LEGACY_POLICY_VERSION, frozen_contract,
    grade_frozen_sentence, reference_sha256, require_write_contract,
    text_sha256, validate_new_lexical_source,
)
from services.listening_grader import grade_dictation


UNITS = [{'text': '— Hello there.', 'start': 0, 'end': 3, 'hints': []}]


def attempt(version='lexical-v2'):
    return {'grading_version': version, 'reference_sha256': reference_sha256(UNITS),
            'units_snapshot': copy.deepcopy(UNITS)}


def assert_policy_error(action, status, code):
    with pytest.raises(DictationPolicyError) as caught:
        action()
    assert (caught.value.status_code, caught.value.code) == (status, code)


def test_reference_digest_uses_exact_ordered_texts_not_timing_hints_or_boundaries():
    digest = hashlib.sha256(('dictation-texts-v1\n' + text_sha256(UNITS[0]['text'])).encode()).hexdigest()
    assert reference_sha256(UNITS) == digest
    changed = copy.deepcopy(UNITS)
    changed[0].update(start=9, end=None, hints=['unrelated'])
    assert reference_sha256(changed) == digest
    assert reference_sha256([{'text': 'ab'}, {'text': 'c'}]) != reference_sha256([{'text': 'a'}, {'text': 'bc'}])
    assert reference_sha256([{'text': 'a'}, {'text': 'b'}]) != reference_sha256([{'text': 'b'}, {'text': 'a'}])
    assert reference_sha256([{'text': 'café'}]) != reference_sha256([{'text': 'cafe\u0301'}])


@pytest.mark.parametrize('units', [None, {}, [], [None], [{'text': None}], [{'text': 1}],
                                  [{'text': 'a'}] * 201])
def test_malformed_frozen_source_is_explicitly_unavailable(units):
    assert_policy_error(lambda: reference_sha256(units), 503, 'dictation_reference_unavailable')


@pytest.mark.parametrize('version', [None, LEGACY_POLICY_VERSION])
def test_unversioned_and_explicit_legacy_preserve_existing_whitespace_score(version):
    row = {'units_snapshot': copy.deepcopy(UNITS), 'grading_version': version}
    assert frozen_contract(row) == {'grading_version': LEGACY_POLICY_VERSION, 'reference_sha256': None}
    result = grade_frozen_sentence(row, 0, 'Hello there.', grading_version=None,
                                   acknowledged_reference_sha256=None)
    baseline = grade_dictation(reference_transcript=UNITS[0]['text'], user_transcript='Hello there.', ignore_fillers=True)
    assert {key: result[key] for key in baseline} == baseline
    assert result['total_words'] == 3
    assert result['grading_version'] == LEGACY_POLICY_VERSION
    assert row['units_snapshot'] == UNITS


@pytest.mark.parametrize('version', ['unknown', '', True, [], {}])
def test_unknown_persisted_policy_fails_closed_even_with_valid_digest(version):
    row = attempt()
    row['grading_version'] = version
    assert_policy_error(lambda: frozen_contract(row), 503, 'dictation_policy_unavailable')


def test_digest_without_version_is_corruption_not_guessed_legacy():
    assert_policy_error(lambda: frozen_contract({**attempt(), 'grading_version': None}),
                        503, 'dictation_policy_unavailable')


@pytest.mark.parametrize('version', [LEGACY_POLICY_VERSION, 'lexical-v2'])
@pytest.mark.parametrize('digest', ['', 'a' * 64, 'A' * 64, 123, False])
def test_explicit_frozen_digest_is_verified_under_both_policies(version, digest):
    assert_policy_error(lambda: frozen_contract({**attempt(version), 'reference_sha256': digest}),
                        503, 'dictation_reference_unavailable')


def test_lexical_missing_digest_and_changed_snapshot_fail_closed():
    assert_policy_error(lambda: frozen_contract({**attempt(), 'reference_sha256': None}),
                        503, 'dictation_reference_unavailable')
    row = attempt()
    row['units_snapshot'][0]['text'] = 'Edited source'
    assert_policy_error(lambda: frozen_contract(row), 503, 'dictation_reference_unavailable')


@pytest.mark.parametrize('version,digest', [(None, None), (LEGACY_POLICY_VERSION, None),
    ('unknown', None), ('lexical-v2', None), ('lexical-v2', 'f' * 64)])
def test_v2_write_requires_exact_explicit_consumer_acknowledgement(version, digest):
    assert_policy_error(lambda: require_write_contract(attempt(), grading_version=version,
                        acknowledged_reference_sha256=digest), 409, 'dictation_policy_update_required')


def test_matching_v2_ack_grades_frozen_text_and_returns_raw_span_evidence():
    row = attempt()
    result = grade_frozen_sentence(row, 0, 'Hello there.', grading_version='lexical-v2',
                                   acknowledged_reference_sha256=row['reference_sha256'])
    assert (result['total_words'], result['correct_words'], result['score']) == (2, 2, 1)
    assert result['reference'] == UNITS[0]['text']
    assert result['sentence_reference_sha256'] == text_sha256(UNITS[0]['text'])
    assert result['reference_sha256'] == row['reference_sha256']
    assert ''.join(segment['raw'] for segment in result['reference_segments']) == UNITS[0]['text']
    assert result['reference_segments'][0]['kind'] == 'unscored'


def test_legacy_cannot_be_upgraded_or_bound_to_an_unrelated_hash_by_request():
    row = {'units_snapshot': UNITS}
    for version, digest in [('lexical-v2', None), (None, 'f' * 64)]:
        assert_policy_error(lambda: require_write_contract(row, grading_version=version,
                            acknowledged_reference_sha256=digest), 409, 'dictation_policy_conflict')
    row = attempt(LEGACY_POLICY_VERSION)
    assert require_write_contract(row, grading_version=None,
        acknowledged_reference_sha256=None)['grading_version'] == LEGACY_POLICY_VERSION
    assert require_write_contract(row, grading_version=LEGACY_POLICY_VERSION,
        acknowledged_reference_sha256=row['reference_sha256'])['reference_sha256'] == row['reference_sha256']


@pytest.mark.parametrize('text', ['', ' . — , ', '🙂 ™'])
def test_new_punctuation_only_reference_is_not_a_successful_start(text):
    assert_policy_error(lambda: validate_new_lexical_source([{'text': text}]),
                        422, 'dictation_reference_without_words')


@pytest.mark.parametrize('text', ["'cause we left'", "'parents' anniversary'", '“unclosed'])
def test_ambiguous_new_source_requires_author_review(text):
    assert_policy_error(lambda: validate_new_lexical_source([{'text': text}]),
                        422, 'dictation_reference_needs_review')


def test_reviewed_unambiguous_new_source_and_byte_limit():
    assert validate_new_lexical_source(UNITS) == reference_sha256(UNITS)
    assert_policy_error(lambda: validate_new_lexical_source([{'text': 'x' * (256 * 1024 + 1)}]),
                        422, 'dictation_reference_too_large')


@pytest.mark.parametrize('index', [-1, 1, 100])
def test_out_of_range_sentence_cannot_grade(index):
    row = attempt()
    assert_policy_error(lambda: grade_frozen_sentence(row, index, '', grading_version='lexical-v2',
        acknowledged_reference_sha256=row['reference_sha256']), 422, 'dictation_sentence_out_of_range')
