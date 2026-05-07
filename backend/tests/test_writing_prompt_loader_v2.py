"""Tests for WritingPromptLoader v2 (Sprint 2.6).

v1 stays the production default until A/B testing confirms v2 quality. These
tests pin the v2 contract — band descriptors, validation rules, chain-of-
thought, calibration loading — so a future regression that strips one of those
features from v2 surfaces immediately.

The v1 backward-compat tests live in test_writing_prompt_loader.py.
"""

import pytest

from services.writing_prompt_loader import (
    DEFAULT_VERSION,
    WritingPromptLoader,
    get_prompt_loader,
)


# ── Version selection + backward-compat ──────────────────────────────


def test_default_version_is_v1():
    """Default version stays v1 — Sprint 2.6 ships v2 OFF by default. A/B
    flipping happens via WRITING_PROMPT_VERSION env var, not by silent
    upgrade. Pin this so a future change to DEFAULT_VERSION doesn't
    accidentally enable v2 in production without an explicit decision."""
    assert DEFAULT_VERSION == "v1"


def test_v1_loader_still_works():
    """Backwards-compat: v1 loader works unchanged after the version-aware
    refactor. Returns >100 chars per level, replaces FORM_OF_ADDRESS, no
    v2-specific markers leaked in."""
    loader = WritingPromptLoader(version="v1")
    prompt = loader.load(level=2, form_of_address="em")
    assert len(prompt) > 100
    assert "{{FORM_OF_ADDRESS}}" not in prompt
    # v2-specific markers must NOT appear in v1 output
    assert "Validation Rules (MANDATORY)" not in prompt
    assert "Chain-of-Thought" not in prompt


def test_v1_prompt_version_stamp_unchanged():
    """v1 still stamps 'v1.0' onto writing_feedback.prompt_version. Existing
    dashboards, the 47 tests pinning 'v1.0' in test_essay_service /
    test_gemini_writing_grader, and the prompt_version column rely on this."""
    loader = WritingPromptLoader(version="v1")
    assert loader.PROMPT_VERSION == "v1.0"


# ── v2 — feature pins ────────────────────────────────────────────────


def test_v2_loader_loads_all_5_levels():
    """v2 must work end-to-end for every level — no missing files."""
    loader = WritingPromptLoader(version="v2")
    for level in [1, 2, 3, 4, 5]:
        prompt = loader.load(level=level)
        assert len(prompt) > 100, f"v2 level {level} prompt too short"
        assert "{{FORM_OF_ADDRESS}}" not in prompt


def test_v2_includes_band_descriptors():
    """v2 persona module ships explicit band descriptors Band 4 → 9. Anchors
    the model to the IELTS rubric instead of vague 'familiar with band
    descriptors' phrasing in v1."""
    loader = WritingPromptLoader(version="v2")
    prompt = loader.load(level=2, form_of_address="em")

    assert "Band 9.0" in prompt
    assert "Band 5.0" in prompt
    assert "Modest User" in prompt
    assert "Competent User" in prompt
    assert "Expert User" in prompt or "Band 9.0 — Expert" in prompt


def test_v2_includes_validation_rules():
    """v2 strict grammar check ships 5 validation rules. Sprint 2.6.2
    rewrote Rule 1 + Rule 4 from MUST/floor wording to typical-distribution
    + anti-fabrication wording (the floor wording was pressuring the model
    to invent errors at band 6.5 — production canary 2026-05-07). Both
    rules MUST still exist; this test pins the new headings + the
    anti-fabrication marker so a future regression that re-introduces a
    blunt floor (or strips a rule outright) surfaces here."""
    loader = WritingPromptLoader(version="v2")
    prompt = loader.load(level=2, form_of_address="em")

    assert "Validation Rules" in prompt
    assert "Mistake Count Consistency with Band" in prompt
    assert "Word Count Caps" in prompt
    assert "Band Consistency" in prompt
    assert "Vietlish Detection Expectation" in prompt
    assert "Improved Essay Realism" in prompt
    # Sprint 2.6.2 anti-fabrication marker must be present, otherwise the
    # 2.6.2 tuning has been stripped and Rule 1 reverted to a blunt floor
    # that re-enables the apostrophe-fabrication bug.
    assert "ANTI-FABRICATION" in prompt
    assert "DO NOT fabricate errors" in prompt


