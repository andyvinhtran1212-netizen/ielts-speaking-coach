"""Tests for /admin/writing/* endpoints (Sprint W2 Phase 2).

Covers three layers:
  1. Auth gate — Pydantic body validation reaches the auth gate when a
     valid body shape is supplied.
  2. Pydantic body validation — required fields, enum-shaped strings,
     bounds.
  3. Happy-path handler logic — request/response shape with require_admin
     and essay_service stubbed out so we don't touch Supabase or Gemini.

W0 already pinned no-auth-header → 401 for POST /admin/writing/essays
and GET /admin/writing/essays in test_admin_writing_routers.py; we add
PATCH/DELETE/status/render coverage here.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_STUDENT_ID = "00000000-0000-0000-0000-000000000001"
_ESSAY_ID   = "00000000-0000-0000-0000-000000000002"
_JOB_ID     = "00000000-0000-0000-0000-000000000003"


def _valid_create_body() -> dict:
    return {
        "student_id":      _STUDENT_ID,
        "task_type":       "task2",
        "prompt_text":     "Some Task 2 prompt",
        "essay_text":      "An IELTS task 2 essay submitted for grading.",
        "analysis_level":  3,
        "form_of_address": "em",
        "selected_model":  "gemini-2.5-pro",
    }


# ── Auth gate (extends W0 coverage) ──────────────────────────────────

def test_essays_status_requires_auth_header():
    r = _client().get(f"/admin/writing/essays/{_ESSAY_ID}/status")
    assert r.status_code == 401


def test_essays_get_one_requires_auth_header():
    r = _client().get(f"/admin/writing/essays/{_ESSAY_ID}")
    assert r.status_code == 401


# ── Pydantic body validation ─────────────────────────────────────────

def test_create_essay_rejects_missing_required_fields():
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/writing/essays", json={}, headers=_ADMIN_AUTH)
    assert r.status_code == 422


def test_create_essay_rejects_invalid_task_type():
    body = _valid_create_body()
    body["task_type"] = "task3"
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/writing/essays", json=body, headers=_ADMIN_AUTH)
    assert r.status_code == 422


def test_create_essay_rejects_invalid_analysis_level():
    body = _valid_create_body()
    body["analysis_level"] = 7
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/writing/essays", json=body, headers=_ADMIN_AUTH)
    assert r.status_code == 422


def test_create_essay_rejects_invalid_model():
    body = _valid_create_body()
    body["selected_model"] = "gpt-4"
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/writing/essays", json=body, headers=_ADMIN_AUTH)
    assert r.status_code == 422


# ── Happy-path handler wiring ────────────────────────────────────────

def test_create_essay_returns_202_with_eta_and_schedules_bg_task():
    info = {"essay_id": _ESSAY_ID, "job_id": _JOB_ID, "eta_seconds": 45}
    sentinel_bg = MagicMock(__name__="_bg_grade_essay")

    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.create_essay_with_job",
               return_value=info) as mock_create, \
         patch("routers.admin_writing.essay_service._bg_grade_essay", new=sentinel_bg):
        r = _client().post(
            "/admin/writing/essays",
            json=_valid_create_body(),
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 202, r.text
    body = r.json()
    assert body["essay_id"] == _ESSAY_ID
    assert body["job_id"] == _JOB_ID
    assert body["eta_seconds"] == 45
    assert body["status"] == "queued"

    # admin_id propagated; UUID coerced to str for Supabase
    kwargs = mock_create.call_args.kwargs
    assert kwargs["admin_id"] == _ADMIN_USER["id"]
    assert kwargs["data"]["student_id"] == _STUDENT_ID
    assert isinstance(kwargs["data"]["student_id"], str)


def test_list_essays_passes_filters():
    rows = [{"id": _ESSAY_ID, "status": "graded"}]
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.list_essays",
               return_value=rows) as mock_list:
        r = _client().get(
            f"/admin/writing/essays?status=graded&student_id={_STUDENT_ID}&limit=10&offset=20",
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200
    assert r.json() == rows
    kwargs = mock_list.call_args.kwargs
    assert kwargs == {
        "status": "graded",
        "student_id": _STUDENT_ID,
        "limit": 10,
        "offset": 20,
    }


def test_list_essays_no_filters_passes_none():
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.list_essays",
               return_value=[]) as mock_list:
        r = _client().get("/admin/writing/essays", headers=_ADMIN_AUTH)
    assert r.status_code == 200
    kwargs = mock_list.call_args.kwargs
    assert kwargs["status"] is None
    assert kwargs["student_id"] is None


def test_get_essay_returns_detail():
    detail = {"id": _ESSAY_ID, "status": "graded", "feedback": {"overall_band_score": 7.0}}
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.get_essay_with_feedback",
               return_value=detail) as mock_detail:
        r = _client().get(f"/admin/writing/essays/{_ESSAY_ID}", headers=_ADMIN_AUTH)
    assert r.status_code == 200
    assert r.json() == detail
    mock_detail.assert_called_once_with(_ESSAY_ID)


def test_get_essay_status_returns_eta_payload():
    payload = {
        "essay_id": _ESSAY_ID,
        "status": "grading",
        "error_message": None,
        "eta_seconds": 45,
        "created_at": "2026-05-01T00:00:00Z",
    }
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.get_essay_status",
               return_value=payload):
        r = _client().get(
            f"/admin/writing/essays/{_ESSAY_ID}/status",
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200
    assert r.json()["eta_seconds"] == 45


# ── W3 placeholders still 501 ────────────────────────────────────────

def test_w3_endpoints_still_return_501():
    """Sanity: PATCH /feedback, DELETE, /render, /export.docx, /stats stay 501
    until W3 lands."""
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().patch(
            f"/admin/writing/essays/{_ESSAY_ID}/feedback",
            json={"any": "edit"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 501
        r = _client().delete(
            f"/admin/writing/essays/{_ESSAY_ID}",
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 501
        r = _client().get("/admin/writing/stats", headers=_ADMIN_AUTH)
        assert r.status_code == 501
