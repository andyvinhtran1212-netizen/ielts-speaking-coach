"""Tests for services.writing_prompt_analysis — Task 1 chart → answer key.

The Gemini call is mocked at the grader seam (`_call_with_retry` +
`_parse_response`) and httpx is patched — no network, no model call."""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

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


# ── Prompt contract: language, tense, data completeness (C-07) ───────
# The model output itself is checked by the offline gold-set run on the audit
# images (PR evidence); these tests pin the instructions that run relies on.

_VI_DIACRITICS = re.compile(
    r"[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]", re.I)


def _captured_user_prompt(prompt_text="The table shows visitors in 2015, 2020 and 2025."):
    resp = MagicMock(status_code=200, content=_PNG)
    grader = _fake_grader(PromptImageAnalysis(overview="x"))

    class _FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 28, 3, 0, tzinfo=timezone.utc)

    with patch.object(wpa.httpx, "AsyncClient", _fake_client(resp)), \
         patch.object(wpa, "get_grader", return_value=grader), \
         patch.object(wpa, "datetime", _FixedDatetime):
        _run(wpa.analyze_prompt_image(image_url="https://x/c.png", prompt_text=prompt_text))
    return grader._call_with_retry.captured


def test_prompt_is_english_so_the_key_is_not_written_in_vietnamese():
    captured = _captured_user_prompt()
    assert not _VI_DIACRITICS.search(captured["system_prompt"])
    assert not _VI_DIACRITICS.search(captured["user_prompt"])
    assert "Write EVERY value in English" in captured["system_prompt"]
    assert "Write it in English" in captured["user_prompt"]


def test_user_prompt_states_todays_date_so_recent_years_read_as_past():
    captured = _captured_user_prompt()
    assert "Today's date: 2026-10-28" in captured["user_prompt"]
    assert "The table shows visitors in 2015, 2020 and 2025." in captured["user_prompt"]


def test_system_prompt_only_allows_projected_wording_when_the_chart_says_so():
    sp = wpa._SYSTEM_PROMPT
    assert "a year up to the current year is past data" in sp
    assert ("Never call a figure projected, forecast, predicted or estimated because "
            "its year seems late to you") in sp
    assert "only when the image or prompt marks the figures that way" in sp
    assert "Describe past data in past tense" in sp


def test_system_prompt_requires_every_printed_table_value():
    sp = wpa._SYSTEM_PROMPT
    assert "include EVERY printed value" in sp
    assert "one entry per cell or data label" in sp
    assert "no row or column skipped" in sp
    # A '–' cell (e.g. a park that opened later) must not become a value.
    assert "A blank or '–' cell is not a value" in sp


def test_system_prompt_forbids_invented_map_features_and_locations():
    sp = wpa._SYSTEM_PROMPT
    assert "Report only features that are labelled or clearly drawn" in sp
    assert "If a location is unclear, leave it out rather than guess" in sp
    assert "Never add a feature, name, number or direction that is not in the image" in sp


# ── AI-LOG: the extraction call is attributed in ai_usage_logs ────────


def test_usage_context_names_feature_operation_prompt_and_admin():
    ctx = wpa.prompt_analysis_usage_context("p1", requested_by="admin-1", trigger="reanalyze")
    assert ctx["feature"] == "writing_prompt_analysis"
    assert ctx["operation"] == "extract_answer_key"
    assert ctx["user_id"] == "admin-1"
    assert ctx["resource_type"] == "writing_prompt"
    assert ctx["resource_id"] == "p1"
    assert ctx["metadata"] == {"prompt_id": "p1", "trigger": "reanalyze"}