def test_v2_includes_chain_of_thought():
    """v2 output schema ships an 8-step grading process + Pre-Output
    Checklist. Forces the model to think through validation before emitting
    JSON instead of immediately writing scores."""
    loader = WritingPromptLoader(version="v2")
    prompt = loader.load(level=2, form_of_address="em")

    assert "Chain-of-Thought" in prompt
    assert "Step 1: Read holistically" in prompt
    assert "Step 8: Sanity check" in prompt
    assert "Pre-Output Checklist" in prompt


def test_v2_loads_calibration_for_each_level():
    """v2 prepends a level-specific calibration file (few-shot examples)
    before the level prompt. Each level's calibration must reference the
    expected band range to anchor the model."""
    loader = WritingPromptLoader(version="v2")

    cal_signatures = {
        1: ["Band 4.5", "Band 5.5"],
        2: ["Band 6.0", "Band 5.5"],
        3: ["Band 7.0", "Band 6.5"],
        4: ["Band 8.0", "Band 7.5"],
        5: ["Band 8.5", "Band 9.0"],
    }
    for level, signatures in cal_signatures.items():
        prompt = loader.load(level=level)
        assert any(sig in prompt for sig in signatures), (
            f"v2 level {level} prompt missing calibration anchor — "
            f"checked {signatures}"
        )


def test_v2_form_of_address_substitution():
    """{{FORM_OF_ADDRESS}} replaced everywhere across the larger v2 corpus.
    More chances for the placeholder to slip through (calibration files +
    extended persona)."""
    loader = WritingPromptLoader(version="v2")

    for pronoun in ["bạn", "em", "anh", "chị"]:
        prompt = loader.load(level=2, form_of_address=pronoun)
        assert "{{FORM_OF_ADDRESS}}" not in prompt, (
            f"Placeholder leaked with pronoun={pronoun}"
        )


def test_v2_prompt_version_stamp_is_v2_dot_1():
    """Sprint 2.6.2 bumped the v2 stamp 'v2.0' → 'v2.1' to mark the
    anti-fabrication tuning of Rule 1 + Rule 4 + CoT Step 6. Andy's
    A/B SQL filters by this exact string — pin it so a future
    directory-name change or accidental revert doesn't drift the
    persisted stamp. Pre-tuning canary rows remain stamped 'v2.0'."""
    loader = WritingPromptLoader(version="v2")
    assert loader.PROMPT_VERSION == "v2.1"


def test_v2_l1_calibration_pins_mistake_floor():
    """The v2 L1 calibration file must reference the per-band mistake count
    floor — that's the headline upgrade fix for the production
    zero-mistake-Band-5 bug. If a future calibration rewrite drops this
    pin, a Band-5 essay could again return with zero mistakes."""
    loader = WritingPromptLoader(version="v2")
    prompt = loader.load(level=1, form_of_address="em")

    # The L1 calibration example explicitly lists ~12 mistakes for a
    # Band 4.5 essay and explains why (Rule 1 floor for band ≤ 4.5).
    assert "12 mistakes" in prompt or "12+" in prompt


# ── Singleton + per-version cache ────────────────────────────────────


def test_singleton_per_version():
    """get_prompt_loader() caches one instance per version label. Two
    explicit v2 lookups return the same instance; v1 and v2 lookups
    return different instances — preventing cache poisoning across
    versions during a mixed-version A/B run."""
    a = get_prompt_loader(version="v2")
    b = get_prompt_loader(version="v2")
    c = get_prompt_loader(version="v1")
    assert a is b
    assert a is not c


