"""B4 — AI-call hardening (testable slices).

Mục 30: listening_gist_grader._extract_json must decode the FIRST JSON object,
not greedily span first-'{' to last-'}' (two objects → invalid blob).

Mục 29: gemini._call_gemini must normalise a raw SDK/network error into a
ValueError so callers fall back instead of leaking an unhandled SDK exception.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from services.listening_gist_grader import _extract_json


# ── Mục 30 — robust JSON extraction ───────────────────────────────────


def test_extract_json_returns_first_object_when_two_present():
    """The old greedy regex merged both objects into one invalid blob."""
    text = 'Result: {"score": 80, "feedback": "good"} and also {"score": 0}'
    assert _extract_json(text) == {"score": 80, "feedback": "good"}


def test_extract_json_handles_code_fence_and_leading_text():
    text = 'Sure, here it is!\n```json\n{"score": 55, "feedback": "ok"}\n```'
    assert _extract_json(text) == {"score": 55, "feedback": "ok"}


def test_extract_json_raises_when_no_object():
    with pytest.raises(ValueError):
        _extract_json("there is no json object here")


def test_extract_json_raises_when_value_is_not_object():
    with pytest.raises(ValueError):
        _extract_json('[1, 2, 3]')   # find('{') == -1 → no object


# ── Mục 29 — Gemini SDK errors are normalised to ValueError ────────────


def test_gemini_sdk_error_is_normalised_to_valueerror(monkeypatch):
    from services import gemini

    class _BoomModel:
        async def generate_content_async(self, _prompt):
            raise RuntimeError("429 quota exceeded — raw SDK error")

    monkeypatch.setattr(gemini, "_model", _BoomModel())

    with pytest.raises(ValueError) as ei:
        asyncio.run(gemini._call_gemini("anything"))
    # the raw SDK RuntimeError must NOT escape unhandled
    assert not isinstance(ei.value, RuntimeError)
