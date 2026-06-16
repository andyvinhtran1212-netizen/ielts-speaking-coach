"""test_mistake_authenticity.py — P-2a backend authenticity filter.

Pins: non-corrections (original == suggestion after NFC + punctuation-variant
fold + whitespace collapse) are dropped; genuine corrections (case / added
punctuation / word change / spacing-around-punctuation) are kept.
"""
import pytest

from services.mistake_authenticity import (
    is_noncorrection,
    drop_noncorrection_mistakes,
)

CURLY = "’"   # ’  curly apostrophe
EMDASH = "—"  # —  em dash


@pytest.mark.parametrize("original, suggestion", [
    ("the cat", "the cat"),                  # identical
    ("don" + CURLY + "t", "don't"),          # curly ↔ straight apostrophe (variant)
    ("well" + EMDASH + "being", "well-being"),  # em-dash ↔ hyphen (variant)
    ("the  cat", "the cat"),                  # double internal space
    (" cat ", "cat"),                          # leading/trailing space
    ("", ""),                                   # both empty (junk)
])
def test_dropped_as_noncorrection(original, suggestion):
    assert is_noncorrection(original, suggestion) is True


@pytest.mark.parametrize("original, suggestion", [
    ("teh", "The"),          # case + spelling — real
    ("the", "The"),          # case only — real (case-sensitive)
    ("its", "it's"),         # apostrophe ADDED (not a variant fold) — real
    ("cat", "cats"),         # word change — real
    ("a ,b", "a, b"),        # spacing around punctuation — real
])
def test_kept_as_real_correction(original, suggestion):
    assert is_noncorrection(original, suggestion) is False


def test_drop_filters_list_and_counts():
    mistakes = [
        {"original": "teh", "suggestion": "The", "mistakeType": "spelling", "criterion": "GRA"},
        {"original": "the cat", "suggestion": "the cat", "mistakeType": "x", "criterion": "LR"},   # junk
        {"original": "don" + CURLY + "t", "suggestion": "don't", "mistakeType": "x", "criterion": "GRA"},  # junk variant
        {"original": "cat", "suggestion": "cats", "mistakeType": "agreement", "criterion": "GRA"},
    ]
    kept, dropped = drop_noncorrection_mistakes(mistakes)
    assert dropped == 2
    assert [m["original"] for m in kept] == ["teh", "cat"]


def test_drop_empty_and_none_safe():
    assert drop_noncorrection_mistakes([]) == ([], 0)
    assert drop_noncorrection_mistakes(None) == ([], 0)


def test_drop_tolerates_missing_fields():
    # entry missing 'suggestion' → both normalise to "" only if original also empty;
    # here original present, suggestion absent (None) → not equal → kept (don't crash).
    mistakes = [{"original": "cat", "mistakeType": "x", "criterion": "LR"}]
    kept, dropped = drop_noncorrection_mistakes(mistakes)
    assert dropped == 0 and len(kept) == 1
