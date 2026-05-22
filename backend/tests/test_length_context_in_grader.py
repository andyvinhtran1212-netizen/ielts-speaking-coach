"""
backend/tests/test_length_context_in_grader.py — Sprint 14.7

L8 — the length warning context must be threaded through claude_grader
into the prompt sent to the LLM. The grader prompt is the surface that
actually shapes the model's feedback; the UI banner is the user-facing
surface. Both fire from the same `(fires, context)` pair.

These tests probe `_build_user_message` directly because the full
grade_response coroutine touches the LLM + Supabase + telemetry, none
of which we want in unit tests.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from services import claude_grader                                   # noqa: E402
from services.length_warning import get_length_warning_context       # noqa: E402


def test_user_message_omits_length_context_when_arg_absent():
    """Backward compat — pre-Sprint-14.7 callers don't pass
    length_context. The prompt must look identical to before so old
    test fixtures + production telemetry rate-of-change aren't
    disturbed."""
    msg = claude_grader._build_user_message(
        question="Q",
        transcript="A",
        part=1,
        band_target=6.5,
    )
    assert "AUDIO LENGTH CONTEXT" not in msg


def test_user_message_includes_length_context_when_arg_present():
    """L8 — when get_length_warning_context returns a context string,
    it must appear in the user message under a labelled block so the
    grader sees it as separate signal from SPEAKING METRICS."""
    fires, ctx = get_length_warning_context(1, 18.0)
    assert fires is True   # sanity — picks the warning branch
    msg = claude_grader._build_user_message(
        question="Q",
        transcript="A",
        part=1,
        band_target=6.5,
        length_context=ctx,
    )
    assert "AUDIO LENGTH CONTEXT" in msg
    assert "18.0s" in msg
    assert "Part 1" in msg


def test_user_message_includes_adequate_context_when_above_soft():
    """Even at adequate length we still surface the context so the
    grader's prompt template stays deterministic (no branch missing
    in production telemetry)."""
    fires, ctx = get_length_warning_context(2, 200.0)
    assert fires is False
    msg = claude_grader._build_user_message(
        question="Q",
        transcript="A",
        part=2,
        band_target=6.5,
        length_context=ctx,
    )
    assert "AUDIO LENGTH CONTEXT" in msg
    assert "Adequate length" in msg


def test_grade_response_signature_accepts_length_context_kwarg():
    """Pin the public API surface — grading.py passes length_context
    as a kwarg. If the grader signature drops this param, the endpoint
    breaks silently (kwarg passes through **kwargs in TypeError-free
    paths)."""
    import inspect
    sig = inspect.signature(claude_grader.grade_response)
    assert "length_context" in sig.parameters
    # Default must be None so callers that don't pass it keep working.
    assert sig.parameters["length_context"].default is None
