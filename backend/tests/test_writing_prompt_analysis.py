"""Tests for services.writing_prompt_analysis — Task 1 chart → answer key.

The Gemini call is mocked at the grader seam (`_call_with_retry` +
`_parse_response`) and httpx is patched — no network, no model call."""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest

from models.writing_feedback import PromptImageAnalysis
from services import writing_prompt_analysis as wpa


_PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64   # passes detect_format


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _fake_client(resp):
    client = MagicMock()

    async def _get(url):
        return resp

    client.get = _get

    class _CM:
        async def __aenter__(self_):  return client
        async def __aexit__(self_, *a):  return False

    return MagicMock(return_value=_CM())


def _fake_grader(analysis: PromptImageAnalysis):
    g = MagicMock()

    async def _call(**kw):
        _call.captured = kw
        return "{json}", {"input": 1, "output": 1}

    g._call_with_retry = _call
    g._parse_response = MagicMock(return_value=analysis)
    return g


def test_analyze_happy_path_returns_analysis_and_model():
    resp = MagicMock(status_code=200, content=_PNG)
    analysis = PromptImageAnalysis(overview="Tổng quan", key_features=["A"], chart_type="bar")
    grader = _fake_grader(analysis)
    with patch.object(wpa.httpx, "AsyncClient", _fake_client(resp)), \
         patch.object(wpa, "get_grader", return_value=grader):
        out, model = _run(wpa.analyze_prompt_image(
            image_url="https://x/c.png", prompt_text="chart", model="gemini-2.5-pro"))
    assert out is analysis
    assert model == "gemini-2.5-pro"
    # The image bytes + schema were forwarded to the grader call.
    assert grader._call_with_retry.captured["image"][0] == _PNG
    assert grader._call_with_retry.captured["parse_schema"] is PromptImageAnalysis


def test_analyze_defaults_model_from_settings():
    resp = MagicMock(status_code=200, content=_PNG)
    grader = _fake_grader(PromptImageAnalysis(overview="x"))
    with patch.object(wpa.httpx, "AsyncClient", _fake_client(resp)), \
         patch.object(wpa, "get_grader", return_value=grader), \
         patch.object(wpa.settings, "WRITING_ANALYSIS_MODEL", "gemini-2.5-pro"):
        _out, model = _run(wpa.analyze_prompt_image(image_url="https://x/c.png"))
    assert model == "gemini-2.5-pro"


def test_analyze_raises_on_fetch_failure():
    resp = MagicMock(status_code=404, content=b"")
    with patch.object(wpa.httpx, "AsyncClient", _fake_client(resp)):
        with pytest.raises(RuntimeError, match="fetch failed"):
            _run(wpa.analyze_prompt_image(image_url="https://x/dead.png"))


def test_analyze_raises_on_non_image_payload():
    resp = MagicMock(status_code=200, content=b"not an image at all, plain text")
    with patch.object(wpa.httpx, "AsyncClient", _fake_client(resp)):
        with pytest.raises(RuntimeError, match="not a supported"):
            _run(wpa.analyze_prompt_image(image_url="https://x/x.txt"))
