"""Reviewed-policy candidates: scoring, lexical errors and exact source spans."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from services.dictation_lexical_policy import (
    InvalidLexicalReference, OFFSET_UNIT, grade_lexical, tokenize_lexical,
)
from services.listening_grader import aggregate_dictation_report, grade_dictation


GOLD = json.loads((Path(__file__).parent / "fixtures/dictation_lexical_gold.json").read_text())


def assert_exhaustive(text, segments):
    assert "".join(segment["raw"] for segment in segments) == text
    position = 0
    for segment in segments:
        assert segment["start"] == position
        assert segment["end"] > segment["start"]
        assert text[segment["start"]:segment["end"]] == segment["raw"]
        position = segment["end"]
    assert position == len(text)


def assert_diff_bijection(result):
    for side, text_key, segments_key, value_key in (
        ("expected", "reference", "reference_segments", "expected"),
        ("actual", "user_text", "user_segments", "actual"),
    ):
        segments = result[segments_key]
        assert_exhaustive(result[text_key], segments)
        visited = []
        for operation in result["diff"]:
            span = operation[f"{side}_span"]
            if operation[value_key] is None:
                assert span is None
                continue
            assert span is not None
            segment = segments[span["segment_index"]]
            assert segment["kind"] == "lexical"
            assert (span["start"], span["end"]) == (segment["start"], segment["end"])
            assert result[text_key][span["start"]:span["end"]] == operation[value_key]
            visited.append(span["segment_index"])
        assert visited == [index for index, segment in enumerate(segments) if segment["kind"] == "lexical"]


@pytest.mark.parametrize("case", GOLD["cases"], ids=lambda case: case["id"])
def test_gold_lexical_counts_scores_errors_and_span_reconstruction(case):
    arguments = {"reference_transcript": case["reference"], "user_transcript": case["user"],
                 "ignore_fillers": case.get("ignore_fillers", False)}
    if case.get("invalid_reference"):
        with pytest.raises(InvalidLexicalReference):
            grade_lexical(**arguments)
        return
    result = grade_lexical(**arguments)
    assert result["correct_words"] == case["correct_words"]
    assert result["total_words"] == case["total_words"]
    assert result["score"] == case["score"]
    assert result["is_correct"] == (case["score"] >= 1)
    assert result["offset_unit"] == OFFSET_UNIT
    assert result["grading_version"] == "lexical-v2"
    assert_diff_bijection(result)
    for kind in ("miss", "wrong", "extra"):
        assert sum(operation["op"] == kind and not operation.get("filler")
                   for operation in result["diff"]) == case.get(kind, 0)
    assert sum(bool(operation.get("filler")) for operation in result["diff"]) == case.get("forgiven", 0)
    if case.get("ambiguous_reference"):
        assert result["reference_ambiguities"]
        assert result["score"] < 1  # ambiguous shells cannot become permissive word matching


@pytest.mark.parametrize("text,words", [
    ("[“hello world”]", ["hello", "world"]),
    ("(‘hello’)", ["hello"]),
    ("“don't”", ["don't"]),
    ("don't John's parents'", ["don't", "John's", "parents'"]),
    ("“parents' anniversary”", ["parents'", "anniversary"]),
    ("\"students' books\"", ["students'", "books"]),
    ("'cause and 'hello'", ["'cause", "and", "hello"]),
    ("’em and 'hello'", ["’em", "and", "hello"]),
    ("’em and ‘hello’", ["’em", "and", "hello"]),
    ("“-42” '+42' [−42]", ["-42", "+42", "−42"]),
    ("state-of-the-art—hello–world", ["state-of-the-art", "hello", "world"]),
    ("🙂 . , ™ \u0301", []),
    ("pre(hello)post", ["pre(hello)post"]),
    ("“foo(bar)”", ["foo(bar)"]),
    ("[“pre(hello)post”]", ["pre(hello)post"]),
    ("foo('hello')bar", ["foo('hello')bar"]),
    ("(“hello”)world", ["(“hello”)world"]),
    ("(hello),world", ["(hello),world"]),
    ("a\u0301'b", ["a\u0301'b"]),
])
def test_token_policy_preserves_lexical_identity_and_all_original_bytes(text, words):
    parsed = tokenize_lexical(text)
    assert [segment.raw for segment in parsed.lexical] == words
    assert_exhaustive(text, [segment.as_dict() for segment in parsed.segments])


@pytest.mark.parametrize("reference,user,ignore", [
    ("Hello world.", "hello WORLD", False),
    ("don't state-of-the-art 50%", "dont state of the art 50%", False),
    ("hello world", "hello wurld", False),
    ("hello brave world", "hello world", False),
    ("hello world", "hello brave world", False),
    ("um hello", "uh hello", True),
    ("hello", "um hello", True),
    ("um", "", True),
    ("ＡＢＣ café", "abc cafe\u0301", False),
])
def test_control_alignment_equality_filler_and_extra_policy_are_exactly_legacy(reference, user, ignore):
    legacy = grade_dictation(reference_transcript=reference, user_transcript=user, ignore_fillers=ignore)
    lexical = grade_lexical(reference_transcript=reference, user_transcript=user, ignore_fillers=ignore)
    for key in ("score", "correct_words", "total_words", "is_correct"):
        assert lexical[key] == legacy[key]
    assert [{key: value for key, value in operation.items() if not key.endswith("_span")}
            for operation in lexical["diff"]] == legacy["diff"]
    assert_diff_bijection(lexical)


def test_codepoint_offsets_do_not_claim_utf16_offsets_or_normalize_original_text():
    result = grade_lexical(reference_transcript="🙂 — “cafe\u0301”", user_transcript="café")
    span = result["diff"][0]["expected_span"]
    assert (span["start"], span["end"]) == (5, 10)
    assert len(result["reference"][:span["start"]].encode("utf-16-le")) // 2 == 6
    assert result["reference"][span["start"]:span["end"]] == "cafe\u0301"


def test_balanced_embedded_brackets_do_not_invalidate_an_unambiguous_outer_quote():
    result = grade_lexical(reference_transcript="“foo(bar)”", user_transcript="foo(bar)")
    assert result["score"] == 1
    assert result["reference_ambiguities"] == []
    assert_diff_bijection(result)


def test_known_elision_followed_by_a_paired_quote_is_not_ambiguous():
    result = grade_lexical(reference_transcript="’em and ‘hello’", user_transcript="’em and hello")
    assert result["score"] == 1
    assert result["reference_ambiguities"] == []
    assert_diff_bijection(result)


@pytest.mark.parametrize("reference,user", [
    ("'parents' anniversary'", "parents anniversary'"),
    ("'students' books'", "students books'"),
    ("‘parents’ anniversary’", "parents anniversary’"),
])
def test_ambiguous_single_quote_and_plural_possessive_never_erase_lexical_apostrophe(reference, user):
    result = grade_lexical(reference_transcript=reference, user_transcript=user)
    assert result["reference_ambiguities"]
    assert result["score"] < 1
    assert result["reference_segments"][0]["raw"] == reference.split()[0]
    assert_diff_bijection(result)


def test_word_error_aggregate_contains_no_display_punctuation_and_retains_real_errors():
    grades = [grade_lexical(reference_transcript="— hello world .", user_transcript="hello wurld"),
              grade_lexical(reference_transcript="hello—world", user_transcript="hello"),
              grade_lexical(reference_transcript="Um — hello", user_transcript="hello", ignore_fillers=True)]
    report = aggregate_dictation_report(grades)
    assert report["error_trends"]["op_counts"] == {"miss": 1, "wrong": 1, "extra": 0}
    assert report["error_trends"]["missed"] == {"world": 1}
    assert report["error_trends"]["wrong"] == {"world": 1}
    assert report["accuracy"] == pytest.approx(.6667)
    assert report["total_words"] == 5


def test_default_legacy_caller_is_unchanged_after_importing_and_using_new_policy():
    legacy = grade_dictation(reference_transcript="— Hello there.", user_transcript="Hello there.")
    assert legacy["score"] == .6667
    assert legacy["total_words"] == 3
    assert any(operation["expected"] == "—" for operation in legacy["diff"])
    grade_lexical(reference_transcript="— Hello there.", user_transcript="Hello there.")
    assert grade_dictation(reference_transcript="— Hello there.", user_transcript="Hello there.") == legacy


@pytest.mark.parametrize("value", [None, [], 42])
def test_input_shape_is_not_silently_coerced(value):
    with pytest.raises(TypeError):
        tokenize_lexical(value)
