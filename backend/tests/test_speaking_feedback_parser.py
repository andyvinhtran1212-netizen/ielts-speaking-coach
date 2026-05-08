"""Tests for services/speaking_feedback_parser.py (Sprint 5.0 + 5.0.1).

Sprint 5.0.1 splits the parser into two shape models:
  - SpeakingFeedbackPractice (Shape A, practice mode)
  - SpeakingFeedbackTest     (Shape B, test_full / test_part modes)

These tests pin:
  - Shape A still parses cleanly (Sprint 5.0 backward compat)
  - Shape B parses cleanly with all 4 rubric criteria + per-criterion text
  - _detect_shape uses signature keys, never common fields
  - Anomaly (both signatures present) defaults to "test"
  - Unknown shape (no signature) falls back to lenient Practice parse
    with parse_failed=True (preserves Sprint 5.0 default behaviour)
  - Production sample rows from both shapes round-trip without
    parse_failed=True (regression guard against shape drift)
"""

from __future__ import annotations

from services.speaking_feedback_parser import (
    FeedbackCorrection,
    GrammarRecommendation,
    SpeakingFeedbackPractice,
    SpeakingFeedbackTest,
    _detect_shape,
    parse_speaking_feedback,
)


# ── Shape A — Practice mode ───────────────────────────────────────────


class TestShapeAPractice:
    def test_valid_full_practice_feedback(self):
        text = """{
            "grammar_issues": ["Sai cấu trúc"],
            "vocabulary_issues": ["Lặp từ"],
            "pronunciation_issues": ["Nối âm"],
            "corrections": [{"original": "abc", "corrected": "xyz", "explanation": "test"}],
            "strengths": ["Cấu trúc rõ ràng"],
            "sample_answer": "Better answer",
            "overall_band": 6.0,
            "grammar_recommendations": [
                {"issue": "x", "slug": "test", "category": "cat",
                 "title": "Title", "score": 0.5, "anchor": null}
            ]
        }"""
        result = parse_speaking_feedback(text)
        assert isinstance(result, SpeakingFeedbackPractice)
        assert result.shape == "practice"
        assert not result.parse_failed
        assert len(result.grammar_issues) == 1
        assert result.overall_band == 6.0
        assert len(result.corrections) == 1
        assert isinstance(result.corrections[0], FeedbackCorrection)
        assert len(result.grammar_recommendations) == 1
        assert isinstance(result.grammar_recommendations[0], GrammarRecommendation)

    def test_practice_lenient_skips_malformed_corrections(self):
        """One correction missing `explanation` → strict reject. Lenient
        keeps the good one + sets parse_failed=True."""
        text = """{
            "grammar_issues": ["test"],
            "corrections": [
                {"original": "a", "corrected": "b"},
                {"original": "x", "corrected": "y", "explanation": "valid"}
            ],
            "overall_band": 5.0
        }"""
        result = parse_speaking_feedback(text)
        assert isinstance(result, SpeakingFeedbackPractice)
        assert result.parse_failed
        assert len(result.corrections) == 1
        assert result.corrections[0].original == "x"
        assert result.overall_band == 5.0

    def test_practice_lenient_skips_malformed_recommendations(self):
        """A recommendation missing `slug` is dropped; valid ones kept."""
        text = """{
            "grammar_issues": [],
            "grammar_recommendations": [
                {"issue": "no slug", "category": "c", "title": "t"},
                {"issue": "ok", "slug": "s", "category": "c",
                 "title": "t", "score": 0.5, "anchor": null}
            ]
        }"""
        result = parse_speaking_feedback(text)
        assert isinstance(result, SpeakingFeedbackPractice)
        assert len(result.grammar_recommendations) == 1
        assert result.grammar_recommendations[0].slug == "s"

    def test_practice_minimum_signature_only(self):
        """`grammar_issues` alone is enough to identify Shape A."""
        result = parse_speaking_feedback('{"grammar_issues": ["x"]}')
        assert isinstance(result, SpeakingFeedbackPractice)
        assert not result.parse_failed
        assert result.overall_band is None


# ── Shape B — Test mode (NEW) ─────────────────────────────────────────


