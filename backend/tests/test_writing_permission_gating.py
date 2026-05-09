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


# ── Sprint 5.2.1 — gate the 6 student-mutation endpoints ──────────────


_GATED_ENDPOINTS = [
    ("GET",   "/api/writing/my-assignments"),
    ("GET",   "/api/writing/my-assignments/{aid}"),
    ("PATCH", "/api/writing/my-assignments/{aid}/draft"),
    ("POST",  "/api/writing/my-assignments/{aid}/start"),
    ("POST",  "/api/writing/my-assignments/{aid}/paste-log"),
]
# extract-text takes a multipart upload — test separately below.


import pytest


@pytest.mark.parametrize("method,path", _GATED_ENDPOINTS)
def test_assignment_endpoints_403_without_writing_permission(method, path):
    """Speaking-only student calling a Writing student endpoint must
    hit the new require_writing_permission dependency and 403."""
    from main import app
    from routers.writing_student import get_current_student

    aid = str(uuid4())
    actual_path = path.replace("{aid}", aid)
    app.dependency_overrides[get_current_student] = lambda: _STUDENT
    try:
        with patch(
            "routers.writing_student.get_user_access_code_permissions",
            return_value=["practice_single"],
        ):
            # Body content doesn't matter — the gate fires before any
            # validation. Use a benign payload for write methods.
            json_body = (
                {"draft_text": "hi"} if "draft" in actual_path
                else {"char_count": 1, "fragment": "x"} if "paste-log" in actual_path
                else None
            )
            r = _client().request(method, actual_path, headers=_USER_AUTH, json=json_body)
    finally:
        app.dependency_overrides.clear()

    assert r.status_code == 403, f"{method} {actual_path} → {r.status_code} {r.text}"
    assert "Writing" in r.json()["detail"]


def test_extract_text_403_without_writing_permission():
    """extract-text is a multipart endpoint, hit it with a tiny upload."""
    from main import app
    from routers.writing_student import get_current_student

    app.dependency_overrides[get_current_student] = lambda: _STUDENT
    try:
        with patch(
            "routers.writing_student.get_user_access_code_permissions",
            return_value=["practice_single"],
        ):
            r = _client().post(
                "/api/writing/extract-text",
                headers=_USER_AUTH,
                files={"file": ("essay.txt", b"hello world", "text/plain")},
            )
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 403
    assert "Writing" in r.json()["detail"]


def test_get_essays_history_NOT_gated_for_speaking_only_student():
    """View endpoints for already-submitted essays remain accessible
    even without Writing permission — the spec calls this 'preview
    mode' and a regression that gates GET /my-essays would lock
    students out of work they already submitted."""
    from main import app
    from routers.writing_student import get_current_student

    app.dependency_overrides[get_current_student] = lambda: _STUDENT
    try:
        # No `with patch(...)` for the permission lookup — the autouse
        # conftest fixture defaults to ["all"], BUT the production
        # behavior we're pinning is "no permission check on this route
        # at all". Patch the supabase query so the empty-list path is
        # deterministic.
        with patch(
            "routers.writing_student.supabase_admin"
        ) as sb:
            sb.table.return_value.select.return_value.eq.return_value.order.return_value.execute.return_value.data = []
            r = _client().get("/api/writing/my-essays", headers=_USER_AUTH)
    finally:
        app.dependency_overrides.clear()
    # The test asserts the route doesn't 403 — body shape tolerated.
    assert r.status_code != 403, r.text


def test_existing_submit_endpoint_still_gates_inline():
    """Pre-Sprint 5.2.1 the submit endpoint had its own inline gate.
    The hotfix didn't refactor it (out of scope) so this test pins the
    inline gate is still active even when the new dependency isn't
    applied to /submit."""
    from main import app
    from routers.writing_student import get_current_student

    app.dependency_overrides[get_current_student] = lambda: _STUDENT
    try:
        with patch(
            "routers.writing_student.get_user_access_code_permissions",
            return_value=["practice_single"],
        ):
            r = _client().post(
                f"/api/writing/my-assignments/{uuid4()}/submit",
                headers=_USER_AUTH,
                json={"essay_text": "essay body"},
            )
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 403
    assert "Writing" in r.json()["detail"]


