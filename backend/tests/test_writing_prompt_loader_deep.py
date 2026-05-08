"""Tests for WritingPromptLoader Deep-tier methods (Sprint 2.7b).

Pin the loader contract for `load_deep_pass2` + `load_deep_pass3`:

  - Happy path on v2: returns the markdown string with the expected
    section markers from the live prompt files.
  - v1 raises ValueError (Deep is v2+ only — the cost/quality story
    relies on v2's structured rules; v1 has no Deep variant).
  - A missing prompt file (e.g. someone deleted shared/deep_pass2_refine.md
    by accident) raises FileNotFoundError loudly via `_load_file`.
  - Invalid `level` rejected at the loader boundary.
"""

from __future__ import annotations

import pytest

from services.writing_prompt_loader import WritingPromptLoader


# ── Happy path on v2 ──────────────────────────────────────────────────

def test_load_deep_pass2_v2_returns_prompt_with_expected_markers():
    """v2 ships shared/deep_pass2_refine.md. The loader returns it
    verbatim. We pin a few headline section markers so a future edit
    that strips the anti-fabrication carryover or removes the empty-
    result-is-acceptable rule surfaces here, not in production drift.
    """
    loader = WritingPromptLoader(version="v2")
    prompt = loader.load_deep_pass2(level=3)

    assert isinstance(prompt, str)
    assert len(prompt) > 200
    # Pass 2 is a refinement pass — the prompt must say so.
    assert "Pass 2" in prompt
    assert "Refinement" in prompt or "refinement" in prompt.lower()
    # Anti-fabrication carryover from Sprint 2.6.2.
    assert "anti-fabrication" in prompt.lower()
    # The output schema must mention the four nested band-score keys
    # the merge logic in `_merge_pass1_pass2` reads.
    assert "band_score_adjustments" in prompt
    assert "added_mistakes" in prompt
    assert "removed_mistake_indexes" in prompt


def test_load_deep_pass3_v2_returns_prompt_with_expected_markers():
    """v2 ships shared/deep_pass3_rewrite.md. Pin the sentence-rewrite
    contract: the prompt must instruct one-rewrite-per-sentence and
    output the `sentence_rewrites` array shape the schema expects.
    """
    loader = WritingPromptLoader(version="v2")
    prompt = loader.load_deep_pass3(level=3)

    assert isinstance(prompt, str)
    assert len(prompt) > 200
    assert "Pass 3" in prompt
    assert "rewrite" in prompt.lower()
    assert "sentence_rewrites" in prompt
    # The Pydantic schema field names — fail loudly if the prompt
    # ever drifts away from what `Pass3Rewrites` parses.
    assert "original_sentence" in prompt
    assert "rewritten_sentence" in prompt
    assert "mistakes_addressed" in prompt


def test_load_deep_pass2_shared_across_levels():
    """The Pass 2 prompt is shared across L1-L5 by design (no
    per-level persona variants in 2.7b — the spec defers that). Pin
    this so a future per-level split is a deliberate decision, not a
    silent file rename.
    """
    loader = WritingPromptLoader(version="v2")
    prompts = [loader.load_deep_pass2(level=lv) for lv in (1, 2, 3, 4, 5)]
    assert all(p == prompts[0] for p in prompts), (
        "Pass 2 prompt should be identical across levels in 2.7b"
    )


def test_load_deep_pass3_shared_across_levels():
    """Same shared-across-levels invariant as Pass 2."""
    loader = WritingPromptLoader(version="v2")
    prompts = [loader.load_deep_pass3(level=lv) for lv in (1, 2, 3, 4, 5)]
    assert all(p == prompts[0] for p in prompts)


# ── v1 rejection ──────────────────────────────────────────────────────

def test_load_deep_pass2_v1_raises_value_error():
    """v1 has no Deep tier support. The loader must raise ValueError
    with a message pointing at the env-var fix so the developer
    doesn't need to grep for it."""
    loader = WritingPromptLoader(version="v1")
    with pytest.raises(ValueError, match="v2"):
        loader.load_deep_pass2(level=3)


def test_load_deep_pass3_v1_raises_value_error():
    loader = WritingPromptLoader(version="v1")
    with pytest.raises(ValueError, match="v2"):
        loader.load_deep_pass3(level=3)


# ── Invalid level rejected at the loader boundary ─────────────────────

def test_load_deep_pass2_invalid_level_raises_value_error():
    """An invalid level must surface a clear ValueError — defence
    against a future caller that bypasses the GraderConfig boundary."""
    loader = WritingPromptLoader(version="v2")
    with pytest.raises(ValueError, match="level"):
        loader.load_deep_pass2(level=0)
    with pytest.raises(ValueError, match="level"):
        loader.load_deep_pass2(level=6)


def test_load_deep_pass3_invalid_level_raises_value_error():
    loader = WritingPromptLoader(version="v2")
    with pytest.raises(ValueError, match="level"):
        loader.load_deep_pass3(level=0)
    with pytest.raises(ValueError, match="level"):
        loader.load_deep_pass3(level=6)


# ── Missing prompt file → loud FileNotFoundError ──────────────────────

def test_load_deep_pass2_missing_file_raises_file_not_found(monkeypatch):
    """If shared/deep_pass2_refine.md is removed (file rename, bad
    deploy), the loader must raise FileNotFoundError loudly rather
    than degrade silently. We simulate the missing file by pointing
    the loader at a constant that doesn't exist on disk.
    """
    loader = WritingPromptLoader(version="v2")
    # Bust the per-instance cache so the missing-file branch executes.
    loader._cache.pop(loader.DEEP_PASS2_FILE, None)
    monkeypatch.setattr(
        loader, "DEEP_PASS2_FILE",
        "shared/does_not_exist_deep_pass2.md",
    )
    with pytest.raises(FileNotFoundError, match="Prompt file not found"):
        loader.load_deep_pass2(level=3)


def test_load_deep_pass3_missing_file_raises_file_not_found(monkeypatch):
    loader = WritingPromptLoader(version="v2")
    loader._cache.pop(loader.DEEP_PASS3_FILE, None)
    monkeypatch.setattr(
        loader, "DEEP_PASS3_FILE",
        "shared/does_not_exist_deep_pass3.md",
    )
    with pytest.raises(FileNotFoundError, match="Prompt file not found"):
        loader.load_deep_pass3(level=3)


# ── Cache reuse (cheap repeat calls) ──────────────────────────────────

def test_load_deep_pass2_uses_per_instance_cache():
    """Repeated calls hit the same cache entry — `_load_file` populates
    `_cache[relative_path]` on first read and reuses thereafter. Pin
    so a cache regression doesn't quietly re-read the file every call."""
    loader = WritingPromptLoader(version="v2")
    # Force a fresh cache.
    loader._cache.clear()
    _ = loader.load_deep_pass2(level=3)
    assert loader.DEEP_PASS2_FILE in loader._cache

    # Subsequent call should not change cache size.
    cache_size_before = len(loader._cache)
    _ = loader.load_deep_pass2(level=3)
    assert len(loader._cache) == cache_size_before
