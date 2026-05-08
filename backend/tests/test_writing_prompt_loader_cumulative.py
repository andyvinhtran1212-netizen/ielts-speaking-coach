"""Tests for cumulative section composition (Sprint 2.7c).

The cumulative refactor split per-level section instructions into 5
shared modules under `prompts/writing/v2/shared/sections/`. Each level's
prompt now includes its own section module PLUS every lower-level
module — the composition is data-driven by `LEVEL_SECTIONS`.

These tests pin:
  - Per-level loaded section set (L1 base only → L5 all five)
  - L1 must NOT contain higher-level section markers (no over-loading)
  - LEVEL_SECTIONS dict matches the section-files-on-disk
  - Sprint 2.6.2 anti-fabrication marker survives in EVERY level
  - Each level still references its calibration file
  - Each level still has "Validation Rules Specific to L{N}" marker
  - v1 backward compat: NO section composition on v1 (v1 has no
    sections/ subdirectory and the loader's cumulative branch is gated
    on `version != 'v1'`)
"""

from __future__ import annotations

from pathlib import Path

import pytest

from services.writing_prompt_loader import WritingPromptLoader


# Section markers — header lines from the section module files. Pinning
# the leading "# SECTION:" prefix avoids accidental matches against
# prose in level files that *reference* the modules by name.

SECTION_MARKERS = {
    "base":           "# SECTION: BASE 5 SECTIONS",
    "coherence":      "# SECTION: COHERENCE DEEP",
    "counterargument":"# SECTION: COUNTERARGUMENT IDEA",
    "lexical":        "# SECTION: LEXICAL SENTENCE",
    "pedantic":       "# SECTION: PEDANTIC FULL",
}


def _level_markers(prompt: str) -> set[str]:
    """Return the set of section-module names actually loaded into
    `prompt` (by header presence). Used to assert the cumulative set."""
    return {name for name, marker in SECTION_MARKERS.items() if marker in prompt}


# ── L1 → L5 cumulative composition ────────────────────────────────────


@pytest.mark.parametrize("level,expected", [
    (1, {"base"}),
    (2, {"base", "coherence"}),
    (3, {"base", "coherence", "counterargument"}),
    (4, {"base", "coherence", "counterargument", "lexical"}),
    (5, {"base", "coherence", "counterargument", "lexical", "pedantic"}),
])
def test_v2_loads_cumulative_section_set_per_level(level, expected):
    """Each level loads exactly its cumulative section set — no
    leakage upward (L1 must not see L4's lexical module) or
    downward (L5 must include all lower modules)."""
    loader = WritingPromptLoader(version="v2")
    prompt = loader.load(level=level)
    assert _level_markers(prompt) == expected, (
        f"L{level} loaded {_level_markers(prompt)}, expected {expected}"
    )


def test_v2_l1_does_not_include_higher_level_section_modules():
    """L1 prompt must not contain the section-header markers for
    L2+ modules. A tighter pin than the parametrized test — surfaces
    a regression where someone adds 'sections/coherence_deep.md' to
    LEVEL_SECTIONS[1] by accident."""
    loader = WritingPromptLoader(version="v2")
    prompt = loader.load(level=1)
    for name in ("coherence", "counterargument", "lexical", "pedantic"):
        assert SECTION_MARKERS[name] not in prompt, (
            f"L1 leaked the {name} section header — LEVEL_SECTIONS regression"
        )


def test_v2_l5_includes_all_section_modules():
    """L5 = full cumulative coverage. Every section header must be
    present in the composed prompt."""
    loader = WritingPromptLoader(version="v2")
    prompt = loader.load(level=5)
    for name, marker in SECTION_MARKERS.items():
        assert marker in prompt, f"L5 missing {name} section header"


def test_level_sections_constant_matches_disk():
    """LEVEL_SECTIONS must reference real files. Defence against a
    rename that updates one but not the other."""
    base = Path(__file__).parent.parent / "prompts" / "writing" / "v2"
    for level, files in WritingPromptLoader.LEVEL_SECTIONS.items():
        for relative in files:
            assert (base / relative).exists(), (
                f"LEVEL_SECTIONS[{level}] references missing file: {relative}"
            )


