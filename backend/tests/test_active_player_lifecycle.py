from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from services.active_player_lifecycle import (
    ACTIVE_PLAYER_TTL,
    is_active_player_expired_error,
    is_resume_active,
    require_resume_active,
    resume_expires_at,
)


def test_resume_expiry_is_exactly_24_hours_from_aware_start():
    start = datetime(2026, 8, 20, 3, 30, tzinfo=timezone.utc)
    assert datetime.fromisoformat(resume_expires_at(start)) - start == ACTIVE_PLAYER_TTL


def test_only_well_formed_unexpired_in_progress_row_is_active():
    now = datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc)
    future = (now + timedelta(seconds=1)).isoformat()
    past = (now - timedelta(seconds=1)).isoformat()
    assert is_resume_active(
        {"status": "in_progress", "resume_expires_at": future}, now=now,
    ) is True
    assert is_resume_active(
        {"status": "in_progress", "resume_expires_at": past}, now=now,
    ) is False
    assert is_resume_active(
        {"status": "completed", "resume_expires_at": future}, now=now,
    ) is False
    assert is_resume_active({"status": "in_progress"}, now=now) is False
    assert is_resume_active(
        {"status": "in_progress", "resume_expires_at": "bad"}, now=now,
    ) is False


def test_expired_or_missing_contract_fails_closed_without_mutating_row():
    row = {"status": "in_progress", "resume_expires_at": None, "answers": ["kept"]}
    with pytest.raises(HTTPException) as caught:
        require_resume_active(row)
    assert caught.value.status_code == 410
    assert row["answers"] == ["kept"]


def test_postgrest_wrapped_expiry_marker_is_recognized():
    assert is_active_player_expired_error(
        RuntimeError('{"code":"55000","message":"active_player_expired"}')
    ) is True
    assert is_active_player_expired_error(RuntimeError("db down")) is False