def test_analyze_forwards_usage_context_to_grader_call():
    resp = MagicMock(status_code=200, content=_PNG)
    grader = _fake_grader(PromptImageAnalysis(overview="x"))
    ctx = wpa.prompt_analysis_usage_context("p1", requested_by="admin-1", trigger="create")
    with patch.object(wpa.httpx, "AsyncClient", _fake_client(resp)), \
         patch.object(wpa, "get_grader", return_value=grader):
        _run(wpa.analyze_prompt_image(image_url="https://x/c.png", usage_context=ctx))
    assert grader._call_with_retry.captured["usage_context"] is ctx


def test_analysis_ledger_row_has_feature_operation_and_user():
    """Drive the REAL grader retry loop (Gemini SDK mocked): the row written to
    ai_usage_logs carries the extraction's feature/operation/user/resource."""
    from services.gemini_writing_grader import GeminiWritingGrader

    with patch("services.gemini_writing_grader.settings") as ms, \
         patch("services.gemini_writing_grader.genai.configure"):
        ms.GEMINI_API_KEY = "k"; ms.GEMINI_FLASH_MODEL = "f"; ms.GEMINI_PRO_MODEL = "p"
        grader = GeminiWritingGrader()

    body = json.dumps({"chart_type": "table", "overview": "Visitors fell, then rose.",
                       "key_features": ["Night market 300 to 620"]})
    response = SimpleNamespace(
        candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name="STOP"))],
        text=body,
        usage_metadata=SimpleNamespace(prompt_token_count=10, candidates_token_count=20),
    )
    fake_model = SimpleNamespace(generate_content=lambda *a, **k: response)
    usage_log = AsyncMock()
    resp = MagicMock(status_code=200, content=_PNG)
    ctx = wpa.prompt_analysis_usage_context("p1", requested_by="admin-1", trigger="reanalyze")

    async def _go():
        out = await wpa.analyze_prompt_image(
            image_url="https://x/c.png", model="gemini-2.5-pro", usage_context=ctx)
        await asyncio.sleep(0)          # let the scheduled ledger write run
        return out

    with patch.object(wpa.httpx, "AsyncClient", _fake_client(resp)), \
         patch.object(wpa, "get_grader", return_value=grader), \
         patch("services.gemini_writing_grader.genai.GenerativeModel",
               lambda **kw: fake_model), \
         patch("services.gemini_writing_grader.ai_usage_logger.log_gemini_async", usage_log):
        analysis, _model = _run(_go())

    assert analysis.chart_type == "table"
    usage_log.assert_awaited_once()
    row = usage_log.await_args.kwargs
    assert row["status"] == "success"
    assert row["model"] == "gemini-2.5-pro"
    assert row["feature"] == "writing_prompt_analysis"
    assert row["operation"] == "extract_answer_key"
    assert row["user_id"] == "admin-1"
    assert row["resource_type"] == "writing_prompt"
    assert row["resource_id"] == "p1"
    assert row["metadata"]["trigger"] == "reanalyze"


# ── DB orchestration: image_needs_analysis + run_and_store_analysis ───

def test_image_needs_analysis_matrix():
    base = {"task_type": "task1_academic", "prompt_image_url": "u",
            "prompt_image_public_id": "p1", "prompt_image_analysis_public_id": "p0"}
    assert wpa.image_needs_analysis(base) is True                       # new/changed image
    assert wpa.image_needs_analysis({**base, "prompt_image_analysis_public_id": "p1"}) is False  # already analysed
    assert wpa.image_needs_analysis({**base, "task_type": "task2"}) is False                     # not task1
    assert wpa.image_needs_analysis({**base, "prompt_image_url": None}) is False                 # no image


def test_mark_analysis_pending_is_scoped_to_expected_image_and_returns_token():
    db = MagicMock()
    query = db.table.return_value.update.return_value.eq.return_value.eq.return_value.eq.return_value
    query.execute.return_value = MagicMock(data=[{"id": "p1"}])
    with patch("database.supabase_admin", db), patch.object(wpa, "_now_iso", return_value="pending-token"):
        token = wpa.mark_analysis_pending("p1", "prompts/c.png")
    assert token == "pending-token"
    db.table.return_value.update.return_value.eq.assert_called_once_with("id", "p1")
    db.table.return_value.update.return_value.eq.return_value.eq.assert_called_once_with(
        "task_type", "task1_academic",
    )
    db.table.return_value.update.return_value.eq.return_value.eq.return_value.eq.assert_called_once_with(
        "prompt_image_public_id", "prompts/c.png",
    )