def test_level_sections_is_strictly_cumulative():
    """LEVEL_SECTIONS[N] ⊆ LEVEL_SECTIONS[N+1]. Pinning the cumulative
    invariant in the constant itself — a future edit that drops a
    file from a higher level (e.g., L3 missing base_5_sections) is a
    bug, not a feature."""
    sections = WritingPromptLoader.LEVEL_SECTIONS
    for level in (1, 2, 3, 4):
        lower = set(sections[level])
        higher = set(sections[level + 1])
        assert lower.issubset(higher), (
            f"LEVEL_SECTIONS[{level + 1}] is missing files from "
            f"LEVEL_SECTIONS[{level}]: {lower - higher}"
        )


# ── Tuning preservation (Sprint 2.6.2 anti-fabrication) ───────────────


def test_anti_fabrication_marker_survives_in_every_level():
    """Sprint 2.6.2 anti-fabrication rule MUST appear in every level's
    composed prompt. The refactor moved section-format text out of
    level files but left the global validation rules in
    shared/strict_grammar_check.md, which is loaded for every level.
    Pin so a regression that strips the anti-fabrication block (or
    accidentally drops strict_grammar_check from SHARED_FILES) is
    caught before it ships."""
    loader = WritingPromptLoader(version="v2")
    for level in (1, 2, 3, 4, 5):
        prompt = loader.load(level=level)
        assert "ANTI-FABRICATION" in prompt, (
            f"L{level} composed prompt missing ANTI-FABRICATION marker — "
            f"the 2.6.2 tuning has been stripped"
        )
        assert "DO NOT fabricate errors" in prompt, (
            f"L{level} composed prompt missing 'DO NOT fabricate errors'"
        )


def test_chain_of_thought_survives_in_every_level():
    """The 8-step CoT lives in shared/output_schema_instructions.md
    and must appear in every composed prompt regardless of level."""
    loader = WritingPromptLoader(version="v2")
    for level in (1, 2, 3, 4, 5):
        prompt = loader.load(level=level)
        assert "Chain-of-Thought" in prompt
        assert "Step 1: Read holistically" in prompt
        assert "Step 8: Sanity check" in prompt


def test_calibration_referenced_per_level():
    """Each level still references its level-specific calibration
    file. The existing v2 test pins the same — duplicated here as a
    cumulative-refactor regression guard."""
    loader = WritingPromptLoader(version="v2")
    for level in (1, 2, 3, 4, 5):
        prompt = loader.load(level=level)
        assert f"calibration/l{level}_examples.md" in prompt, (
            f"L{level} composed prompt missing its calibration reference"
        )


def test_level_specific_validation_rules_marker_survives():
    """Each level file still has its 'Validation Rules Specific to
    L{N}' header. This is the marker the existing v2 test
    (`test_v2_level_files_have_level_specific_validation`) pins —
    duplicate here so a cumulative-refactor regression surfaces in
    this file too."""
    loader = WritingPromptLoader(version="v2")
    for level in (1, 2, 3, 4, 5):
        prompt = loader.load(level=level)
        assert f"Validation Rules Specific to L{level}" in prompt


# ── v1 backward compat ────────────────────────────────────────────────


def test_v1_loader_does_not_compose_sections():
    """v1 has no `sections/` subdirectory. The cumulative branch is
    gated on `version != 'v1'`; pin so a future loader change doesn't
    accidentally try to load v1 section files (which don't exist) and
    crash legacy A/B traffic."""
    loader = WritingPromptLoader(version="v1")
    prompt = loader.load(level=3)
    # No section headers should appear in v1 output.
    for marker in SECTION_MARKERS.values():
        assert marker not in prompt, (
            f"v1 prompt contains v2-only section header {marker!r} — "
            f"the cumulative branch is leaking into v1"
        )


def test_v1_section_directory_does_not_exist():
    """The sections/ subdirectory is v2-only. Pin so a misguided
    'symmetry' refactor that mirrors v2 structure into v1 surfaces
    explicitly — v1 is frozen (legacy A/B baseline) and shouldn't
    grow new files."""
    base = Path(__file__).parent.parent / "prompts" / "writing" / "v1"
    assert not (base / "shared" / "sections").exists(), (
        "v1 must not have a sections/ directory — v1 is frozen"
    )