class TestShapeBTest:
    def test_valid_full_test_feedback(self):
        text = """{
            "band_fc": 4.0,
            "band_lr": 5.0,
            "band_gra": 6.0,
            "band_p": 5.0,
            "overall_band": 5.0,
            "fc_feedback": "Brief response.",
            "lr_feedback": "Basic vocabulary.",
            "gra_feedback": "Accurate but simple.",
            "p_feedback": "Limited assessment.",
            "strengths": ["Direct answer"],
            "improvements": ["Extend with details"],
            "improved_response": "Well, I do quite a lot..."
        }"""
        result = parse_speaking_feedback(text)
        assert isinstance(result, SpeakingFeedbackTest)
        assert result.shape == "test"
        assert not result.parse_failed
        assert result.band_fc == 4.0
        assert result.band_p == 5.0
        assert result.fc_feedback.startswith("Brief")
        assert len(result.improvements) == 1
        assert result.improved_response.startswith("Well")

    def test_test_minimum_signature_only(self):
        """`band_fc` alone identifies Shape B; other fields default to
        None / empty list. The dashboard renders gaps as '—'."""
        result = parse_speaking_feedback('{"band_fc": 5.0, "overall_band": 5.5}')
        assert isinstance(result, SpeakingFeedbackTest)
        assert not result.parse_failed
        assert result.band_fc == 5.0
        assert result.band_lr is None
        assert result.improvements == []
        assert result.improved_response is None

    def test_test_lenient_drops_invalid_band_types(self):
        """Strict parse rejects a string-typed band; lenient keeps the
        valid sibling fields and drops the bad one. Numeric strings
        are NOT silently coerced — that hides upstream serialisation
        bugs (see comment in _lenient_parse_test)."""
        text = """{
            "band_fc": "invalid",
            "band_lr": 6.0,
            "fc_feedback": 12345,
            "lr_feedback": "valid string"
        }"""
        result = parse_speaking_feedback(text)
        assert isinstance(result, SpeakingFeedbackTest)
        assert result.parse_failed
        assert result.band_lr == 6.0
        assert result.lr_feedback == "valid string"
        assert result.band_fc is None
        assert result.fc_feedback is None

    def test_test_signature_via_per_criterion_feedback_only(self):
        """If only `fc_feedback` (no band_*) is present, still classify
        as Shape B. The grader sometimes emits feedback before the
        rubric numbers settle."""
        result = parse_speaking_feedback(
            '{"fc_feedback": "...", "strengths": []}',
        )
        assert isinstance(result, SpeakingFeedbackTest)


# ── Shape detection (signature-key contract) ──────────────────────────


class TestShapeDetection:
    def test_detect_shape_a_via_grammar_issues(self):
        assert _detect_shape({"grammar_issues": [], "overall_band": 6}) == "practice"

    def test_detect_shape_a_via_corrections(self):
        assert _detect_shape({"corrections": [], "strengths": []}) == "practice"

    def test_detect_shape_a_via_vocabulary_issues(self):
        assert _detect_shape({"vocabulary_issues": []}) == "practice"

    def test_detect_shape_b_via_band_fc(self):
        assert _detect_shape({"band_fc": 5.0, "overall_band": 5.5}) == "test"

    def test_detect_shape_b_via_fc_feedback(self):
        assert _detect_shape({"fc_feedback": "...", "strengths": []}) == "test"

    def test_detect_neither_returns_none(self):
        """Common-only payload (overall_band + strengths) is ambiguous —
        detection must NOT silently default to a shape. Caller decides."""
        assert _detect_shape({"strengths": [], "overall_band": 6}) is None
        assert _detect_shape({}) is None

    def test_detect_both_signatures_defaults_to_test(self):
        """Anomaly path: ~8 production rows have both. Default to
        'test' (the more recent rubric design preserves more data)."""
        assert _detect_shape({"grammar_issues": [], "band_fc": 5.0}) == "test"

    def test_detect_uses_signature_keys_not_common_fields(self):
        """`overall_band` and `strengths` appear in BOTH shapes — they
        must NOT be detection inputs. This test guards against a
        future refactor that adds them to a SIGNATURE_KEYS set."""
        # overall_band alone → no signature, returns None
        assert _detect_shape({"overall_band": 6.0}) is None
        # strengths alone → no signature, returns None
        assert _detect_shape({"strengths": ["x"]}) is None


# ── Common error handling ─────────────────────────────────────────────


