"""Tests for services/speaking_feedback_parser.py (Sprint 5.0).

Pins behavior:
  - Valid full feedback parses cleanly with parse_failed=False
  - None / empty / malformed JSON → parse_failed=True with empty fields
    (parser never raises — dashboard always gets a renderable object)
  - Missing optional fields use defaults
  - Lenient fallback drops malformed nested items individually,
    keeps valid ones, sets parse_failed=True
  - grammar_recommendations with `anchor: null` round-trips correctly

Note on field naming: the spec used `_parse_failed` (leading underscore).
Pydantic v2 reserves underscore-prefixed names for `PrivateAttr`, so the
implementation renamed it to `parse_failed`. Tests assert against the
real attribute name.
"""

from __future__ import annotations

from services.speaking_feedback_parser import (
    FeedbackCorrection,
    GrammarRecommendation,
    SpeakingFeedback,
    parse_speaking_feedback,
)


# ── Happy path ────────────────────────────────────────────────────────


def test_valid_full_feedback_parses_cleanly():
    text = """{
        "grammar_issues": ["Sai giới từ"],
        "vocabulary_issues": ["Từ chung chung"],
        "pronunciation_issues": ["Nối âm"],
        "corrections": [
            {"original": "abc", "corrected": "xyz", "explanation": "test"}
        ],
        "strengths": ["Cấu trúc rõ ràng"],
        "sample_answer": "Better answer here",
        "overall_band": 6.0,
        "grammar_recommendations": [
            {"issue": "x", "slug": "test-slug", "category": "cat",
             "title": "Title", "score": 0.5, "anchor": null}
        ]
    }"""
    result = parse_speaking_feedback(text)

    assert not result.parse_failed
    assert len(result.grammar_issues) == 1
    assert result.grammar_issues[0] == "Sai giới từ"
    assert result.overall_band == 6.0
    assert result.sample_answer == "Better answer here"
    assert len(result.corrections) == 1
    assert isinstance(result.corrections[0], FeedbackCorrection)
    assert len(result.grammar_recommendations) == 1
    assert isinstance(result.grammar_recommendations[0], GrammarRecommendation)
    assert result.grammar_recommendations[0].anchor is None


# ── Defensive: never raises ───────────────────────────────────────────


def test_none_input_returns_empty_with_failed_flag():
    result = parse_speaking_feedback(None)
    assert result.parse_failed
    assert result.grammar_issues == []
    assert result.overall_band is None


def test_empty_string_returns_empty():
    result = parse_speaking_feedback("")
    assert result.parse_failed


def test_whitespace_only_string_returns_empty():
    """Treat whitespace-only payloads identically to empty — same root cause
    (probably an upstream null-coalesce that produced ' ' instead of None)."""
    result = parse_speaking_feedback("   \n\t  ")
    assert result.parse_failed


def test_malformed_json_returns_empty_with_failed_flag():
    result = parse_speaking_feedback("{not valid json")
    assert result.parse_failed
    assert result.grammar_issues == []
    assert result.corrections == []


def test_non_dict_json_returns_empty():
    """A JSON list or scalar is technically valid JSON but not a feedback shape."""
    result = parse_speaking_feedback('["not", "a", "dict"]')
    assert result.parse_failed
    result2 = parse_speaking_feedback("42")
    assert result2.parse_failed


# ── Partial / minimal valid input ─────────────────────────────────────


def test_missing_optional_fields_uses_defaults():
    """Every field is optional; a single-field payload still parses."""
    result = parse_speaking_feedback('{"overall_band": 7.0}')
    assert not result.parse_failed
    assert result.overall_band == 7.0
    assert result.grammar_issues == []
    assert result.corrections == []
    assert result.grammar_recommendations == []


# ── Lenient fallback ──────────────────────────────────────────────────


def test_lenient_parse_skips_malformed_corrections():
    """One correction is missing `explanation` → strict Pydantic would
    reject the whole payload. Lenient fallback drops the bad item but
    keeps the good one. parse_failed stays True so callers can tell
    this was a salvage."""
    text = """{
        "corrections": [
            {"original": "a", "corrected": "b"},
            {"original": "x", "corrected": "y", "explanation": "valid"}
        ],
        "overall_band": 5.0
    }"""
    result = parse_speaking_feedback(text)

    assert result.parse_failed, "lenient parse must mark parse_failed=True"
    assert len(result.corrections) == 1
    assert result.corrections[0].original == "x"
    assert result.overall_band == 5.0


def test_lenient_parse_skips_malformed_recommendations():
    """A recommendation missing `slug` is dropped; valid ones are kept."""
    text = """{
        "grammar_recommendations": [
            {"issue": "no slug", "category": "c", "title": "t"},
            {"issue": "ok", "slug": "s", "category": "c", "title": "t",
             "score": 0.5, "anchor": null}
        ]
    }"""
    result = parse_speaking_feedback(text)

    # The strict parse may fail (missing `slug` on item 0) → lenient kicks in.
    # Exactly one recommendation should make it through.
    assert len(result.grammar_recommendations) == 1
    assert result.grammar_recommendations[0].slug == "s"


def test_grammar_recommendations_with_null_anchor_round_trips():
    """The Pydantic model must accept `anchor: null` (Optional[str])."""
    text = """{
        "grammar_recommendations": [
            {"issue": "x", "slug": "s", "category": "c",
             "title": "t", "score": 0.5, "anchor": null}
        ]
    }"""
    result = parse_speaking_feedback(text)

    assert not result.parse_failed
    assert len(result.grammar_recommendations) == 1
    assert result.grammar_recommendations[0].anchor is None


# ── Sentinel / contract pins ──────────────────────────────────────────


def test_parse_failed_field_is_named_without_leading_underscore():
    """Spec used `_parse_failed`; Pydantic v2 reserves that for PrivateAttr.
    Pin the renamed attribute so a 'spec drift' refactor that re-introduces
    the underscore breaks here, not in production callers."""
    fb = SpeakingFeedback()
    assert hasattr(fb, "parse_failed"), "Sentinel must be the public field name"
    assert not hasattr(fb, "_parse_failed"), (
        "Leading-underscore field name fails on Pydantic v2 — keep the "
        "public name"
    )
