"""Tests for Sprint 19.3.5 — Task 1 Academic multimodal grading.

Unit-level coverage of the three behaviours wired into the grader:
  • _maybe_fetch_prompt_image — task-type gating + httpx fetch/fail/non-image
  • _call_with_retry         — multimodal payload shape (list w/ image Part
                               vs plain string) — the core regression guard
  • _inject_missing_image_caveat — D7 caveat prepend + idempotency
  • GraderConfig accepts the new prompt_image_url field (default None)

Methods are exercised on an uninitialised instance (`__new__`) so we skip
__init__'s genai.configure() (no API key needed). The Gemini SDK +
httpx are patched — no network, no real model call.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

from models.writing_feedback import GraderConfig, WritingFeedback
from services.gemini_writing_grader import GeminiWritingGrader


def _grader() -> GeminiWritingGrader:
    return GeminiWritingGrader.__new__(GeminiWritingGrader)


def _cfg(task_type="task1_academic", image_url="https://res.cloudinary.com/x/chart.png"):
    return GraderConfig(
        task_type=task_type,
        prompt_text="The chart shows energy use." + "x" * 5,
        essay_text="The graph illustrates..." + "y" * 5,
        analysis_level=3,
        prompt_image_url=image_url,
    )


# ── GraderConfig field ────────────────────────────────────────────────


def test_grader_config_accepts_image_url_and_defaults_none():
    c = GraderConfig(task_type="task2", prompt_text="a" * 10, essay_text="b" * 10, analysis_level=3)
    assert c.prompt_image_url is None
    c2 = _cfg()
    assert c2.prompt_image_url.endswith("chart.png")


# ── _maybe_fetch_prompt_image ─────────────────────────────────────────


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _fake_async_client(get_result=None, raise_exc=None):
    """Build a stand-in for httpx.AsyncClient(...) as an async ctx manager."""
    client = MagicMock()

    async def _get(url):
        if raise_exc:
            raise raise_exc
        return get_result

    client.get = _get

    class _CM:
        async def __aenter__(self_):  return client
        async def __aexit__(self_, *a):  return False

    return MagicMock(return_value=_CM())


def test_fetch_skips_non_task1_academic():
    assert _run(_grader()._maybe_fetch_prompt_image(_cfg(task_type="task2"))) is None
    assert _run(_grader()._maybe_fetch_prompt_image(_cfg(task_type="task1_general"))) is None


def test_fetch_skips_when_no_url():
    assert _run(_grader()._maybe_fetch_prompt_image(_cfg(image_url=None))) is None


def test_fetch_success_returns_bytes_and_mime():
    resp = MagicMock(status_code=200, content=b"\x89PNG\r\n", headers={"content-type": "image/png"})
    with patch("services.gemini_writing_grader.httpx.AsyncClient", _fake_async_client(get_result=resp)):
        out = _run(_grader()._maybe_fetch_prompt_image(_cfg()))
    assert out == (b"\x89PNG\r\n", "image/png")


def test_fetch_non_image_content_type_falls_back_to_url_guess():
    resp = MagicMock(status_code=200, content=b"data", headers={"content-type": "application/octet-stream"})
    with patch("services.gemini_writing_grader.httpx.AsyncClient",
               _fake_async_client(get_result=resp)):
        out = _run(_grader()._maybe_fetch_prompt_image(_cfg(image_url="https://x/c.jpg")))
    assert out == (b"data", "image/jpeg")   # guessed from .jpg


def test_fetch_http_error_returns_none():
    resp = MagicMock(status_code=404, content=b"", headers={})
    with patch("services.gemini_writing_grader.httpx.AsyncClient", _fake_async_client(get_result=resp)):
        assert _run(_grader()._maybe_fetch_prompt_image(_cfg())) is None


def test_fetch_network_error_returns_none():
    import httpx
    with patch("services.gemini_writing_grader.httpx.AsyncClient",
               _fake_async_client(raise_exc=httpx.ConnectError("boom"))):
        assert _run(_grader()._maybe_fetch_prompt_image(_cfg())) is None


# ── _call_with_retry payload shape (core regression guard) ────────────


def _fake_gemini_model():
    """genai.GenerativeModel(...) → model whose generate_content records the
    `contents` arg and returns a minimal valid response."""
    model = MagicMock()
    captured = {}

    def _gen(contents, **kw):
        captured["contents"] = contents
        resp = MagicMock()
        cand = MagicMock()
        cand.finish_reason = MagicMock(name="STOP")
        cand.finish_reason.name = "STOP"
        resp.candidates = [cand]
        resp.text = '{"ok": true, "padding": "xxxxxxxxxx"}'
        resp.usage_metadata = MagicMock(prompt_token_count=10, candidates_token_count=20)
        return resp

    model.generate_content = _gen
    factory = MagicMock(return_value=model)
    return factory, captured


def test_call_with_image_sends_multimodal_list():
    factory, captured = _fake_gemini_model()
    with patch("services.gemini_writing_grader.genai.GenerativeModel", factory):
        _run(_grader()._call_with_retry(
            model_name="gemini-2.5-pro", system_prompt="sys",
            user_prompt="grade this", image=(b"IMG", "image/png"),
        ))
    c = captured["contents"]
    assert isinstance(c, list)
    assert c[0] == "grade this"
    assert c[1] == {"mime_type": "image/png", "data": b"IMG"}


def test_call_without_image_sends_plain_string():
    factory, captured = _fake_gemini_model()
    with patch("services.gemini_writing_grader.genai.GenerativeModel", factory):
        _run(_grader()._call_with_retry(
            model_name="gemini-2.5-pro", system_prompt="sys", user_prompt="grade this",
        ))
    assert captured["contents"] == "grade this"   # not a list


# ── _inject_missing_image_caveat (D7) ─────────────────────────────────


def _min_feedback(summary="Bài viết khá tốt.") -> WritingFeedback:
    return WritingFeedback.model_construct(overallBandScoreSummary=summary)


def test_caveat_prepended():
    fb = GeminiWritingGrader._inject_missing_image_caveat(_min_feedback("Tốt."))
    assert fb.overallBandScoreSummary.startswith("⚠️")
    assert "Tốt." in fb.overallBandScoreSummary


def test_caveat_idempotent_on_regrade():
    fb = _min_feedback("Tốt.")
    once = GeminiWritingGrader._inject_missing_image_caveat(fb).overallBandScoreSummary
    twice = GeminiWritingGrader._inject_missing_image_caveat(fb).overallBandScoreSummary
    assert once == twice
    assert twice.count("⚠️") == 1