def test_mark_analysis_pending_returns_none_when_image_changed():
    db = MagicMock()
    (db.table.return_value.update.return_value.eq.return_value.eq.return_value
     .eq.return_value.execute.return_value) = MagicMock(data=[])
    with patch("database.supabase_admin", db):
        assert wpa.mark_analysis_pending("p1", "prompts/old.png") is None


def _run_store(
    prompt_row,
    analysis=None,
    raise_exc=None,
    return_db=False,
    expected_pending_at=None,
    **run_kwargs,
):
    """Drive run_and_store_analysis with a mocked DB + extraction; return the
    dict written to the FINAL update() call."""
    db = MagicMock()
    (db.table.return_value.select.return_value.eq.return_value
     .limit.return_value.execute.return_value) = MagicMock(data=[prompt_row])

    async def _analyze(**kw):
        _analyze.kwargs = kw
        if raise_exc:
            raise raise_exc
        return analysis, "gemini-2.5-pro"

    with patch("database.supabase_admin", db), \
         patch.object(wpa, "analyze_prompt_image", _analyze):
        _run(wpa.run_and_store_analysis(prompt_row["id"], expected_pending_at, **run_kwargs))
    _run_store.analyze_kwargs = getattr(_analyze, "kwargs", None)
    # last update payload
    payload = db.table.return_value.update.call_args[0][0] if db.table.return_value.update.call_args else None
    return (payload, db) if return_db else payload


def test_run_and_store_success_writes_ready_unreviewed():
    row = {"id": "p1", "task_type": "task1_academic", "prompt_text": "x",
           "prompt_image_url": "https://x/c.png", "prompt_image_public_id": "prompts/c.png"}
    analysis = PromptImageAnalysis(overview="Tổng quan", key_features=["A"], chart_type="bar")
    payload = _run_store(row, analysis=analysis)
    assert payload["prompt_image_analysis_status"] == "ready"
    assert payload["prompt_image_analysis_reviewed"] is False           # must re-approve
    assert payload["prompt_image_analysis_public_id"] == "prompts/c.png"
    assert payload["prompt_image_analysis"]["overview"] == "Tổng quan"


def test_run_and_store_success_is_scoped_to_original_image_fingerprint():
    row = {"id": "p1", "task_type": "task1_academic", "prompt_text": "x",
           "prompt_image_url": "https://x/c.png", "prompt_image_public_id": "prompts/c.png"}
    analysis = PromptImageAnalysis(overview="Tổng quan")
    _payload, db = _run_store(row, analysis=analysis, return_db=True)
    update_eq = db.table.return_value.update.return_value.eq
    update_eq.assert_called_once_with("id", "p1")
    update_eq.return_value.eq.assert_called_once_with(
        "prompt_image_public_id", "prompts/c.png",
    )


def test_run_and_store_success_is_scoped_to_latest_reanalysis_token():
    row = {"id": "p1", "task_type": "task1_academic", "prompt_text": "x",
           "prompt_image_url": "https://x/c.png", "prompt_image_public_id": "prompts/c.png",
           "prompt_image_analysis_at": "pending-token"}
    analysis = PromptImageAnalysis(overview="Tổng quan")
    _payload, db = _run_store(
        row,
        analysis=analysis,
        return_db=True,
        expected_pending_at="pending-token",
    )
    image_eq = db.table.return_value.update.return_value.eq.return_value.eq
    image_eq.return_value.eq.assert_called_once_with(
        "prompt_image_analysis_at", "pending-token",
    )


