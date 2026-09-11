"""Actual route boundaries with fake DB/AI; no production content or requests."""
import asyncio
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from routers import admin, grading
from services import core_attempt_observation as obs
from services.core_attempt_evidence import ReceiptStatus
from services.core_operation_correlation import operation_hint_scope
from test_admin_speaking_sessions import _DB


@pytest.fixture
def capture(monkeypatch):
    monkeypatch.setattr(obs.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", True)
    recorder = AsyncMock(return_value=ReceiptStatus.RECORDED)
    monkeypatch.setattr(obs, "try_record_event", recorder)
    monkeypatch.setattr(obs, "observe_persisted_outcome", AsyncMock(return_value=ReceiptStatus.RECORDED))
    monkeypatch.setattr(obs, "record_operation_correlation", AsyncMock(return_value=ReceiptStatus.RECORDED))
    return recorder


def data(full=False):
    session = {"id": str(uuid4()), "user_id": str(uuid4()), "part": 1,
               "mode": "test_full" if full else "practice", "status": "in_progress",
               "full_test_attempt_id": str(uuid4()) if full else None, "renderer_affinity": "next",
               "resume_expires_at": "2099-01-01T00:00:00Z"}
    question = {"id": str(uuid4()), "session_id": session["id"], "question_text": "Private test prompt"}
    response = {"id": str(uuid4()), "session_id": session["id"], "question_id": question["id"],
                "grading_status": "completed", "overall_band": 6}
    return session, question, response


@pytest.mark.parametrize("full", [False, True])
def test_audio_correlation_uses_authorized_bytes_and_format_not_filename_or_multipart(monkeypatch, capture, full):
    session, question, _ = data(full)
    db = _DB(sessions=[session], questions=[question])
    monkeypatch.setattr(grading, "supabase_admin", db)
    monkeypatch.setattr(grading, "get_supabase_user", AsyncMock(return_value={"id": session["user_id"]}))
    async def execute(builder):
        return builder(db).execute()
    monkeypatch.setattr(grading, "aexecute", execute)
    monkeypatch.setattr(grading, "enforce_grading_rate_limit", lambda *args: None)
    monkeypatch.setattr(grading, "record_grading_attempt", lambda *args: None)
    monkeypatch.setattr(grading, "transcribe_from_bytes", AsyncMock(side_effect=RuntimeError("synthetic failure")))
    hint = str(uuid4())
    uploads = []
    for content, filename, content_type in [
        (b"test audio", "first.wav", "audio/wav"),
        (b"test audio", "renamed.wav", "audio/wav"),
        (b"new audio!", "renamed.wav", "audio/wav"),
        (b"test audio", "first.webm", "audio/wav"),
        (b"test audio", "first.wav", "audio/webm"),
    ]:
        upload = UploadFile(BytesIO(content), filename=filename, headers=Headers({"content-type": content_type}))
        original_read = upload.read
        upload.read = AsyncMock(side_effect=original_read)
        uploads.append(upload)
        with operation_hint_scope([hint]), pytest.raises(HTTPException) as error:
            asyncio.run(grading.grade_response_endpoint(session["id"], question["id"], upload))
        assert error.value.status_code == 502
    rows = [call.kwargs for call in obs.record_operation_correlation.await_args_list]
    assert len(rows) == 5
    assert all(upload.read.await_count == 1 for upload in uploads)
    assert rows[0]["input_digest"] == rows[1]["input_digest"]
    assert len({row["input_digest"] for row in rows}) == 4
    assert len({row["operation_id"] for row in rows}) == 5
    assert all(row["client_operation_id"] == UUID(hint) for row in rows)
    expected = session["full_test_attempt_id"] if full else session["id"]
    assert all(row["canonical_attempt_id"] == UUID(expected) for row in rows)
    assert all(row["attempt_kind"] == ("speaking_full_test" if full else "speaking_session") for row in rows)
    assert "test audio" not in str(rows) and "renamed.wav" not in str(rows) and session["user_id"] not in str(rows)


@pytest.mark.parametrize("failure", ["auth", "question", "rate_limit", "empty", "oversize"])
def test_audio_correlation_never_reads_unowned_upload_or_fingerprints_rejected_size(monkeypatch, capture, failure):
    session, question, _ = data()
    db = _DB(sessions=[session], questions=[] if failure == "question" else [question])
    monkeypatch.setattr(grading, "supabase_admin", db)
    monkeypatch.setattr(grading, "get_supabase_user", AsyncMock(
        side_effect=HTTPException(403, "denied") if failure == "auth" else None,
        return_value={"id": session["user_id"]},
    ))
    async def execute(builder):
        return builder(db).execute()
    monkeypatch.setattr(grading, "aexecute", execute)
    def quota(*args):
        if failure == "rate_limit":
            raise HTTPException(429, "quota")
    monkeypatch.setattr(grading, "enforce_grading_rate_limit", quota)
    monkeypatch.setattr(grading, "record_grading_attempt", lambda *args: None)
    monkeypatch.setattr(grading, "_MAX_BYTES", 4)
    note = AsyncMock(wraps=obs.note_owned_speaking_audio)
    monkeypatch.setattr(grading, "note_owned_speaking_audio", note)
    upload = UploadFile(BytesIO(b"" if failure == "empty" else b"large audio"), filename="test.wav")
    upload.read = AsyncMock(wraps=upload.read)
    with operation_hint_scope([str(uuid4())]), pytest.raises(HTTPException):
        asyncio.run(grading.grade_response_endpoint(session["id"], question["id"], upload))
    assert upload.read.await_count == (1 if failure in {"empty", "oversize"} else 0)
    note.assert_not_awaited()
    obs.record_operation_correlation.assert_not_awaited()


def test_audio_digest_failure_or_cancellation_cannot_mutate_observation_later(monkeypatch):
    session, question, _ = data()
    current = obs._Observation("speaking", "grade", correlate_audio=True, client_operation_id=uuid4())
    async def check():
        token = obs._current.set(current)
        try:
            obs.bind_owned_attempt(session)
            failing = AsyncMock(side_effect=RuntimeError("private hashing error"))
            monkeypatch.setattr(obs.asyncio, "to_thread", failing)
            await obs.note_owned_speaking_audio(session_id=session["id"], question_id=question["id"], audio_bytes=b"fake", extension=".wav")
            assert current.input_digest is None
            failing.side_effect = asyncio.CancelledError()
            with pytest.raises(asyncio.CancelledError):
                await obs.note_owned_speaking_audio(session_id=session["id"], question_id=question["id"], audio_bytes=b"fake", extension=".wav")
            assert current.input_digest is None
        finally:
            obs._current.reset(token)
    asyncio.run(check())


@pytest.mark.parametrize("full", [False, True])
def test_real_response_route_provider_error_is_operation_failure_not_attempt_failure(monkeypatch, capture, full):
    session, question, _ = data(full)
    db = _DB(sessions=[session], questions=[question])
    monkeypatch.setattr(grading, "supabase_admin", db)
    monkeypatch.setattr(grading, "get_supabase_user", AsyncMock(return_value={"id": session["user_id"]}))
    async def execute(builder):
        return builder(db).execute()
    monkeypatch.setattr(grading, "aexecute", execute)
    monkeypatch.setattr(grading, "enforce_grading_rate_limit", lambda *args: None)
    monkeypatch.setattr(grading, "record_grading_attempt", lambda *args: None)
    monkeypatch.setattr(grading, "transcribe_from_bytes", AsyncMock(side_effect=RuntimeError("private provider message")))
    with pytest.raises(HTTPException) as error:
        asyncio.run(grading.grade_response_endpoint(session["id"], question["id"], UploadFile(BytesIO(b"fake"), filename="test.wav")))
    assert error.value.status_code == 502
    event = capture.call_args.kwargs
    assert event["event_kind"] == "operation_failed" and event["outcome"] is None
    assert event["canonical_attempt_id"] == UUID(session["full_test_attempt_id"] if full else session["id"])
    assert event["attempt_kind"] == ("speaking_full_test" if full else "speaking_session")
    assert "private" not in str(event)
    obs.observe_persisted_outcome.assert_not_called()


@pytest.mark.parametrize("route", ["response", "session", "rebuild", "learner"])
def test_actual_grade_routes_never_observe_before_authorization(monkeypatch, capture, route):
    denied = AsyncMock(side_effect=HTTPException(403, "denied"))
    monkeypatch.setattr(admin, "require_admin", denied)
    monkeypatch.setattr(grading, "get_supabase_user", denied)
    calls = {
        "response": lambda: admin.admin_regrade_response(str(uuid4())),
        "session": lambda: admin.admin_regrade_session(str(uuid4()), force=False),
        "rebuild": lambda: admin.admin_rebuild_summary(str(uuid4()), p2_id=None, p3_id=None),
        "learner": lambda: grading.grade_response_endpoint(str(uuid4()), str(uuid4()), UploadFile(BytesIO(b"fake"))),
    }
    with pytest.raises(HTTPException):
        asyncio.run(calls[route]())
    capture.assert_not_called()
    obs.observe_persisted_outcome.assert_not_called()


@pytest.mark.parametrize("route", ["response", "session", "rebuild"])
@pytest.mark.parametrize("failed", [False, True])
def test_real_admin_grade_routes_observe_after_canonical_updates(monkeypatch, capture, route, failed):
    session, question, response = data(full=True)
    db = _DB(sessions=[session], questions=[question], responses=[response])
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "require_admin", AsyncMock(return_value={"email": "admin@example.test"}))
    monkeypatch.setattr(admin, "_run_regrade_response", AsyncMock(return_value={"overall_band": 6, "re_transcribed": False}))
    monkeypatch.setattr(admin, "_regrade_incomplete_response_ids", lambda sid: [response["id"]] if failed else [])
    monkeypatch.setattr(admin, "_regrade_compute_session_bands", lambda sid: dict.fromkeys(["overall_band", "band_fc", "band_lr", "band_gra", "band_p"], 6))
    monkeypatch.setattr(admin, "sync_class_item_score", lambda *args: None)
    snapshots = []
    async def observe(*args, **kwargs):
        updates = [payload for table, action, payload in db.calls if table == "sessions" and action == "update"]
        snapshots.append((updates, args, kwargs))
    reader = AsyncMock(side_effect=observe)
    monkeypatch.setattr(obs, "observe_persisted_outcome", reader)
    if route == "response":
        result = asyncio.run(admin.admin_regrade_response(response["id"]))
        assert result["session_updated"] is not failed
    elif route == "session":
        result = asyncio.run(admin.admin_regrade_session(session["id"], force=False))
        assert result["partial_failure"] is failed
    else:
        result = asyncio.run(admin.admin_rebuild_summary(session["id"], p2_id=None, p3_id=None))
        assert result["sessions"][0]["ok"] is not failed
    event = capture.call_args.kwargs
    # A successful single-response regrade is not failed merely because a
    # sibling remains ungraded; its whole-attempt snapshot is independent.
    assert event["event_kind"] == ("operation_failed" if failed and route != "response" else "operation_succeeded")
    assert event["outcome"] is None
    reader.assert_awaited_once()
    updates, args, kwargs = snapshots[0]
    assert updates and updates[-1]["status"] == ("grading_failed" if failed else "completed")
    assert args == ("speaking", UUID(session["full_test_attempt_id"]), "speaking_full_test")
    assert kwargs["operation"] == ("finalize" if route == "rebuild" else "grade")
    assert kwargs["operation_id"] == event["operation_id"]


