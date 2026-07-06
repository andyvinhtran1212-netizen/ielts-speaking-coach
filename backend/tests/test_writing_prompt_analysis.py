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


# ── DB orchestration: image_needs_analysis + run_and_store_analysis ───

def test_image_needs_analysis_matrix():
    base = {"task_type": "task1_academic", "prompt_image_url": "u",
            "prompt_image_public_id": "p1", "prompt_image_analysis_public_id": "p0"}
    assert wpa.image_needs_analysis(base) is True                       # new/changed image
    assert wpa.image_needs_analysis({**base, "prompt_image_analysis_public_id": "p1"}) is False  # already analysed
    assert wpa.image_needs_analysis({**base, "task_type": "task2"}) is False                     # not task1
    assert wpa.image_needs_analysis({**base, "prompt_image_url": None}) is False                 # no image


def _run_store(prompt_row, analysis=None, raise_exc=None):
    """Drive run_and_store_analysis with a mocked DB + extraction; return the
    dict written to the FINAL update() call."""
    db = MagicMock()
    (db.table.return_value.select.return_value.eq.return_value
     .limit.return_value.execute.return_value) = MagicMock(data=[prompt_row])

    async def _analyze(**kw):
        if raise_exc:
            raise raise_exc
        return analysis, "gemini-2.5-pro"

    with patch("database.supabase_admin", db), \
         patch.object(wpa, "analyze_prompt_image", _analyze):
        _run(wpa.run_and_store_analysis(prompt_row["id"]))
    # last update payload
    return db.table.return_value.update.call_args[0][0] if db.table.return_value.update.call_args else None


def test_run_and_store_success_writes_ready_unreviewed():
    row = {"id": "p1", "task_type": "task1_academic", "prompt_text": "x",
           "prompt_image_url": "https://x/c.png", "prompt_image_public_id": "prompts/c.png"}
    analysis = PromptImageAnalysis(overview="Tổng quan", key_features=["A"], chart_type="bar")
    payload = _run_store(row, analysis=analysis)
    assert payload["prompt_image_analysis_status"] == "ready"
    assert payload["prompt_image_analysis_reviewed"] is False           # must re-approve
    assert payload["prompt_image_analysis_public_id"] == "prompts/c.png"
    assert payload["prompt_image_analysis"]["overview"] == "Tổng quan"


def test_run_and_store_failure_records_failed():
    row = {"id": "p1", "task_type": "task1_academic", "prompt_text": "x",
           "prompt_image_url": "https://x/dead.png", "prompt_image_public_id": "prompts/d.png"}
    payload = _run_store(row, raise_exc=RuntimeError("fetch failed: HTTP 404"))
    assert payload["prompt_image_analysis_status"] == "failed"
    assert "404" in payload["prompt_image_analysis_error"]


def test_run_and_store_skips_non_task1():
    row = {"id": "p1", "task_type": "task2", "prompt_text": "x",
           "prompt_image_url": None, "prompt_image_public_id": None}
    payload = _run_store(row)
    assert payload is None            # no update at all
