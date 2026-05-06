"""Tests for IELTS-mode timer logic (Phase 2.3c-3).

Two layers:
  • `_compute_timer_state` — pure function tests cover the four
    terminal cases (not timed / not started / active / expired).
    These are the truth that every endpoint reads from, so pinning
    them is non-negotiable.
  • `GET /my-assignments/{id}/timer` — endpoint tests through
    TestClient + `app.dependency_overrides` for the student-auth
    gate, with the supabase_admin module patched so we never touch
    a real database.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app
from routers.writing_student import _compute_timer_state, get_current_student


client = TestClient(app)

_STUDENT_ID = "student-uuid-timer"
_STUB_STUDENT = {
    "id":           _STUDENT_ID,
    "user_id":      "user-uuid-timer",
    "student_code": "STU-TIMER",
    "full_name":    "Timer Tester",
    "target_band":  7.0,
}


@pytest.fixture
def _override_student_auth():
    """Bypass `get_current_student` so the test doesn't need a real
    JWT or Supabase row.  Cleared in teardown."""
    app.dependency_overrides[get_current_student] = lambda: _STUB_STUDENT
    yield
    app.dependency_overrides.pop(get_current_student, None)


# ── Pure function: _compute_timer_state ──────────────────────────────


def test_compute_timer_not_timed():
    """is_timed=false → all dynamic fields cleared, is_expired=False.
    The frontend reads this and renders no timer banner at all."""
    state = _compute_timer_state({"is_timed": False})
    assert state["is_timed"] is False
    assert state["time_remaining_seconds"] is None
    assert state["expires_at"] is None
    assert state["is_expired"] is False


def test_compute_timer_not_started():
    """is_timed=true but started_at=None — the clock hasn't begun.
    expires_at + remaining are both None; is_expired stays False so
    the student can still open the form."""
    state = _compute_timer_state({
        "is_timed":           True,
        "time_limit_minutes": 40,
        "started_at":         None,
    })
    assert state["is_timed"] is True
    assert state["time_remaining_seconds"] is None
    assert state["expires_at"] is None
    assert state["is_expired"] is False


def test_compute_timer_active():
    """Mid-window assignment → positive remaining seconds within a
    sensible band.  We allow ±60s slack to absorb test-runner
    scheduling delay between started_at construction and the
    `now()` call inside the helper."""
    started_at = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    state = _compute_timer_state({
        "is_timed":           True,
        "time_limit_minutes": 40,
        "started_at":         started_at,
    })
    assert state["is_timed"] is True
    assert state["is_expired"] is False
    # 30 minutes remaining ± 60s.
    assert 30 * 60 - 60 < state["time_remaining_seconds"] < 30 * 60 + 60


def test_compute_timer_expired():
    """Past expiry → negative remaining + is_expired=True. The
    `upsert_my_draft` branch reads this flag and rejects the save
    with a 410."""
    started_at = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    state = _compute_timer_state({
        "is_timed":           True,
        "time_limit_minutes": 40,
        "started_at":         started_at,
    })
    assert state["is_expired"] is True
    assert state["time_remaining_seconds"] < 0


def test_compute_timer_handles_z_suffix():
    """Some Supabase responses come back with a `Z` suffix instead of
    `+00:00` — both must parse identically. Without the replace step
    `fromisoformat` would raise on Python 3.10."""
    started_at = datetime.now(timezone.utc).replace(microsecond=0)
    started_at_z = started_at.isoformat().replace("+00:00", "Z")
    state = _compute_timer_state({
        "is_timed":           True,
        "time_limit_minutes": 40,
        "started_at":         started_at_z,
    })
    assert state["is_expired"] is False
    assert state["time_remaining_seconds"] is not None


# ── Endpoint: GET /timer ─────────────────────────────────────────────


def _patch_supabase_for_timer(rows: list[dict]):
    """Helper — return a MagicMock that mimics the chained
    select().eq().eq().limit().execute() shape used by the
    `/timer` endpoint."""
    mock = MagicMock()
    mock.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=rows)
    return mock


def test_get_timer_endpoint_returns_active_state(_override_student_auth):
    """Active timer → is_timed=true + a positive remaining + the
    extra `status` / `auto_submitted` fields the client uses to
    decide whether the form is still editable."""
    started_at = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    row = {
        "is_timed":           True,
        "time_limit_minutes": 40,
        "started_at":         started_at,
        "status":             "in_progress",
        "auto_submitted":     False,
    }

    with patch("routers.writing_student.supabase_admin", _patch_supabase_for_timer([row])):
        r = client.get(
            "/api/writing/my-assignments/00000000-0000-0000-0000-000000000001/timer"
        )

    assert r.status_code == 200, r.text
    data = r.json()
    assert data["is_timed"] is True
    assert data["status"] == "in_progress"
    assert data["auto_submitted"] is False
    # ~35 minutes remaining ± 60s.
    assert 35 * 60 - 60 < data["time_remaining_seconds"] < 35 * 60 + 60


def test_get_timer_endpoint_404(_override_student_auth):
    """A wrong-owner or nonexistent assignment id is one symmetric
    404 — we don't leak whether the row exists for someone else."""
    with patch("routers.writing_student.supabase_admin", _patch_supabase_for_timer([])):
        r = client.get(
            "/api/writing/my-assignments/00000000-0000-0000-0000-000000000002/timer"
        )

    assert r.status_code == 404


def test_get_timer_endpoint_unauthenticated():
    """No auth → bounced by `get_current_student` (the same gate as
    every other /api/writing endpoint)."""
    r = client.get(
        "/api/writing/my-assignments/00000000-0000-0000-0000-000000000003/timer"
    )
    assert r.status_code in (401, 403)


# ── Draft expiry: PATCH /draft must reject when timer is past expiry ─


def test_draft_save_rejected_after_expiry():
    """`upsert_my_draft` reads `_compute_timer_state` against the
    in-memory assignment row (after the optional started_at stamp).
    A draft save that lands after the window must surface the
    Vietnamese "Hết giờ" message — the frontend's auto-submit relies
    on this contract to know the row is locked.

    We test the handler directly to avoid wiring the full
    multi-table mock (assignment fetch + draft upsert + status
    update). The body builds a fake expired assignment and asserts
    the HTTPException(410) fires before any DB write attempt."""
    import asyncio
    from unittest.mock import patch as _patch
    from fastapi import HTTPException
    from routers.writing_student import DraftUpsert, upsert_my_draft

    expired_started_at = (
        datetime.now(timezone.utc) - timedelta(hours=2)
    ).isoformat()

    fake_assignment = {
        "id":                  "00000000-0000-0000-0000-000000000099",
        "status":              "in_progress",
        "is_timed":            True,
        "time_limit_minutes":  40,
        "started_at":          expired_started_at,
        "writing_prompts":     {"task_type": "task2", "prompt_text": "x"},
    }

    with _patch("routers.writing_student._resolve_active_assignment",
                return_value=fake_assignment):
        coro = upsert_my_draft(
            assignment_id="00000000-0000-0000-0000-000000000099",
            body=DraftUpsert(draft_text="late save"),
            student=_STUB_STUDENT,
        )
        with pytest.raises(HTTPException) as excinfo:
            asyncio.run(coro)

    assert excinfo.value.status_code == 410
    assert "hết giờ" in excinfo.value.detail.lower()