@pytest.mark.parametrize("enabled", [False, True])
def test_full_response_route_saves_failed_grade_then_records_soft_failure(monkeypatch, capture, enabled):
    """Execute the complete endpoint with fake AI/storage, real branch ordering."""
    monkeypatch.setattr(obs.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", enabled)
    session, question, response = data()
    db = _DB(sessions=[session], questions=[question], responses=[response])
    db.storage = MagicMock()
    monkeypatch.setattr(grading, "supabase_admin", db)
    monkeypatch.setattr(grading, "get_supabase_user", AsyncMock(return_value={"id": session["user_id"]}))
    async def execute(builder):
        return builder(db).execute()
    monkeypatch.setattr(grading, "aexecute", execute)
    monkeypatch.setattr(grading, "enforce_grading_rate_limit", lambda *args: None)
    monkeypatch.setattr(grading, "record_grading_attempt", lambda *args: None)
    monkeypatch.setattr(grading.ai_usage_logger, "log_whisper", lambda **kwargs: None)
    monkeypatch.setattr(grading, "_record_progress_mark", lambda *args: None)
    transcript = "This is a private synthetic answer about visiting a library with my friends to read books every weekend."
    monkeypatch.setattr(grading, "transcribe_from_bytes", AsyncMock(return_value={
        "transcript": transcript, "duration_seconds": 20, "confidence": 0.9, "segments": [],
    }))
    monkeypatch.setattr(grading.claude_grader, "grade_response", AsyncMock(side_effect=RuntimeError("private provider failure")))
    monkeypatch.setattr(grading, "get_judge", lambda: SimpleNamespace(judge=AsyncMock(return_value=None)))
    monkeypatch.setattr(grading, "get_grammar_check_service", lambda: SimpleNamespace(check=AsyncMock(return_value=None)))
    monkeypatch.setattr(grading, "_assess_pronunciation_safe", AsyncMock(return_value=None))
    writes_at_observation = []
    async def snapshot(*args, **kwargs):
        writes_at_observation.extend(payload for table, action, payload in db.calls if table == "responses" and action == "update")
    monkeypatch.setattr(obs, "observe_persisted_outcome", AsyncMock(side_effect=snapshot))
    result = asyncio.run(grading.grade_response_endpoint(session["id"], question["id"], UploadFile(BytesIO(b"fake audio"), filename="test.wav")))
    assert result["_stub"] is True and result["transcript"] == transcript
    assert result["response_id"] == response["id"]
    writes = [payload for table, action, payload in db.calls if table == "responses" and action == "update"]
    assert writes[-1]["grading_status"] == "failed" and writes[-1]["overall_band"] is None
    if enabled:
        assert writes_at_observation == writes
        event = capture.call_args.kwargs
        assert event["event_kind"] == "operation_failed" and event["outcome"] is None
        assert "private" not in str(event)
    else:
        capture.assert_not_called()
        obs.observe_persisted_outcome.assert_not_called()