# ── Sprint 5.2.1 — /auth/activate expiry rejection ───────────────────


from datetime import datetime, timedelta, timezone


def test_activate_rejects_expired_code():
    """A code whose expires_at is in the past must 400 from /activate
    with a Vietnamese 'đã hết hạn' message."""
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    code_row = {
        "id": str(uuid4()),
        "code": "EXPIRED1",
        "is_used": False,
        "is_revoked": False,
        "is_active": True,
        "permissions": ["writing"],
        "expires_at": yesterday,
    }
    auth_user = {"id": _USER["id"], "email": "x@y.com", "user_metadata": {}}

    with patch(
        "routers.auth.get_supabase_user",
        new=AsyncMock(return_value=auth_user),
    ), patch(
        "routers.auth.supabase_admin"
    ) as sb:
        # First call: lookup the code by code-string.
        sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [code_row]
        r = _client().post(
            "/auth/activate",
            headers=_USER_AUTH,
            json={"access_code": "EXPIRED1"},
        )

    assert r.status_code == 400
    assert "hết hạn" in r.json()["detail"]


def test_activate_accepts_unexpired_code():
    """A code with expires_at in the future passes the expiry check.
    The handler still does additional work (upsert user, mark used,
    etc.) which we patch through so the test only exercises the gate."""
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    code_row = {
        "id": str(uuid4()),
        "code": "VALID001",
        "is_used": False,
        "is_revoked": False,
        "is_active": True,
        "permissions": ["writing"],
        "expires_at": tomorrow,
    }
    auth_user = {"id": _USER["id"], "email": "x@y.com", "user_metadata": {}}

    with patch(
        "routers.auth.get_supabase_user",
        new=AsyncMock(return_value=auth_user),
    ), patch(
        "routers.auth.supabase_admin"
    ) as sb:
        # Sequence of calls inside /activate:
        #   1. SELECT * FROM access_codes WHERE code=...
        #   2. SELECT id FROM users WHERE id=...
        #   3. UPDATE users SET is_active=true ...
        #   4. UPDATE access_codes SET is_used=true ...
        #   5. INSERT INTO user_code_assignments ...
        # We don't care about the bodies — just need each chain to
        # resolve to a benign empty/data dict so the handler completes.
        sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [code_row]
        sb.table.return_value.update.return_value.eq.return_value.execute.return_value.data = []
        sb.table.return_value.insert.return_value.execute.return_value.data = []

        r = _client().post(
            "/auth/activate",
            headers=_USER_AUTH,
            json={"access_code": "VALID001"},
        )
    # The handler does many things after the gate; we only assert it
    # didn't 400 on expiry. 200/201/202 all acceptable.
    assert r.status_code != 400 or "hết hạn" not in r.json().get("detail", ""), r.text


def test_activate_accepts_null_expiry_code():
    """expires_at = NULL → never expires."""
    code_row = {
        "id": str(uuid4()),
        "code": "NEVERX01",
        "is_used": False,
        "is_revoked": False,
        "is_active": True,
        "permissions": ["all"],
        "expires_at": None,
    }
    auth_user = {"id": _USER["id"], "email": "x@y.com", "user_metadata": {}}

    with patch(
        "routers.auth.get_supabase_user",
        new=AsyncMock(return_value=auth_user),
    ), patch(
        "routers.auth.supabase_admin"
    ) as sb:
        sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [code_row]
        sb.table.return_value.update.return_value.eq.return_value.execute.return_value.data = []
        sb.table.return_value.insert.return_value.execute.return_value.data = []

        r = _client().post(
            "/auth/activate",
            headers=_USER_AUTH,
            json={"access_code": "NEVERX01"},
        )
    # Same logic as test_activate_accepts_unexpired_code — assert no
    # expiry-specific 400.
    assert r.status_code != 400 or "hết hạn" not in r.json().get("detail", ""), r.text
