"""
backend/tests/test_rubric_and_prompt_uplift.py — Sprint 14.5

Sentinel tests for the Sprint 14.5 prompt + rubric uplift.

Sprint 14.5 deliberately ships an **additive** uplift rather than the
breaking v2-schema rewrite the original commission described:

  - cambridge_speaking_descriptors.json bands 0-3 filled in (Sprint
    14.0 left them as 'TBD — Sprint 14.4' placeholders that 14.4
    didn't touch because it was about cue cards).
  - SYSTEM_PROMPT + SYSTEM_PROMPT_PRACTICE gain bands 1-3, VN-learner
    pronunciation + grammar patterns, anti-inflation calibration, and
    a feedback-specificity rule.
  - Output schema STAYS the same (band_fc / band_lr / band_gra / band_p
    + per-criterion *_feedback strings + strengths / improvements). A
    new optional `rubric_version` field is appended; missing or absent
    defaults to "v1" so pre-14.5 graded rows + any provider that drops
    the field still validate.

These tests pin the data fill + prompt content + validator additivity
so a future cleanup can't silently regress them.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

REPO_ROOT = Path(__file__).parent.parent.parent
RUBRIC_PATH = REPO_ROOT / "data" / "rubric" / "cambridge_speaking_descriptors.json"


# ── Rubric data fill (bands 0-3) ────────────────────────────────────────────


def _load_rubric() -> dict:
    return json.loads(RUBRIC_PATH.read_text(encoding="utf-8"))


def test_rubric_file_has_all_4_criteria():
    rubric = _load_rubric()
    crits = set(rubric["descriptors"].keys())
    assert crits == {"fc", "lr", "gra", "p"}, (
        f"expected exactly the 4 Cambridge criteria; got {crits}"
    )


def test_rubric_all_criteria_have_bands_0_through_9():
    """Sprint 14.0 left bands 0-3 as 'TBD' placeholders; Sprint 14.5
    must fill all of them across all four criteria."""
    rubric = _load_rubric()
    for crit, cells in rubric["descriptors"].items():
        bands = sorted(int(k) for k in cells.keys())
        assert bands == list(range(10)), (
            f"{crit}: expected bands 0..9, got {bands}"
        )


def test_rubric_no_tbd_markers_left():
    """The signature 'TBD — Sprint 14.4' string was Sprint 14.0's
    placeholder. Sprint 14.5 must have replaced every instance."""
    rubric = _load_rubric()
    for crit, cells in rubric["descriptors"].items():
        for band, text in cells.items():
            assert "TBD" not in text, (
                f"{crit} band {band} still has TBD marker: {text!r}"
            )


def test_rubric_meta_marks_v2_schema():
    """The schema_version + source_note must call out the Sprint 14.5
    fill so future readers know which cells are paraphrased."""
    rubric = _load_rubric()
    assert rubric["_meta"]["schema_version"].startswith("0.2."), (
        f"schema_version must bump to 0.2.x after Sprint 14.5 fill; "
        f"got {rubric['_meta']['schema_version']!r}"
    )
    note = rubric["_meta"]["_source_note"]
    assert "paraphrased" in note.lower()
    assert "Sprint 14.5" in note or "L2" in note


def test_rubric_bands_1_3_marked_as_sprint_14_5_paraphrase():
    """Each filled-in cell should carry the '(paraphrased, Sprint 14.5)'
    annotation so legal review (Sprint 14.8 closure) knows which strings
    to audit."""
    rubric = _load_rubric()
    for crit, cells in rubric["descriptors"].items():
        for band in ("0", "1", "2", "3"):
            text = cells[band]
            assert "paraphrased" in text.lower() and "14.5" in text, (
                f"{crit} band {band} missing Sprint 14.5 paraphrase annotation: "
                f"{text!r}"
            )


# ── Prompt enrichment ──────────────────────────────────────────────────────


def _load_test_prompt() -> str:
    from services.claude_grader import SYSTEM_PROMPT
    return SYSTEM_PROMPT


def _load_practice_prompt() -> str:
    from services.claude_grader import SYSTEM_PROMPT_PRACTICE
    return SYSTEM_PROMPT_PRACTICE


def test_test_prompt_lists_bands_1_through_3_for_fc():
    """Anti-inflation lock L9: the prompt must surface Band 1-3
    descriptors so the model can't claim ignorance of low-end scoring."""
    prompt = _load_test_prompt()
    assert "Band 3:" in prompt
    assert "Band 2:" in prompt
    assert "Band 1:" in prompt


def test_test_prompt_does_not_score_pronunciation():
    """Audit 2026-07-02 — the grader works from a text transcript and can't
    hear audio, so it must NOT score pronunciation. Pronunciation is measured
    from the real audio by Azure and merged in by routers/grading.py. Pin that
    the test prompt tells the model NOT to output band_p / p_feedback, so a
    future tidy-up can't silently re-introduce the fabricated text-based band."""
    prompt = _load_test_prompt()
    assert "NOT SCORED HERE" in prompt
    assert "Do NOT output band_p" in prompt or "Do NOT include band_p" in prompt
    # It must NOT ask for a p_feedback field in the JSON template.
    assert '"p_feedback"' not in prompt
    assert '"band_p"' not in prompt


def test_test_prompt_includes_vn_learner_grammar_patterns():
    prompt = _load_test_prompt()
    assert "third-person -s" in prompt.lower() or "third person -s" in prompt.lower()
    assert "missing articles" in prompt.lower()


