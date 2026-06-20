"""PR-2 grader robustness — parse-fail is retryable + max_output_tokens set.

A truncated/malformed JSON body used to fail HARD (parse ran OUTSIDE the retry
loop). Now _call_with_retry validates inside the loop → a bad body re-rolls with
backoff. max_output_tokens is raised so long L4/L5 feedback isn't truncated.
AISafetyBlockError stays non-retryable. Drives the REAL _call_with_retry with
generate_content mocked (existing tier tests mock _call_with_retry itself).
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from models.writing_feedback import WritingFeedback
from services.gemini_writing_grader import (
    AISafetyBlockError,
    GeminiWritingGrader,
    InvalidJSONError,
    GenerationConfig,
)


VALID = {
    "overallBandScore": 6.5, "overallBandScoreSummary": "s",
    "keyTakeaways": {"strengths": ["s"], "areasForImprovement": ["a"]},
    "criteriaFeedback": {
        "mainCriterion":     {"title": "T", "explanation": "e", "feedback": "f", "bandScore": 6},
        "coherenceCohesion": {"title": "T", "explanation": "e", "feedback": "f", "bandScore": 6},
        "lexicalResource":   {"title": "T", "explanation": "e", "feedback": "f", "bandScore": 7},
        "grammaticalRange":  {"title": "T", "explanation": "e", "feedback": "f", "bandScore": 6},
    },
    "mistakeAnalysis": [], "aiContentAnalysis": {"likelihood": 5, "explanation": "n"},
    "improvedEssay": "x",
}
VALID_JSON = json.dumps(VALID)
TRUNCATED_JSON = VALID_JSON[:120]   # cut mid-object → json.loads fails


@pytest.fixture
def grader():
    with patch("services.gemini_writing_grader.settings") as ms, \
         patch("services.gemini_writing_grader.genai.configure"):
        ms.GEMINI_API_KEY = "k"; ms.GEMINI_FLASH_MODEL = "f"; ms.GEMINI_PRO_MODEL = "p"
        yield GeminiWritingGrader()


def _resp(text, safety=False):
    fr = SimpleNamespace(name="SAFETY" if safety else "STOP")
    cand = SimpleNamespace(finish_reason=fr)
    return SimpleNamespace(
        candidates=[cand], text=text,
        usage_metadata=SimpleNamespace(prompt_token_count=10, candidates_token_count=20),
    )


def _patch_model(grader, responses):
    """genai.GenerativeModel().generate_content returns `responses` in order."""
    it = iter(responses)
    fake_model = SimpleNamespace(generate_content=lambda *a, **k: next(it))
    return patch("services.gemini_writing_grader.genai.GenerativeModel", lambda **kw: fake_model)


# ── max_output_tokens is set ──────────────────────────────────────────


def test_generation_config_sets_max_output_tokens(grader):
    captured = {}
    real = GenerationConfig

    def spy(**kw):
        captured.update(kw)
        return real(**kw)

    with _patch_model(grader, [_resp(VALID_JSON)]), \
         patch("services.gemini_writing_grader.GenerationConfig", spy):
        import asyncio
        asyncio.run(grader._call_with_retry("p", "sys", "usr", parse_schema=WritingFeedback))
    assert captured.get("max_output_tokens") == 32768


# ── parse-fail re-rolls within the loop ───────────────────────────────


def test_parse_fail_then_valid_retries(grader):
    import asyncio
    with _patch_model(grader, [_resp(TRUNCATED_JSON), _resp(VALID_JSON)]), \
         patch("services.gemini_writing_grader.asyncio.sleep", new=_async_noop):
        text, usage = asyncio.run(
            grader._call_with_retry("p", "sys", "usr", parse_schema=WritingFeedback))
    # second attempt's valid body is returned (re-roll worked)
    assert json.loads(text)["overallBandScore"] == 6.5


def test_all_parse_fail_raises_invalidjson(grader):
    import asyncio
    with _patch_model(grader, [_resp(TRUNCATED_JSON)] * 3), \
         patch("services.gemini_writing_grader.asyncio.sleep", new=_async_noop):
        with pytest.raises(InvalidJSONError):     # final raise preserves the parse-fail type
            asyncio.run(grader._call_with_retry("p", "sys", "usr", parse_schema=WritingFeedback))


def test_safety_block_not_retried(grader):
    import asyncio
    calls = {"n": 0}

    def gen(*a, **k):
        calls["n"] += 1
        return _resp("", safety=True)

    fake_model = SimpleNamespace(generate_content=gen)
    with patch("services.gemini_writing_grader.genai.GenerativeModel", lambda **kw: fake_model):
        with pytest.raises(AISafetyBlockError):
            asyncio.run(grader._call_with_retry("p", "sys", "usr", parse_schema=WritingFeedback))
    assert calls["n"] == 1, "safety block must NOT retry"


def test_success_path_no_parse_schema_unchanged(grader):
    """Back-compat: without parse_schema, returns text on the first valid body
    (the existing call shape) — no in-loop validation."""
    import asyncio
    with _patch_model(grader, [_resp(VALID_JSON)]):
        text, usage = asyncio.run(grader._call_with_retry("p", "sys", "usr"))
    assert text == VALID_JSON
    assert usage["input_tokens"] == 10


async def _async_noop(*a, **k):
    return None