class TestCommonErrors:
    def test_none_input_returns_practice_with_failed_flag(self):
        result = parse_speaking_feedback(None)
        assert isinstance(result, SpeakingFeedbackPractice)
        assert result.parse_failed

    def test_empty_string_returns_practice_with_failed_flag(self):
        result = parse_speaking_feedback("")
        assert isinstance(result, SpeakingFeedbackPractice)
        assert result.parse_failed

    def test_whitespace_only_returns_practice_with_failed_flag(self):
        result = parse_speaking_feedback("   \n\t  ")
        assert isinstance(result, SpeakingFeedbackPractice)
        assert result.parse_failed

    def test_malformed_json_returns_practice_with_failed_flag(self):
        result = parse_speaking_feedback("{not valid json")
        assert isinstance(result, SpeakingFeedbackPractice)
        assert result.parse_failed

    def test_non_dict_json_returns_practice_with_failed_flag(self):
        """A JSON list/scalar is valid JSON but not a feedback shape."""
        for payload in ('["not", "a", "dict"]', "42", "true", '"string"'):
            result = parse_speaking_feedback(payload)
            assert isinstance(result, SpeakingFeedbackPractice), (
                f"non-dict JSON {payload!r} should fall back to Practice"
            )
            assert result.parse_failed

    def test_undetectable_shape_falls_back_to_lenient_practice(self):
        """No signature keys + has common fields → lenient Practice
        salvage. Preserves Sprint 5.0 default behaviour for legacy
        rows that pre-date both shapes."""
        text = '{"strengths": ["good"], "overall_band": 6.0}'
        result = parse_speaking_feedback(text)
        assert isinstance(result, SpeakingFeedbackPractice)
        assert result.parse_failed
        assert result.overall_band == 6.0
        assert len(result.strengths) == 1


# ── Type / sentinel pins ──────────────────────────────────────────────


class TestModelContracts:
    def test_practice_parse_failed_field_named_without_underscore(self):
        """Sprint 5.0 hotfix pin — Pydantic v2 reserves leading-
        underscore field names for PrivateAttr. Keep the public name."""
        fb = SpeakingFeedbackPractice()
        assert hasattr(fb, "parse_failed")
        assert not hasattr(fb, "_parse_failed")

    def test_test_parse_failed_field_named_without_underscore(self):
        fb = SpeakingFeedbackTest()
        assert hasattr(fb, "parse_failed")
        assert not hasattr(fb, "_parse_failed")

    def test_shape_discriminator_default_practice(self):
        """`shape` field defaults match the class — no explicit kwarg
        needed when constructing in tests/code."""
        assert SpeakingFeedbackPractice().shape == "practice"

    def test_shape_discriminator_default_test(self):
        assert SpeakingFeedbackTest().shape == "test"


# ── Production sample regression guard ────────────────────────────────


class TestProductionSamples:
    """Smoke test parser against actual production-shape JSON. Pins
    against shape drift — if the grader changes its emit shape, these
    tests fail with a clear "production sample no longer parses"
    signal instead of silently degrading to lenient salvage."""

    def test_real_shape_a_practice_sample(self):
        # Verbatim from a production responses.feedback row (Sprint 5.0.1
        # spec sample). The Vietnamese text is intentional — Speaking
        # Practice grading emits explanations in the user's locale.
        text = (
            '{"grammar_issues": ["Sai cấu trúc: \'I think it is a very '
            'necessary skill\' — chủ ngữ \'it\' không rõ ràng"], '
            '"vocabulary_issues": ["Dùng \'very necessary\' — cách nói '
            'kém tự nhiên"], "corrections": [{"original": "I think it is '
            'a very necessary skill and at the same time a very '
            'challenging skill", "corrected": "I think driving is an '
            'essential skill, but it\'s quite challenging to master", '
            '"explanation": "Cấu trúc này rõ ràng hơn"}], "strengths": '
            '["Câu trả lời trực tiếp"], "sample_answer": "No, I don\'t '
            'drive at the moment.", "overall_band": 6.0}'
        )
        result = parse_speaking_feedback(text)
        assert isinstance(result, SpeakingFeedbackPractice)
        assert not result.parse_failed, (
            "production Shape A sample regressed — parser shape contract "
            "drifted away from real grading output"
        )
        assert result.overall_band == 6.0
        assert len(result.corrections) == 1
        assert result.corrections[0].original.startswith("I think it is")

    def test_real_shape_b_test_sample(self):
        text = (
            '{"band_fc": 4.0, "band_lr": 5.0, "band_gra": 6.0, '
            '"band_p": 5.0, "overall_band": 5.0, "fc_feedback": "Your '
            'response is very brief and lacks development.", '
            '"lr_feedback": "Vocabulary is basic and repetitive.", '
            '"gra_feedback": "Grammar is accurate but extremely simple.", '
            '"p_feedback": "Based on the transcript structure...", '
            '"strengths": ["Grammar is accurate"], "improvements": '
            '["Extend your answer with specific details"], '
            '"improved_response": "Well, I do quite a lot of things..."}'
        )
        result = parse_speaking_feedback(text)
        assert isinstance(result, SpeakingFeedbackTest)
        assert not result.parse_failed, (
            "production Shape B sample regressed — parser shape contract "
            "drifted away from real grading output"
        )
        assert result.band_fc == 4.0
        assert result.band_lr == 5.0
        assert result.band_gra == 6.0
        assert result.band_p == 5.0
        assert result.improved_response.startswith("Well")
        assert len(result.improvements) == 1
