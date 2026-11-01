"""TTS + essay_service 5xx stay safe even without main.py's HTTPException handler."""

import ast
import asyncio
import logging
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from models.writing_feedback import WritingFeedback
from routers import tts
from services import essay_service


_DB_ERROR = 'relation "writing_essays" column secret_col contains SECRET-db-value'
_ESSAY_QUOTE = "SECRET-ESSAY-QUOTE my hometown is famous for"
_ID = "00000000-0000-0000-0000-000000000001"
_INTERNAL = (_DB_ERROR, "SECRET", "relation", "secret_col", "writing_essays",
             "writing_jobs", "writing_grade_ratings", "sessions", "openai",
             "Database", "schema")
_BACKEND = Path(__file__).resolve().parents[1]


def _client(results):
    """Every query chain returns itself; ``execute`` yields ``results`` in order
    (an Exception instance is raised instead of returned)."""
    client = MagicMock()
    query = MagicMock()
    client.table.return_value = query
    for method in ("select", "eq", "is_", "limit", "insert", "upsert"):
        getattr(query, method).return_value = query
    query.execute.side_effect = [
        r if isinstance(r, Exception) else SimpleNamespace(data=r) for r in results
    ]
    return client


def _tts_session(mp):
    async def user(_a):
        return {"id": _ID}
    mp.setattr(tts, "get_supabase_user", user)
    mp.setattr(tts, "supabase_admin", _client([Exception(_DB_ERROR)]))
    return asyncio.run(tts.text_to_speech(
        tts.TTSRequest(text="Hello", session_id=_ID), authorization="Bearer x"))


def _tts_provider(mp):
    async def user(_a):
        return {"id": _ID}

    async def synth(_text, _voice):
        raise RuntimeError(f"openai error: {_DB_ERROR}")
    mp.setattr(tts, "get_supabase_user", user)
    mp.setattr(tts, "require_speaking_entitlement", lambda _u, _s: None)
    mp.setattr(tts, "_count_tts_today", lambda _u: 0)
    mp.setattr(tts.settings, "OPENAI_API_KEY", "sk-test")
    mp.setattr(tts, "synthesize_mp3", synth)
    return asyncio.run(tts.text_to_speech(tts.TTSRequest(text="Hello"),
                                          authorization="Bearer x"))


def _essay_insert(mp):
    mp.setattr(essay_service, "supabase_admin", _client([[{"id": _ID}], Exception(_DB_ERROR)]))
    return essay_service.create_essay_row_only(data={
        "student_id": _ID, "task_type": "task2", "prompt_text": "P",
        "essay_text": _ESSAY_QUOTE, "analysis_level": 3,
    }, admin_id=_ID)


def _job_insert(mp):
    mp.setattr(essay_service, "supabase_admin", _client([Exception(_DB_ERROR)]))
    return essay_service.schedule_grading_job(essay_id=_ID, analysis_level=3)


def _rating_upsert(mp):
    mp.setattr(essay_service, "_current_feedback_run",
               lambda _e: {"version": 1, "model_used": "gemini-2.5-pro"})
    mp.setattr(essay_service, "supabase_admin", _client([
        [{"analysis_level": 3, "grading_tier": "standard"}], Exception(_DB_ERROR),
    ]))
    return essay_service.upsert_grade_rating(essay_id=_ID, rating=4, note="", rated_by=_ID)


