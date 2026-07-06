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


# ── stale-snapshot fallback (prompt_image_url_fallback) ───────────────


def _fake_async_client_by_url(url_map, calls=None):
    """AsyncClient stand-in whose .get(url) returns url_map[url] (a MagicMock
    response) or raises it when the mapped value is an Exception. Records each
    fetched URL into `calls` (when provided) so tests can assert de-dup /
    short-circuit behaviour."""
    client = MagicMock()

    async def _get(url):
        if calls is not None:
            calls.append(url)
        r = url_map.get(url)
        if isinstance(r, Exception):
            raise r
        return r

    client.get = _get

    class _CM:
        async def __aenter__(self_):  return client
        async def __aexit__(self_, *a):  return False

    return MagicMock(return_value=_CM())


def _cfg_fb(primary, fallback):
    return GraderConfig(
        task_type="task1_academic",
        prompt_text="The chart shows energy use." + "x" * 5,
        essay_text="The graph illustrates..." + "y" * 5,
        analysis_level=3,
        prompt_image_url=primary,
        prompt_image_url_fallback=fallback,
    )


def _ok(mime="image/png", content=b"\x89PNG"):
    return MagicMock(status_code=200, content=content, headers={"content-type": mime})


def _404():
    return MagicMock(status_code=404, content=b"", headers={})


def test_config_accepts_fallback_defaults_none():
    assert _cfg().prompt_image_url_fallback is None
    assert _cfg_fb("https://x/a.png", "https://x/b.png").prompt_image_url_fallback.endswith("b.png")


def test_fetch_uses_fallback_when_primary_404():
    P, F = "https://old/dead.png", "https://prompt/live.png"
    calls = []
    cli = _fake_async_client_by_url({P: _404(), F: _ok()}, calls)
    with patch("services.gemini_writing_grader.httpx.AsyncClient", cli):
        out = _run(_grader()._maybe_fetch_prompt_image(_cfg_fb(P, F)))
    assert out == (b"\x89PNG", "image/png")
    assert P in calls and F in calls          # tried primary first, then fallback


def test_fetch_uses_fallback_when_primary_missing():
    F = "https://prompt/live.png"
    cli = _fake_async_client_by_url({F: _ok()})
    with patch("services.gemini_writing_grader.httpx.AsyncClient", cli):
        out = _run(_grader()._maybe_fetch_prompt_image(_cfg_fb(None, F)))
    assert out == (b"\x89PNG", "image/png")


def test_fetch_primary_success_skips_fallback():
    P, F = "https://old/live.png", "https://prompt/other.png"
    calls = []
    # Fallback would raise if reached — proves the primary short-circuits.
    import httpx
    cli = _fake_async_client_by_url({P: _ok(), F: httpx.ConnectError("should not reach")}, calls)
    with patch("services.gemini_writing_grader.httpx.AsyncClient", cli):
        out = _run(_grader()._maybe_fetch_prompt_image(_cfg_fb(P, F)))
    assert out == (b"\x89PNG", "image/png")
    assert F not in calls


def test_fetch_returns_none_when_both_fail():
    P, F = "https://old/dead.png", "https://prompt/dead.png"
    cli = _fake_async_client_by_url({P: _404(), F: _404()})
    with patch("services.gemini_writing_grader.httpx.AsyncClient", cli):
        assert _run(_grader()._maybe_fetch_prompt_image(_cfg_fb(P, F))) is None


def test_fetch_dedups_identical_snapshot_and_fallback():
    U = "https://same/chart.png"
    calls = []
    cli = _fake_async_client_by_url({U: _404()}, calls)
    with patch("services.gemini_writing_grader.httpx.AsyncClient", cli):
        assert _run(_grader()._maybe_fetch_prompt_image(_cfg_fb(U, U))) is None
    # 2 fetch ATTEMPTS of the SAME single URL (retry), never a 3rd for a dup URL.
    assert calls == [U, U]


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
