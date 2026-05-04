"""Tests for WritingPromptLoader (Sprint W1 Phase 2)."""

import pytest

from services.writing_prompt_loader import WritingPromptLoader, get_prompt_loader


def test_loader_loads_all_5_levels():
    """All 5 levels return non-empty composed prompts."""
    loader = WritingPromptLoader()
    for level in [1, 2, 3, 4, 5]:
        prompt = loader.load(level=level)
        assert len(prompt) > 100, f"Level {level} prompt too short ({len(prompt)} chars)"


def test_loader_replaces_form_of_address():
    """{{FORM_OF_ADDRESS}} placeholder replaced; raw token never leaks."""
    loader = WritingPromptLoader()

    prompt_em = loader.load(level=3, form_of_address="em")
    prompt_anh = loader.load(level=3, form_of_address="anh")

    assert "{{FORM_OF_ADDRESS}}" not in prompt_em
    assert "{{FORM_OF_ADDRESS}}" not in prompt_anh

    # The substituted pronoun appears in the prompt
    assert "em" in prompt_em or "Em" in prompt_em
    assert "anh" in prompt_anh or "Anh" in prompt_anh


def test_loader_invalid_level_raises():
    """Level 0 or 6 raises ValueError."""
    loader = WritingPromptLoader()

    with pytest.raises(ValueError):
        loader.load(level=0)
    with pytest.raises(ValueError):
        loader.load(level=6)


def test_singleton_returns_same_instance():
    """get_prompt_loader() returns the same instance across calls."""
    a = get_prompt_loader()
    b = get_prompt_loader()
    assert a is b


def test_loader_includes_shared_modules():
    """All composed prompts include the persona + strict grammar shared modules."""
    loader = WritingPromptLoader()
    prompt = loader.load(level=3)

    # Strict Grammar Check shared module is present
    assert "Strict Grammar Check" in prompt or "Ngữ pháp" in prompt

    # VN Examiner persona is present
    assert "Vietnam" in prompt or "Việt Nam" in prompt or "examiner" in prompt.lower()


def test_loader_level_5_more_strict_than_1():
    """L5 prompt references the pedantic / nuance vocabulary L1 doesn't."""
    loader = WritingPromptLoader()

    l1_prompt = loader.load(level=1)
    l5_prompt = loader.load(level=5)

    # L5-only signal terms (per planner-updated test expectation)
    l5_signal_terms = ["Pedantic", "tinh tế", "khắt khe"]
    assert any(term in l5_prompt for term in l5_signal_terms), (
        f"L5 prompt missing high-level analysis signal — checked {l5_signal_terms}"
    )

    # L1 should be lighter — at least one of those terms should be absent there
    assert any(term not in l1_prompt for term in l5_signal_terms), (
        "Sanity: L1 unexpectedly contains all L5 signal terms"
    )


def test_loader_caches_file_reads():
    """Second .load() call uses cache (same content, no re-read)."""
    loader = WritingPromptLoader()
    first = loader.load(level=2)
    second = loader.load(level=2)
    assert first == second
    # Cache populated for shared + level-2 files
    assert len(loader._cache) >= 4


def test_list_available_levels():
    loader = WritingPromptLoader()
    assert loader.list_available_levels() == [1, 2, 3, 4, 5]
