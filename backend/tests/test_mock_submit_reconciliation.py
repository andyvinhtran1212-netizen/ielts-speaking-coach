"""Lost-ACK reconciliation for sealed Reading/Listening mock attempts."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import listening, reading_student


def run(awaitable):
    return asyncio.run(awaitable)


def test_reading_submitted_mock_replays_opaque_sealed_receipt(monkeypatch):
    monkeypatch.setattr(reading_student, "_optional_auth", AsyncMock(return_value=None))
    monkeypatch.setattr(
        reading_student,
        "_fetch_attempt_owned",
        lambda *_args: {"id": "r1", "status": "submitted", "sitting_id": "s1"},
    )
    from services import mock_exam_service
    monkeypatch.setattr(mock_exam_service, "is_sealed", lambda sitting_id: sitting_id == "s1")

    result = run(reading_student.submit_reading_test_attempt(
        "r1", reading_student._SubmitRequest(answers=[]), authorization="Bearer x",
    ))
    assert result == {"received": True, "sitting_id": "s1", "sealed": True}


def test_reading_normal_submitted_attempt_still_rejects_replay(monkeypatch):
    monkeypatch.setattr(reading_student, "_optional_auth", AsyncMock(return_value=None))
    monkeypatch.setattr(
        reading_student,
        "_fetch_attempt_owned",
        lambda *_args: {"id": "r1", "status": "submitted", "sitting_id": None},
    )
    with pytest.raises(HTTPException) as caught:
        run(reading_student.submit_reading_test_attempt(
            "r1", reading_student._SubmitRequest(answers=[]), authorization="Bearer x",
        ))
    assert caught.value.status_code == 422


def test_listening_submitted_mock_replays_opaque_sealed_receipt(monkeypatch):
    async def auth(_authorization):
        return {"id": "u1"}

    monkeypatch.setattr(listening, "_require_auth", auth)
    monkeypatch.setattr(
        listening,
        "_fetch_attempt_or_404",
        lambda *_args: {"id": "l1", "status": "submitted", "sitting_id": "s1"},
    )
    monkeypatch.setattr(listening, "_mock_sealed", lambda attempt: attempt.get("sitting_id") == "s1")

    result = run(listening.submit_listening_test_attempt("l1", authorization="Bearer x"))
    assert result == {"received": True, "sitting_id": "s1", "sealed": True}


def test_listening_normal_submitted_attempt_still_rejects_replay(monkeypatch):
    async def auth(_authorization):
        return {"id": "u1"}

    monkeypatch.setattr(listening, "_require_auth", auth)
    monkeypatch.setattr(
        listening,
        "_fetch_attempt_or_404",
        lambda *_args: {"id": "l1", "status": "submitted", "sitting_id": None},
    )
    monkeypatch.setattr(listening, "_mock_sealed", lambda _attempt: False)
    with pytest.raises(HTTPException) as caught:
        run(listening.submit_listening_test_attempt("l1", authorization="Bearer x"))
    assert caught.value.status_code == 422