def test_invalid_version_raises():
    """An unknown version label fails fast with FileNotFoundError on the
    missing prompts directory rather than silently composing a partial
    prompt."""
    with pytest.raises(FileNotFoundError):
        WritingPromptLoader(version="v999_nonexistent")


# ── v2 level-specific validation rules (in level files) ──────────────


def test_v2_level_files_reference_calibration():
    """Each v2 level file points the model at its calibration file so the
    model knows few-shot examples are part of the context. A level file
    that forgets this reference would still load (calibration prepended
    automatically) but the model wouldn't know to consult the examples."""
    loader = WritingPromptLoader(version="v2")
    for level in [1, 2, 3, 4, 5]:
        prompt = loader.load(level=level)
        assert f"calibration/l{level}_examples.md" in prompt, (
            f"v2 level {level} prompt missing 'calibration/l{level}_examples.md' reference"
        )


# ── Sprint 2.6.1 — calibration hard-fail ─────────────────────────────
#
# AMBER finding from Sprint 2.6 audit (2026-05-07): a missing v2
# calibration file used to silently fall through, leaving the prompt
# stamped "v2.0" but composed without its headline upgrade. Both
# tests below pin the post-hotfix contract: v2+ MUST have calibration
# (loud failure on missing), v1 MUST NOT (no calibration concept).


def test_v2_missing_calibration_raises_file_not_found(monkeypatch, tmp_path):
    """v2 with a partial directory (shared/ + level files but no
    calibration/) used to load a stamped v2.0 prompt that lacked the
    few-shot anchor. Sprint 2.6.1 hotfix turned this into a loud
    FileNotFoundError so an A/B run can't silently corrupt data."""
    import services.writing_prompt_loader as wpl

    v2 = tmp_path / "v2"
    (v2 / "shared").mkdir(parents=True)
    (v2 / "shared" / "persona_vn_examiner.md").write_text("persona\n")
    (v2 / "shared" / "strict_grammar_check.md").write_text("grammar\n")
    (v2 / "shared" / "output_schema_instructions.md").write_text("schema\n")
    (v2 / "system_l1_strict_grammar_police.md").write_text("L1\n")
    # Intentionally NO calibration/l1_examples.md

    monkeypatch.setattr(wpl, "PROMPTS_BASE_DIR", tmp_path)

    loader = wpl.WritingPromptLoader(version="v2")
    with pytest.raises(FileNotFoundError, match="calibration"):
        loader.load(level=1)


def test_v1_does_not_require_calibration(monkeypatch, tmp_path):
    """Backward-compat: v1 has no calibration concept and must keep
    loading even when no calibration directory exists. Pin so a future
    cleanup of the `if self.version != 'v1'` guard doesn't break v1."""
    import services.writing_prompt_loader as wpl

    v1 = tmp_path / "v1"
    (v1 / "shared").mkdir(parents=True)
    (v1 / "shared" / "persona_vn_examiner.md").write_text("persona\n")
    (v1 / "shared" / "strict_grammar_check.md").write_text("grammar\n")
    (v1 / "shared" / "output_schema_instructions.md").write_text("schema\n")
    (v1 / "system_l1_strict_grammar_police.md").write_text("L1\n")
    # No calibration/ — v1 doesn't need it.

    monkeypatch.setattr(wpl, "PROMPTS_BASE_DIR", tmp_path)

    loader = wpl.WritingPromptLoader(version="v1")
    prompt = loader.load(level=1)  # must NOT raise
    assert "L1" in prompt
    assert "persona" in prompt


def test_v2_level_files_have_level_specific_validation():
    """Each v2 level file ships a 'Validation Rules Specific to LX' section
    layered on top of the global rules in strict_grammar_check.md.
    Catches a regression where a level file is upgraded without its
    level-specific guards."""
    loader = WritingPromptLoader(version="v2")
    for level in [1, 2, 3, 4, 5]:
        prompt = loader.load(level=level)
        assert f"Validation Rules Specific to L{level}" in prompt, (
            f"v2 level {level} missing level-specific validation section"
        )