@pytest.mark.parametrize("module,call,status", [
    pytest.param(tts, _tts_session, 500, id="tts-session-lookup"),
    pytest.param(tts, _tts_provider, 502, id="tts-provider"),
    pytest.param(essay_service, _essay_insert, 500, id="essay-insert"),
    pytest.param(essay_service, _job_insert, 500, id="job-insert"),
    pytest.param(essay_service, _rating_upsert, 500, id="grade-rating-upsert"),
])
def test_direct_5xx_detail_is_clean_and_logged(monkeypatch, caplog, module, call, status):
    with caplog.at_level(logging.ERROR, logger=module.logger.name):
        with pytest.raises(HTTPException) as exc_info:
            call(monkeypatch)

    error = exc_info.value
    assert error.status_code == status
    assert isinstance(error.detail, str)
    assert error.detail.endswith("Vui lòng thử lại.")
    for internal in _INTERNAL:
        assert internal not in error.detail
    assert error.__cause__ is None
    assert error.__suppress_context__ is True
    assert any(record.name == module.logger.name
               and record.levelno == logging.ERROR
               and record.exc_info is not None
               for record in caplog.records)


def test_render_context_schema_failure_hides_feedback_in_detail_and_log(monkeypatch, caplog):
    stored = {"overallBandScore": _ESSAY_QUOTE, "improvedEssay": _ESSAY_QUOTE}
    with pytest.raises(ValidationError) as raw:
        WritingFeedback(**stored)
    assert _ESSAY_QUOTE in str(raw.value)  # pydantic's own text would leak it

    monkeypatch.setattr(essay_service, "supabase_admin", _client([
        [{"id": _ID, "student_id": _ID, "task_type": "task2", "prompt_text": "P",
          "essay_text": _ESSAY_QUOTE, "status": "graded"}],
        [{"feedback_json": stored}],
    ]))
    with caplog.at_level(logging.DEBUG, logger=essay_service.logger.name):
        with pytest.raises(HTTPException) as exc_info:
            essay_service.get_essay_render_context(_ID)

    error = exc_info.value
    assert error.status_code == 500
    assert error.detail == "Không đọc được nhận xét đã lưu. Vui lòng thử lại."
    assert error.__cause__ is None
    assert error.__suppress_context__ is True

    records = [r for r in caplog.records if r.name == essay_service.logger.name
               and r.levelno == logging.ERROR]
    assert len(records) == 1
    record = records[0]
    message = record.getMessage()
    assert _ID in message
    assert "ValidationError" in message and "overallBandScore" in message
    # No traceback and no exception object: both would render the rejected input.
    assert record.exc_info is None
    assert not any(isinstance(a, BaseException) for a in (record.args or ()))
    assert "SECRET" not in message
    assert "SECRET" not in caplog.text


def _fstring_exception_details(path: Path) -> list[str]:
    """``HTTPException(5xx, f"...")`` / ``detail=f"..."`` that interpolate the
    variable bound by an enclosing ``except ... as <name>``."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found = []

    def visit(node, bound):
        if isinstance(node, ast.ExceptHandler) and node.name:
            bound = bound | {node.name}
        if (isinstance(node, ast.Call) and getattr(node.func, "id", None) == "HTTPException"
                and bound):
            args = list(node.args)
            kw = {k.arg: k.value for k in node.keywords}
            status = kw.get("status_code", args[0] if args else None)
            detail = kw.get("detail", args[1] if len(args) > 1 else None)
            if (isinstance(status, ast.Constant) and isinstance(status.value, int)
                    and status.value >= 500 and isinstance(detail, ast.JoinedStr)
                    and any(isinstance(n, ast.Name) and n.id in bound
                            for n in ast.walk(detail))):
                found.append(f"{path.name}:{node.lineno}")
        for child in ast.iter_child_nodes(node):
            visit(child, bound)

    visit(tree, frozenset())
    return found


@pytest.mark.parametrize("relpath", ["routers/tts.py", "services/essay_service.py"])
def test_no_5xx_detail_interpolates_caught_exception(relpath):
    assert _fstring_exception_details(_BACKEND / relpath) == []


def test_scanner_flags_the_old_pattern(tmp_path):
    sample = tmp_path / "sample.py"
    sample.write_text(
        "try:\n    pass\nexcept Exception as e:\n"
        "    raise HTTPException(status_code=500, detail=f'boom: {e}')\n",
        encoding="utf-8",
    )
    assert _fstring_exception_details(sample) == ["sample.py:4"]
