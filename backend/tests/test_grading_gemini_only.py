"""backend/tests/test_grading_gemini_only.py — audit 2026-07-02 (P2 review)

A Gemini-only deployment (SPEAKING_GRADING_MODEL=gemini-*, only GEMINI_API_KEY
set, no ANTHROPIC_API_KEY) must be able to grade. Previously grade_response()
eagerly called _get_client(), which RAISES when ANTHROPIC_API_KEY is empty —
failing every request before the orchestrator (Gemini) was ever reached. The fix
makes the Anthropic client lazy/optional (only needed for the optional
sample-regeneration step). This test drives the full grade_response coroutine
with a fake orchestrator and no Anthropic key.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from config import settings                    # noqa: E402
from services import claude_grader             # noqa: E402


class _FakeOrchestrator:
    """Returns a canned raw JSON string; records the provider order it was
    invoked with (to prove the grader routed through the configurable chain)."""

    def __init__(self, raw: str):
        self._raw = raw
        self.orders: list = []

    async def invoke(self, system_prompt, user_message, *,
                     user_id=None, session_id=None, order=None):
        self.orders.append(order)
        return self._raw, []


# Valid TEST-mode grade (no band_p/p_feedback — those come from Azure now). The
# improved_response overlaps the transcript so the relevance guard does NOT try
# to regenerate (which is the only path that would touch the Anthropic client).
_VALID_TEST_JSON = json.dumps({
    "band_fc": 6, "band_lr": 6, "band_gra": 6, "overall_band": 6.0,
    "fc_feedback": "Nói khá trôi chảy.",
    "lr_feedback": "Từ vựng ổn.",
    "gra_feedback": "Ngữ pháp ổn.",
    "strengths": ["Phát triển ý tốt"],
    "improvements": ["Dùng từ đa dạng hơn"],
    "improved_response": "I really love reading books because reading relaxes me after a long day.",
    "rubric_version": "v3",
})


def test_grade_response_succeeds_without_anthropic_key(monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "", raising=False)
    monkeypatch.setattr(claude_grader, "_client", None, raising=False)
    fake = _FakeOrchestrator(_VALID_TEST_JSON)
    claude_grader.set_orchestrator(fake)
    try:
        result = asyncio.run(claude_grader.grade_response(
            question="What do you like to do in your free time?",
            transcript="I really love reading books because reading relaxes me after work.",
            part=1,
            mode="test",
        ))
    finally:
        claude_grader.set_orchestrator(None)

    # Graded successfully — no RuntimeError about a missing ANTHROPIC_API_KEY.
    assert result["overall_band"] == 6.0
    assert result["band_fc"] == 6
    assert "band_p" not in result   # P is Azure's job, merged later by grading.py
    # The grader routed through the orchestrator (configurable order), not a
    # direct Anthropic-only call.
    assert fake.orders and fake.orders[0] is not None


def test_get_client_still_raises_when_key_absent(monkeypatch):
    """Sanity: _get_client() itself still raises — the fix is that
    grade_response tolerates that, not that _get_client changed."""
    import pytest
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "", raising=False)
    monkeypatch.setattr(claude_grader, "_client", None, raising=False)
    with pytest.raises(RuntimeError):
        claude_grader._get_client()
