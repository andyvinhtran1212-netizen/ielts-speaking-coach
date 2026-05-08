"""Tests for WritingPromptLoader.load_quick (Sprint 2.7a).

Pin the Quick-tier prompt assembly contract:
  - v2 loader composes persona + anti-fabrication + Quick output schema
    + Quick level file
  - v1 raises (Quick is v2-only)
  - Missing Quick level file is a hard FileNotFoundError (no silent
    fall-through — the same loud-fail pattern Sprint 2.6.1 introduced
    for v2 calibration)
  - Calibration is intentionally OMITTED for Quick (token savings)
  - Anti-fabrication clause from Sprint 2.6.2 still appears (Flash is
    more prone to fabrication than Pro, so the clause is even more
    important for Quick)
"""

import pytest

from services.writing_prompt_loader import WritingPromptLoader


# ── Happy path ───────────────────────────────────────────────────────


def test_load_quick_v2_loads_all_5_levels():
    """v2 Quick must work end-to-end for every level — no missing files."""
    loader = WritingPromptLoader(version="v2")
    for level in [1, 2, 3, 4, 5]:
        prompt = loader.load_quick(level=level)
        assert len(prompt) > 100, f"v2 Quick level {level} prompt too short"
        assert "{{FORM_OF_ADDRESS}}" not in prompt


def test_load_quick_includes_quick_marker():
    """The Quick output schema instructions must be present so Gemini
    knows to emit the 5-section subset (not the full 12-section)."""
    loader = WritingPromptLoader(version="v2")
    prompt = loader.load_quick(level=1)
    # Headers from output_schema_instructions_quick.md
    assert "Quick Tier" in prompt
    assert "5 sections" in prompt or "five sections" in prompt.lower()


def test_load_quick_includes_anti_fabrication_clause():
    """Sprint 2.6.2 anti-fabrication wording carries over to Quick.
    Flash is more prone to hallucination than Pro — the same authenticity
    rule (`original != suggestion` after Unicode normalisation) applies."""
    loader = WritingPromptLoader(version="v2")
    prompt = loader.load_quick(level=1)
    assert "ANTI-FABRICATION" in prompt
    assert "DO NOT fabricate errors" in prompt


def test_load_quick_omits_calibration():
    """Quick intentionally drops calibration files for token savings.
    Calibration markers from `calibration/lN_examples.md` (e.g. specific
    band-anchor headings) must not appear in the composed Quick prompt."""
    loader = WritingPromptLoader(version="v2")
    prompt = loader.load_quick(level=1)
    # Standard's L1 calibration mentions "12 mistakes" / "12+" as the
    # band-floor anchor (test_v2_l1_calibration_pins_mistake_floor pins
    # this for Standard). Quick should NOT contain that calibration text.
    standard_prompt = loader.load(level=1)
    assert "12 mistakes" in standard_prompt or "12+" in standard_prompt, (
        "Calibration marker should be in Standard L1 — sanity check"
    )
    # Quick: no calibration anchor markers.
    assert "12 mistakes" not in prompt
    assert "calibration/l1_examples.md" not in prompt


def test_load_quick_smaller_than_standard():
    """Quick is meaningfully smaller than Standard — that's its whole
    cost/latency value proposition. Pin a sanity threshold (Quick should
    be at most 80% of Standard's size; in practice it's ~60–65%)."""
    loader = WritingPromptLoader(version="v2")
    standard = loader.load(level=1)
    quick = loader.load_quick(level=1)
    ratio = len(quick) / len(standard)
    assert ratio < 0.80, (
        f"Quick L1 should be < 80% the size of Standard L1, "
        f"got ratio={ratio:.2f} ({len(quick)} vs {len(standard)} chars)"
    )


def test_load_quick_form_of_address_substitution():
    """{{FORM_OF_ADDRESS}} replaced everywhere across the Quick corpus.
    Same guard as the Standard test."""
    loader = WritingPromptLoader(version="v2")
    for pronoun in ["bạn", "em", "anh", "chị"]:
        prompt = loader.load_quick(level=1, form_of_address=pronoun)
        assert "{{FORM_OF_ADDRESS}}" not in prompt, (
            f"Placeholder leaked with pronoun={pronoun}"
        )


# ── Error paths ──────────────────────────────────────────────────────


def test_load_quick_v1_raises_value_error():
    """Quick is v2-only by design — the cost/quality split only makes
    sense once v2's structured rules exist. v1 + Quick must fail loud."""
    loader = WritingPromptLoader(version="v1")
    with pytest.raises(ValueError, match="v2"):
        loader.load_quick(level=1)


def test_load_quick_invalid_level_raises():
    """Levels are 1-5; reject anything outside."""
    loader = WritingPromptLoader(version="v2")
    with pytest.raises(ValueError, match="level"):
        loader.load_quick(level=99)


def test_load_quick_missing_file_raises_file_not_found(monkeypatch, tmp_path):
    """A v2-style directory missing a `quick/system_lN_quick.md` file
    must raise FileNotFoundError loudly (not silently fall through to a
    truncated prompt). Same loud-fail pattern as Sprint 2.6.1's
    calibration hard-fail."""
    import services.writing_prompt_loader as wpl

    # Build a minimal v2 layout with shared/ but no quick/.
    v2 = tmp_path / "v2"
    (v2 / "shared").mkdir(parents=True)
    (v2 / "shared" / "persona_vn_examiner.md").write_text("persona\n")
    (v2 / "shared" / "strict_grammar_check.md").write_text("grammar\n")
    (v2 / "shared" / "output_schema_instructions_quick.md").write_text("schema-quick\n")
    # Intentionally NO quick/system_l1_quick.md

    monkeypatch.setattr(wpl, "PROMPTS_BASE_DIR", tmp_path)

    loader = wpl.WritingPromptLoader(version="v2")
    with pytest.raises(FileNotFoundError, match="quick"):
        loader.load_quick(level=1)


def test_load_quick_missing_quick_schema_raises(monkeypatch, tmp_path):
    """Missing `shared/output_schema_instructions_quick.md` must also
    fail loud — half-composed Quick prompts (no schema instructions)
    would silently produce malformed output."""
    import services.writing_prompt_loader as wpl

    v2 = tmp_path / "v2"
    (v2 / "shared").mkdir(parents=True)
    (v2 / "shared" / "persona_vn_examiner.md").write_text("persona\n")
    (v2 / "shared" / "strict_grammar_check.md").write_text("grammar\n")
    # NO output_schema_instructions_quick.md
    (v2 / "quick").mkdir()
    (v2 / "quick" / "system_l1_quick.md").write_text("L1 quick\n")

    monkeypatch.setattr(wpl, "PROMPTS_BASE_DIR", tmp_path)

    loader = wpl.WritingPromptLoader(version="v2")
    with pytest.raises(FileNotFoundError):
        loader.load_quick(level=1)
