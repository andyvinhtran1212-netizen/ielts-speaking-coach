"""Pinned Unicode membership avoids Python-runtime and PostgreSQL-locale drift."""
import hashlib
import unicodedata

import pytest

from services.dictation_lexical_policy import InvalidLexicalReference, grade_lexical, tokenize_lexical
from services.dictation_unicode15 import (
    COMBINING_RANGES, COMBINING_RANGES_SHA256, LEXICAL_RANGES, RANGES_SHA256,
    UNICODE_VERSION, is_lexical_alnum, is_word_combining,
)


@pytest.mark.parametrize('text,lexical', [('²', True), ('½', True), ('Ⅳ', True),
    ('٤', True), ('中文', True), ('café', True), ('\U0001e4d0', True), ('\U0001d400', True),
    ('\u0345', False), ('\u0301', False), ('🙂', False), ('Ⓐ', False), ('—', False), ('', False)])
def test_unicode_letter_number_class_and_nonlexical_marks_are_frozen(text, lexical):
    assert bool(tokenize_lexical(text).lexical) is lexical
    if lexical:
        result = grade_lexical(reference_transcript=text, user_transcript=text)
        assert result['score'] == 1 and result['total_words'] == result['correct_words'] == 1
    else:
        with pytest.raises(InvalidLexicalReference):
            grade_lexical(reference_transcript=text, user_transcript=text)


def test_ranges_bind_the_exact_unicode15_property_data():
    assert UNICODE_VERSION == '15.0.0'
    packed = '{' + ','.join(f'[{start},{end})' for start, end in LEXICAL_RANGES) + '}'
    assert hashlib.sha256(packed.encode()).hexdigest() == RANGES_SHA256
    assert len(LEXICAL_RANGES) == 747
    assert all(0 <= start < end <= 0x110000 for start, end in LEXICAL_RANGES)
    assert all(left[1] < right[0] for left, right in zip(LEXICAL_RANGES, LEXICAL_RANGES[1:]))
    # CI's Python3.11 has Unicode14; the policy still recognizes Nag Mundari,
    # added in Unicode15. Validate the full authoritative property when present.
    if unicodedata.unidata_version == UNICODE_VERSION:
        assert all(is_lexical_alnum(chr(codepoint)) == chr(codepoint).isalnum()
                   for codepoint in range(0x110000))


def test_shell_word_boundary_combining_membership_is_also_pinned():
    packed = '{' + ','.join(f'[{start},{end})' for start, end in COMBINING_RANGES) + '}'
    assert hashlib.sha256(packed.encode()).hexdigest() == COMBINING_RANGES_SHA256
    assert is_word_combining('\U0001e4ec') is True  # Unicode15 Nag Mundari cc232
    assert is_word_combining('\u0301') is True
    assert is_word_combining('a') is False
    if unicodedata.unidata_version == UNICODE_VERSION:
        assert all(is_word_combining(chr(codepoint)) == bool(unicodedata.combining(chr(codepoint)))
                   for codepoint in range(0x110000))


@pytest.mark.parametrize('text,words,ambiguities', [
    ("'cause\U0001e4ec we left'", ['cause\U0001e4ec', 'we', 'left'], []),
    ("'em\U0001e4ec and ‘hello’", ["'em\U0001e4ec", 'and', '‘hello’'], ['unpaired_outer_shell']),
])
def test_new_unicode15_marks_do_not_change_elision_shells_on_python311(text, words, ambiguities):
    result = tokenize_lexical(text)
    assert [segment.raw for segment in result.lexical] == words
    assert [item.reason for item in result.ambiguities] == ambiguities
