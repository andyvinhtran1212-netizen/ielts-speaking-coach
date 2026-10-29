"""BL-09 (PC-J118): the Speaking Whisper usage row carries the STT latency.

Runs the real grade route with fake DB/AI. Only the ledger write is captured:
``log_whisper_async`` → ``_whisper_row`` → ``_row`` run for real, so the row is
the one that would reach ``ai_usage_logs``. The STT clock is a controlled fake
installed on ``grading.time`` only (asyncio keeps the real monotonic clock).
"""
import asyncio
import re
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile

from routers import grading
from services import ai_usage_logger
from services.request_context import request_id_scope
from test_admin_speaking_sessions import _DB

_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_TRANSCRIPT = (
    "This is a synthetic answer about visiting a library with my friends "
    "to read books every weekend."
)


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def monotonic(self) -> float:
        return self.now


@pytest.fixture
def route(monkeypatch):
    session = {"id": str(uuid4()), "user_id": str(uuid4()), "part": 1,
               "mode": "practice", "status": "in_progress", "full_test_attempt_id": None,
               "renderer_affinity": "next", "resume_expires_at": "2099-01-01T00:00:00Z"}
    question = {"id": str(uuid4()), "session_id": session["id"], "question_text": "Synthetic prompt"}
    response = {"id": str(uuid4()), "session_id": session["id"], "question_id": question["id"],
                "grading_status": "completed", "overall_band": 6}
    db = _DB(sessions=[session], questions=[question], responses=[response])
    db.storage = MagicMock()

    async def execute(builder):
        return builder(db).execute()

    monkeypatch.setattr(grading, "require_speaking_entitlement", lambda *_a: None)
    monkeypatch.setattr(grading, "supabase_admin", db)
    monkeypatch.setattr(grading, "get_supabase_user", AsyncMock(return_value={"id": session["user_id"]}))
    monkeypatch.setattr(grading, "aexecute", execute)
    monkeypatch.setattr(grading, "enforce_grading_rate_limit", lambda *args: None)
    monkeypatch.setattr(grading, "record_grading_attempt", lambda *args: None)
    monkeypatch.setattr(grading, "_record_progress_mark", lambda *args: None)
    monkeypatch.setattr(grading, "note_owned_speaking_audio", AsyncMock())
    monkeypatch.setattr(grading, "_mark_session_error", lambda *args: None)
    monkeypatch.setattr(grading.claude_grader, "grade_response",
                        AsyncMock(side_effect=RuntimeError("synthetic grader failure")))
    monkeypatch.setattr(grading, "get_judge", lambda: SimpleNamespace(judge=AsyncMock(return_value=None)))
    monkeypatch.setattr(grading, "get_grammar_check_service",
                        lambda: SimpleNamespace(check=AsyncMock(return_value=None)))
    monkeypatch.setattr(grading, "_assess_pronunciation_safe", AsyncMock(return_value=None))

    clock = _Clock()
    monkeypatch.setattr(grading, "time", clock)
    rows: list[dict] = []

    async def capture(row):
        rows.append(row)

    monkeypatch.setattr(ai_usage_logger, "_insert_async", capture)
    # Module-global; earlier tests may leave tasks bound to closed loops.
    monkeypatch.setattr(ai_usage_logger, "_PENDING_USAGE_TASKS", set())

    def run(stt):
        monkeypatch.setattr(grading, "transcribe_from_bytes", stt)

        async def main():
            with request_id_scope("req-pcj118"):
                try:
                    return await grading.grade_response_endpoint(
                        session["id"], question["id"],
                        UploadFile(BytesIO(b"fake audio"), filename="test.wav"),
                    )
                finally:
                    await asyncio.gather(*list(ai_usage_logger._PENDING_USAGE_TASKS))

        return asyncio.run(main())

    return SimpleNamespace(run=run, clock=clock, rows=rows, session=session, question=question)


def _stt_after(clock, *delays):
    """A fake STT that 'takes' ``sum(delays)`` seconds; several delays model
    retries inside one ``transcribe_from_bytes`` call."""
    async def stt(audio_bytes, filename):
        for delay in delays:
            clock.now += delay
            await asyncio.sleep(0)
        return {"transcript": _TRANSCRIPT, "duration_seconds": 20.0,
                "confidence": 0.9, "segments": [], "transcript_model": "whisper-1"}
    return stt


def _whisper_rows(rows):
    return [r for r in rows if r.get("service") == "whisper"]


@pytest.mark.parametrize("delays, floor_ms", [
    ((1.2345,), 1234),
    ((0.75, 0.5), 1250),  # in-call retry: the total, not the last attempt
])
def test_whisper_usage_row_records_stt_latency_ms(route, delays, floor_ms):
    result = route.run(_stt_after(route.clock, *delays))
    assert result["transcript"] == _TRANSCRIPT  # response unchanged by the timer

    [row] = _whisper_rows(route.rows)
    assert type(row["latency_ms"]) is int
    assert row["latency_ms"] >= floor_ms
    assert row["latency_ms"] < floor_ms + 2  # the timer brackets STT only


def test_whisper_usage_row_keeps_existing_fields(route):
    route.run(_stt_after(route.clock, 0.5))

    [row] = _whisper_rows(route.rows)
    assert row["latency_ms"] == 500
    assert row["request_id"] == "req-pcj118"
    assert re.fullmatch(rf"speaking_stt:whisper:{_UUID}", row["usage_event_id"])
    assert row["resource_type"] == "question"
    assert row["resource_id"] == route.question["id"]
    assert row["user_id"] == route.session["user_id"]
    assert row["session_id"] == route.session["id"]
    assert row["feature"] == "speaking_stt"
    assert row["operation"] == "transcribe_response"
    assert row["model"] == "whisper-1"
    assert row["audio_seconds"] == 20.0


def test_stt_failure_writes_no_whisper_success_row(route):
    async def failing_stt(audio_bytes, filename):
        route.clock.now += 3.0
        raise RuntimeError("synthetic provider failure")

    with pytest.raises(HTTPException) as error:
        route.run(failing_stt)

    assert error.value.status_code == 502
    assert _whisper_rows(route.rows) == []
