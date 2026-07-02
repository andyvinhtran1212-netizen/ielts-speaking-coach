"""backend/tests/test_grading_model_config.py — audit 2026-07-02

The Speaking grader's primary model is now configurable via
``settings.SPEAKING_GRADING_MODEL`` and registered under the
``grading_primary`` provider key by :func:`build_default`. These tests pin:

  * prefix routing (gemini-* → Gemini, claude-*/anthropic-* → Claude)
  * graceful degradation when the model id is empty / the key is missing /
    the prefix is unrecognized (→ None → orchestrator skips to Haiku)
  * the grader order puts grading_primary FIRST, then the Anthropic fallback,
    while the judge's DEFAULT order stays Haiku-first (unchanged)
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grading_orchestrator import (        # noqa: E402
    DEFAULT_PROVIDER_ORDER,
    GRADING_PROVIDER_ORDER,
    _build_grading_primary,
    build_default,
)
from services.grading_providers.claude import ClaudeProvider  # noqa: E402
from services.grading_providers.gemini import GeminiProvider   # noqa: E402


# ── Order invariants ────────────────────────────────────────────────────────

def test_grader_order_primary_first_then_anthropic():
    assert GRADING_PROVIDER_ORDER[0] == "grading_primary"
    assert GRADING_PROVIDER_ORDER == ("grading_primary", "claude_haiku", "claude_sonnet")


def test_judge_default_order_unchanged_haiku_first():
    # Upgrading the grader must not raise the judge's cost — its order is
    # still Haiku-first and carries no grading_primary slot.
    assert DEFAULT_PROVIDER_ORDER[0] == "claude_haiku"
    assert "grading_primary" not in DEFAULT_PROVIDER_ORDER


# ── Prefix routing ──────────────────────────────────────────────────────────

def test_gemini_prefix_routes_to_gemini_provider():
    p = _build_grading_primary("gemini-3-flash-preview", anthropic_key="a", gemini_key="g")
    assert isinstance(p, GeminiProvider)
    assert p.model_name == "gemini-3-flash-preview"
    assert p.provider_name == "grading_primary"


def test_claude_prefix_routes_to_claude_provider():
    p = _build_grading_primary("claude-sonnet-5", anthropic_key="a", gemini_key="g")
    assert isinstance(p, ClaudeProvider)
    assert p.model == "claude-sonnet-5"
    assert p.provider_name == "grading_primary"


def test_anthropic_prefix_routes_to_claude_provider():
    p = _build_grading_primary("anthropic.claude-opus-4-8", anthropic_key="a", gemini_key="g")
    assert isinstance(p, ClaudeProvider)
    assert p.model == "anthropic.claude-opus-4-8"


# ── Graceful degradation ────────────────────────────────────────────────────

def test_empty_model_returns_none():
    assert _build_grading_primary("", anthropic_key="a", gemini_key="g") is None


def test_gemini_without_key_returns_none():
    assert _build_grading_primary("gemini-3-flash-preview", anthropic_key="a", gemini_key="") is None


def test_claude_without_key_returns_none():
    assert _build_grading_primary("claude-sonnet-5", anthropic_key="", gemini_key="g") is None


def test_unrecognized_prefix_returns_none():
    assert _build_grading_primary("gpt-5", anthropic_key="a", gemini_key="g") is None


# ── build_default registration ──────────────────────────────────────────────

def test_build_default_registers_grading_primary_when_configured():
    settings = SimpleNamespace(
        ANTHROPIC_API_KEY="a", GEMINI_API_KEY="g",
        SPEAKING_GRADING_MODEL="gemini-3-flash-preview",
    )
    orch = build_default(settings)
    assert "grading_primary" in orch.providers
    assert "claude_haiku" in orch.providers
    assert "claude_sonnet" in orch.providers


def test_build_default_skips_grading_primary_when_unset():
    settings = SimpleNamespace(
        ANTHROPIC_API_KEY="a", GEMINI_API_KEY="g",
        SPEAKING_GRADING_MODEL="",
    )
    orch = build_default(settings)
    assert "grading_primary" not in orch.providers
    # Anthropic fallback chain still present → grader degrades to Haiku.
    assert "claude_haiku" in orch.providers


def test_build_default_gemini_primary_without_gemini_key_skips():
    settings = SimpleNamespace(
        ANTHROPIC_API_KEY="a", GEMINI_API_KEY="",
        SPEAKING_GRADING_MODEL="gemini-3-flash-preview",
    )
    orch = build_default(settings)
    assert "grading_primary" not in orch.providers
    assert "claude_haiku" in orch.providers