def test_run_and_store_skips_ai_when_pending_token_is_already_stale():
    row = {"id": "p1", "task_type": "task1_academic", "prompt_text": "x",
           "prompt_image_url": "https://x/c.png", "prompt_image_public_id": "prompts/c.png",
           "prompt_image_analysis_at": "newer-token"}
    db = MagicMock()
    (db.table.return_value.select.return_value.eq.return_value
     .limit.return_value.execute.return_value) = MagicMock(data=[row])
    with patch("database.supabase_admin", db), \
         patch.object(wpa, "analyze_prompt_image") as analyze:
        _run(wpa.run_and_store_analysis("p1", "older-token"))
    analyze.assert_not_called()
    db.table.return_value.update.assert_not_called()


def test_run_and_store_failure_records_failed():
    row = {"id": "p1", "task_type": "task1_academic", "prompt_text": "x",
           "prompt_image_url": "https://x/dead.png", "prompt_image_public_id": "prompts/d.png"}
    payload = _run_store(row, raise_exc=RuntimeError("fetch failed: HTTP 404"))
    assert payload["prompt_image_analysis_status"] == "failed"
    assert "404" in payload["prompt_image_analysis_error"]


def test_run_and_store_failure_is_scoped_to_original_image_fingerprint():
    row = {"id": "p1", "task_type": "task1_academic", "prompt_text": "x",
           "prompt_image_url": "https://x/dead.png", "prompt_image_public_id": "prompts/dead.png"}
    _payload, db = _run_store(row, raise_exc=RuntimeError("fetch failed"), return_db=True)
    update_eq = db.table.return_value.update.return_value.eq
    update_eq.assert_called_once_with("id", "p1")
    update_eq.return_value.eq.assert_called_once_with(
        "prompt_image_public_id", "prompts/dead.png",
    )


def test_run_and_store_failure_is_scoped_to_latest_reanalysis_token():
    row = {"id": "p1", "task_type": "task1_academic", "prompt_text": "x",
           "prompt_image_url": "https://x/dead.png", "prompt_image_public_id": "prompts/dead.png",
           "prompt_image_analysis_at": "pending-token"}
    _payload, db = _run_store(
        row,
        raise_exc=RuntimeError("fetch failed"),
        return_db=True,
        expected_pending_at="pending-token",
    )
    image_eq = db.table.return_value.update.return_value.eq.return_value.eq
    image_eq.return_value.eq.assert_called_once_with(
        "prompt_image_analysis_at", "pending-token",
    )


def test_run_and_store_skips_non_task1():
    row = {"id": "p1", "task_type": "task2", "prompt_text": "x",
           "prompt_image_url": None, "prompt_image_public_id": None}
    payload = _run_store(row)
    assert payload is None            # no update at all


def test_run_and_store_attributes_the_call_to_the_requesting_admin():
    row = {"id": "p1", "task_type": "task1_academic", "prompt_text": "x",
           "prompt_image_url": "https://x/c.png", "prompt_image_public_id": "prompts/c.png"}
    _run_store(row, analysis=PromptImageAnalysis(overview="x"),
               requested_by="admin-1", trigger="update")
    ctx = _run_store.analyze_kwargs["usage_context"]
    assert ctx == wpa.prompt_analysis_usage_context(
        "p1", requested_by="admin-1", trigger="update")


def test_run_and_store_without_admin_is_logged_as_backfill():
    """scripts/backfill_prompt_analysis.py has no requesting user."""
    row = {"id": "p1", "task_type": "task1_academic", "prompt_text": "x",
           "prompt_image_url": "https://x/c.png", "prompt_image_public_id": "prompts/c.png"}
    _run_store(row, analysis=PromptImageAnalysis(overview="x"))
    ctx = _run_store.analyze_kwargs["usage_context"]
    assert ctx["feature"] == "writing_prompt_analysis"
    assert ctx["user_id"] is None
    assert ctx["metadata"]["trigger"] == "backfill"
