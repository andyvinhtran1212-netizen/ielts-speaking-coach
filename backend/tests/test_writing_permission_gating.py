"""Tests for Sprint 5.2 Writing permission gating across the routers.

Covers:
  - POST /admin/writing/essays            — admin-on-behalf-of flow
  - POST /api/writing/my-assignments/{id}/submit — student self-submit
  - GET /api/student/permissions          — summary endpoint
  - POST /admin/access-codes/generate     — allowlist validation
  - PATCH /admin/access-codes/{id}        — allowlist validation

Strategy: each test patches the dependency boundary that's NOT the gate
under test (auth, the actual essay service, etc.) so a 403 from the
permission gate is unambiguous. The permission lookup itself is
re-pointed at a stub that returns a deterministic permission list per
test — this isolates the gating logic from the live Supabase access
layer (which has its own coverage in test_access_code_permissions.py).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_USER_AUTH = {"Authorization": "Bearer fake.user.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_USER = {
    "id": "00000000-0000-0000-0000-00000000bbbb",
    "email": "student@x",
    "user_metadata": {"display_name": "Test Student"},
}
_STUDENT_ID = "00000000-0000-0000-0000-00000000cccc"
_STUDENT = {
    "id": _STUDENT_ID,
    "user_id": _USER["id"],
    "student_code": "S001",
    "full_name": "Test Student",
    "target_band": 7.0,
}


# ── POST /admin/writing/essays — admin-on-behalf gate ────────────────


def _essay_payload() -> dict:
    return {
        "student_id": _STUDENT_ID,
        "task_type": "task2",
        "prompt_text": "Some essay prompt.",
        "essay_text": "A reasonable essay body. " * 8,
        "analysis_level": 3,
        "form_of_address": "em",
        "selected_model": "gemini-2.5-pro",
        "grading_tier": "standard",
    }


def test_admin_essay_create_blocked_when_student_lacks_writing():
    """Admin auth is fine; the *student's* permissions don't grant
    Writing → 403, with a Vietnamese message that surfaces the missing
    permission."""
    with patch(
        "routers.admin_writing.require_admin",
        new=AsyncMock(return_value=_ADMIN_USER),
    ), patch(
        "routers.admin_writing.get_student_access_code_permissions",
        return_value=["practice_single"],  # Speaking-only — no writing.
    ) as gate:
        r = _client().post(
            "/admin/writing/essays", headers=_ADMIN_AUTH, json=_essay_payload(),
        )
    assert r.status_code == 403, r.text
    assert "Writing" in r.json()["detail"]
    # Gate must be queried with the essay's owner, NOT the admin's user_id.
    gate.assert_called_once()
    called_with_student = str(gate.call_args.args[0])
    assert called_with_student == _STUDENT_ID


def test_admin_essay_create_succeeds_with_writing_permission():
    """Permission present → handler proceeds past the gate. We mock the
    essay_service so the test doesn't touch Supabase; a 202 response is
    proof the gate let the request through."""
    with patch(
        "routers.admin_writing.require_admin",
        new=AsyncMock(return_value=_ADMIN_USER),
    ), patch(
        "routers.admin_writing.get_student_access_code_permissions",
        return_value=["writing"],
    ), patch(
        "services.essay_service.create_essay_with_job",
        return_value={"essay_id": str(uuid4()), "job_id": str(uuid4()), "eta_seconds": 30},
    ):
        r = _client().post(
            "/admin/writing/essays", headers=_ADMIN_AUTH, json=_essay_payload(),
        )
    assert r.status_code == 202, r.text


def test_admin_essay_create_succeeds_with_admin_override():
    """`all` is the wildcard — same path as explicit `writing`."""
    with patch(
        "routers.admin_writing.require_admin",
        new=AsyncMock(return_value=_ADMIN_USER),
    ), patch(
        "routers.admin_writing.get_student_access_code_permissions",
        return_value=["all"],
    ), patch(
        "services.essay_service.create_essay_with_job",
        return_value={"essay_id": str(uuid4()), "job_id": str(uuid4()), "eta_seconds": 30},
    ):
        r = _client().post(
            "/admin/writing/essays", headers=_ADMIN_AUTH, json=_essay_payload(),
        )
    assert r.status_code == 202, r.text


# ── POST /api/writing/my-assignments/{id}/submit — student self-submit ─


def test_student_submit_blocked_without_writing_permission():
    """Student self-submit checks the *student's own* permissions.

    Uses FastAPI's app.dependency_overrides because the handler resolves
    `student` via `Depends(get_current_student)` — patching the symbol
    in the router module doesn't intercept the dependency call.
    """
    from main import app
    from routers.writing_student import get_current_student

    assignment_id = str(uuid4())
    app.dependency_overrides[get_current_student] = lambda: _STUDENT
    try:
        with patch(
            "routers.writing_student.get_user_access_code_permissions",
            return_value=["practice_single"],
        ):
            r = _client().post(
                f"/api/writing/my-assignments/{assignment_id}/submit",
                headers=_USER_AUTH,
                json={"essay_text": "A draft essay body."},
            )
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 403, r.text
    assert "Writing" in r.json()["detail"]


# ── GET /api/student/permissions ─────────────────────────────────────


def test_permissions_endpoint_returns_summary_for_speaking_only_user():
    with patch(
        "routers.student_home.get_supabase_user",
        new=AsyncMock(return_value=_USER),
    ), patch(
        "routers.student_home.get_user_access_code_permissions",
        return_value=["practice_single"],
    ):
        r = _client().get("/api/student/permissions", headers=_USER_AUTH)
    assert r.status_code == 200
    data = r.json()
    assert data["writing"] is False
    assert data["speaking_practice_single"] is True
    assert data["is_admin_override"] is False


def test_permissions_endpoint_writing_true_with_admin_override():
    with patch(
        "routers.student_home.get_supabase_user",
        new=AsyncMock(return_value=_USER),
    ), patch(
        "routers.student_home.get_user_access_code_permissions",
        return_value=["all"],
    ):
        r = _client().get("/api/student/permissions", headers=_USER_AUTH)
    assert r.status_code == 200
    data = r.json()
    assert data["writing"] is True
    assert data["is_admin_override"] is True


def test_permissions_endpoint_unauthenticated_returns_401():
    r = _client().get("/api/student/permissions")
    assert r.status_code == 401


# ── Access-code create/update validation ─────────────────────────────


def test_generate_access_codes_rejects_unknown_permission():
    """Typo in the admin form must surface as 400, not silently insert."""
    with patch(
        "routers.admin.require_admin",
        new=AsyncMock(return_value=_ADMIN_USER),
    ):
        r = _client().post(
            "/admin/access-codes/generate",
            headers=_ADMIN_AUTH,
            json={"count": 1, "permissions": ["writting"]},  # typo
        )
    assert r.status_code == 400, r.text
    assert "writting" in r.json()["detail"]


def test_generate_access_codes_accepts_writing_permission():
    """The new `writing` value must pass validation."""
    with patch(
        "routers.admin.require_admin",
        new=AsyncMock(return_value=_ADMIN_USER),
    ), patch(
        "routers.admin.supabase_admin"
    ) as sb:
        # supabase_admin.table(...).insert(...).execute() chain.
        sb.table.return_value.insert.return_value.execute.return_value.data = [{}]
        r = _client().post(
            "/admin/access-codes/generate",
            headers=_ADMIN_AUTH,
            json={"count": 1, "permissions": ["writing"]},
        )
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1


def test_patch_access_code_rejects_unknown_permission():
    """Same allowlist guard on the edit path."""
    with patch(
        "routers.admin.require_admin",
        new=AsyncMock(return_value=_ADMIN_USER),
    ):
        r = _client().patch(
            f"/admin/access-codes/{uuid4()}",
            headers=_ADMIN_AUTH,
            json={"permissions": ["foo_bar"]},
        )
    assert r.status_code == 400, r.text
    assert "foo_bar" in r.json()["detail"]