def test_test_prompt_has_low_band_anti_inflation_section():
    """L9 anti-inflation: the prompt must explicitly tell the model
    not to round up out of politeness."""
    prompt = _load_test_prompt()
    assert "ANTI-INFLATION" in prompt or "anti-inflation" in prompt
    assert "Band 1" in prompt and "Band 2" in prompt
    # Pin the specific don't-round-up framing.
    assert "do NOT round up" in prompt or "do not round up" in prompt.lower()


def test_test_prompt_demands_transcript_phrase_citations_in_feedback():
    """Specificity instruction — every weakness must cite a specific
    phrase from the transcript. Pin the rule so a future tidy-up
    doesn't soften it back to 'be specific' generic-advice."""
    prompt = _load_test_prompt()
    assert "cite a specific phrase" in prompt.lower()
    # The literal Vietnamese citation example anchors the rule.
    assert "trong cụm" in prompt


def test_test_prompt_output_template_includes_rubric_version():
    """The JSON template in the prompt must include the rubric_version
    field — otherwise providers won't emit it and the field will always
    default to v1 even when the new prompt was used."""
    prompt = _load_test_prompt()
    assert '"rubric_version": "v2"' in prompt


def test_practice_prompt_has_low_band_calibration_section():
    """Practice mode is encouraging by design, but L9 anti-inflation
    applies to it too — the overall_band must still be honest."""
    prompt = _load_practice_prompt()
    assert "ANTI-INFLATION" in prompt or "anti-inflation" in prompt
    assert "Calibration and encouragement are\nindependent" in prompt \
        or "calibration and encouragement are independent" in prompt.lower()


def test_practice_prompt_output_template_includes_rubric_version():
    prompt = _load_practice_prompt()
    assert '"rubric_version": "v2"' in prompt


# ── Validator backward-compat (the additive guarantee) ─────────────────────


def _minimum_valid_test_payload(*, with_rubric_version: bool = False) -> dict:
    # Audit 2026-07-02 — the grader no longer emits band_p / p_feedback
    # (pronunciation is audio-measured by Azure). overall_band is the mean of
    # FC / LR / GRA only.
    p = {
        "band_fc":   6,
        "band_lr":   6,
        "band_gra":  6,
        "overall_band": 6.0,
        "fc_feedback":  "Fluency feedback in VN.",
        "lr_feedback":  "Lexical resource feedback in VN.",
        "gra_feedback": "Grammar feedback in VN.",
        "strengths":    ["S1", "S2"],
        "improvements": ["I1", "I2"],
        "improved_response": "Sample band 7+ EN reply.",
    }
    if with_rubric_version:
        p["rubric_version"] = "v2"
    return p


def _minimum_valid_practice_payload(*, with_rubric_version: bool = False) -> dict:
    p = {
        "grammar_issues":       ["Lỗi 1"],
        "vocabulary_issues":    ["Vấn đề 1"],
        "pronunciation_issues": ["Lưu ý 1"],
        "corrections":          [],
        "strengths":            ["Tốt"],
        "sample_answer":        "A sample answer.",
        "overall_band":         6.0,
    }
    if with_rubric_version:
        p["rubric_version"] = "v2"
    return p


def test_validator_accepts_test_payload_without_rubric_version():
    """Backward compat — pre-Sprint-14.5 providers / cached prompt
    responses won't include rubric_version. Validator must still pass
    them, defaulting the version to 'v1'."""
    from services.claude_grader import _parse_and_validate
    raw = json.dumps(_minimum_valid_test_payload(with_rubric_version=False))
    result, err = _parse_and_validate(raw)
    assert err is None, f"validator rejected legacy payload: {err}"
    assert result is not None
    assert result["rubric_version"] == "v1"


def test_validator_passes_rubric_version_through_when_present():
    from services.claude_grader import _parse_and_validate
    raw = json.dumps(_minimum_valid_test_payload(with_rubric_version=True))
    result, err = _parse_and_validate(raw)
    assert err is None
    assert result["rubric_version"] == "v2"


def test_practice_validator_accepts_payload_without_rubric_version():
    from services.claude_grader import _parse_and_validate_practice
    raw = json.dumps(_minimum_valid_practice_payload(with_rubric_version=False))
    result, err = _parse_and_validate_practice(raw)
    assert err is None, f"practice validator rejected legacy payload: {err}"
    assert result["rubric_version"] == "v1"


def test_practice_validator_passes_rubric_version_through_when_present():
    from services.claude_grader import _parse_and_validate_practice
    raw = json.dumps(_minimum_valid_practice_payload(with_rubric_version=True))
    result, err = _parse_and_validate_practice(raw)
    assert err is None
    assert result["rubric_version"] == "v2"


def test_validator_default_is_v1_not_v2_for_missing_field():
    """A future re-write might be tempted to flip the default to 'v2'
    once 14.5 is fully rolled out. That would silently mis-tag every
    legacy DB row that runs through the validator post-fetch. Pin the
    safe default explicitly."""
    from services.claude_grader import _parse_and_validate
    raw = json.dumps(_minimum_valid_test_payload(with_rubric_version=False))
    result, _ = _parse_and_validate(raw)
    assert result["rubric_version"] == "v1"


def test_validator_treats_empty_rubric_version_as_v1():
    """Empty-string `rubric_version` is the same shape as a model that
    obediently produced the field but with no value (e.g. the prompt
    was edited mid-call). Treat empty as legacy."""
    from services.claude_grader import _parse_and_validate
    payload = _minimum_valid_test_payload(with_rubric_version=False)
    payload["rubric_version"] = ""
    raw = json.dumps(payload)
    result, err = _parse_and_validate(raw)
    assert err is None
    assert result["rubric_version"] == "v1"
