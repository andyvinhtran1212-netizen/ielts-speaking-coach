"""Tests for services.spam_detector (Phase 2.6).

The detector is the single source of truth for "should this essay
skip grading and go straight to delivered=flagged". Pinning every
flag code here means a regression that drops one (e.g. someone
removes the toxic check) shows up in CI before it reaches a real
student submission.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.spam_detector import (
    MIN_CHARS,
    MIN_WORDS,
    detect_flags,
    format_flag_explanation_vi,
)


# A real-shaped paragraph used as the negative control. Long enough
# to clear MIN_CHARS + MIN_WORDS so the only failures should be the
# pattern / toxic flags we deliberately introduce.
_LONG_CLEAN = (
    "This is a sample essay used as a negative control in the spam "
    "detector tests. It contains around one hundred and twenty words "
    "of unremarkable English prose with normal punctuation, varied "
    "sentence lengths, and a mix of common words. The detector should "
    "return an empty flag list because nothing here trips any of the "
    "five pattern, toxic, or length rules. We repeat slightly varied "
    "sentences to keep the word count comfortably above the one "
    "hundred word minimum so a small change to MIN_WORDS does not "
    "cause this fixture to start tripping the short-words flag and "
    "masking the actual rule under test in a sibling case."
)


# ── Length rules ─────────────────────────────────────────────────────


def test_clean_essay_no_flags():
    """The reference paragraph trips nothing."""
    assert detect_flags(_LONG_CLEAN) == []


def test_too_short_chars_and_words():
    """An essay shorter than MIN_CHARS necessarily has fewer than
    MIN_WORDS too — both length flags fire together."""
    flags = detect_flags("Hi")
    assert "too_short_chars" in flags
    assert "too_short_words" in flags


def test_too_short_words_only():
    """Padding the essay with a single very long word lets us cross
    MIN_CHARS while staying under MIN_WORDS — only the words flag
    should fire, not the chars one."""
    text = "supercalifragilisticexpialidocious " * 5  # ~175 chars, 5 words
    flags = detect_flags(text)
    assert "too_short_chars" not in flags
    assert "too_short_words" in flags


def test_empty_essay_returns_short_chars_only():
    """Empty / None essays short-circuit to a single flag — no point
    running the regex sweeps on no input."""
    assert detect_flags("")   == ["too_short_chars"]
    assert detect_flags(None) == ["too_short_chars"]


# ── Pattern rules ────────────────────────────────────────────────────


def test_repeated_phrase_detected():
    """The same 5-30 char chunk repeated 3+ times back-to-back trips
    the repeated_phrase flag."""
    # `hello world ` (12 chars) × 30 = 360 chars, well over MIN_CHARS,
    # plus a clean tail to clear MIN_WORDS so the only flag should
    # be repeated_phrase.
    text = "hello world " * 30 + " " + _LONG_CLEAN
    flags = detect_flags(text)
    assert "repeated_phrase" in flags


def test_keyboard_mash_detected():
    """A 5+ consonant-only token surrounded by word boundaries trips
    keyboard_mash. We use `qwrtpz` (six consonants, no vowel) so the
    test isn't sensitive to the exact regex's tolerance for vowels."""
    text = "qwrtpz is a token of pure consonants. " + _LONG_CLEAN
    flags = detect_flags(text)
    assert "keyboard_mash" in flags


def test_clean_text_does_not_trip_keyboard_mash():
    """Words like `qwerty` contain vowels and must NOT trip the
    consonant-only mash rule.  Pinning this prevents a regression
    that broadens the regex to vowel-tolerant runs."""
    text = "qwerty is a layout name and should not be flagged. " + _LONG_CLEAN
    flags = detect_flags(text)
    assert "keyboard_mash" not in flags


# ── Toxic rules ──────────────────────────────────────────────────────


def test_toxic_en_detected():
    """An English profanity from the seed list trips toxic_language
    even when surrounded by enough clean text to pass length rules."""
    text = "This essay unfortunately contains the word fuck once. " + _LONG_CLEAN
    flags = detect_flags(text)
    assert "toxic_language" in flags


def test_toxic_vi_detected():
    """A Vietnamese profanity from the seed list trips toxic_language.
    We use the diacriticless transliteration `du` because Python's
    `re.IGNORECASE` Unicode handling is well-defined for ASCII words."""
    text = "Some long enough essay that contains the word du in it. " + _LONG_CLEAN
    flags = detect_flags(text)
    assert "toxic_language" in flags


def test_toxic_runs_even_on_short_text():
    """Toxic check fires even when the essay is too short for the
    pattern sweeps — a 3-word slur should still flag."""
    flags = detect_flags("fuck off now")
    assert "toxic_language" in flags
    # The length flags also fire (it's 12 chars, 3 words).
    assert "too_short_chars" in flags


# ── Explanation formatter ────────────────────────────────────────────


def test_format_explanation_short():
    """Length flags render a "ngắn" message."""
    msg = format_flag_explanation_vi(["too_short_chars"])
    assert "ngắn" in msg


def test_format_explanation_dedupes_length_pair():
    """too_short_chars + too_short_words use near-identical Vietnamese
    sentences — we want one combined message, not two."""
    msg = format_flag_explanation_vi(["too_short_chars", "too_short_words"])
    # Two distinct labels render two semicolon-joined parts; we just
    # want the message present, not duplicated word-for-word.
    assert "ngắn" in msg
    # If the formatter ever stops handling the pair gracefully and
    # double-renders the same string verbatim, this catches it.
    occurrences = msg.lower().count("chưa đạt độ dài tối thiểu")
    assert occurrences <= 1


def test_format_explanation_repeated():
    msg = format_flag_explanation_vi(["repeated_phrase"])
    assert "lặp" in msg


def test_format_explanation_toxic():
    msg = format_flag_explanation_vi(["toxic_language"])
    assert "không phù hợp" in msg


def test_format_explanation_empty_falls_back():
    """An empty flag list should still return a sensible default
    string rather than the empty string."""
    msg = format_flag_explanation_vi([])
    assert len(msg) > 0
    assert "yêu cầu" in msg or "không đạt" in msg


def test_format_explanation_unknown_flag_ignored():
    """A flag code we don't recognise (vd: future addition rolled out
    server-side before the formatter knows it) shouldn't blow up — it
    just falls back to the default."""
    msg = format_flag_explanation_vi(["future_flag_we_dont_know"])
    assert isinstance(msg, str)
    assert len(msg) > 0
