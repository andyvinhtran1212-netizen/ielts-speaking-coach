"""ADMINAAL2-0032 T008 — AC9 / FR-018: activation cannot undo a suspension.

A suspended instructor whose session revocation AND sign-in ban were forced to
fail still holds a working token. With it they try ``/auth/activate`` with a
valid unused code while an admin issues them a code. Both are refused with
``account_suspended``; the code stays unused (self-service) or is revoked by
the issuance's own compensation (admin path); ``users.is_active`` stays false
with the marker set; ``/auth/me`` and ``/auth/check-active`` report
``suspended: true``; and every ``/instructor/*`` call is 403.

The in-memory database and its migration 332/336 emulation are shared with
tests/test_admin_staff_security_routes.py.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

import routers.admin as admin_module
import routers.admin_staff_security as sec_module
import routers.auth as auth_module
from services import activation_gate

from tests.test_admin_staff_security_routes import (  # shared fakes
    ADMIN,
    ADMIN2,
    AUTH,
    INSTRUCTOR,
    FakeDB,
    FakeEngine,
)

CODE = "AB12-CD34"
SUSPENDED_DETAIL = {"code": "account_suspended", "message": "Tài khoản đang bị tạm khóa — liên hệ admin"}


@pytest.fixture
def world(monkeypatch, live_activation_gate):
    db = FakeDB()
    db.seed(ADMIN, "admin")
    db.seed(ADMIN2, "admin")
    db.seed(INSTRUCTOR, "instructor", email="gv@example.test")
    db.tables["access_codes"] = [{
        "id": "code-1", "code": CODE, "is_used": False, "used_by": None, "used_at": None,
        "is_revoked": False, "is_active": True, "expires_at": None, "grants_role": None,
        "intended_email": None, "cohort_id": None, "permissions": ["practice_single"],
    }]
    db.tables["students"] = []
    db.tables["user_code_assignments"] = []
    engine = FakeEngine({INSTRUCTOR: 2})
    for module in (admin_module, auth_module, activation_gate):
        monkeypatch.setattr(module, "supabase_admin", db)
    monkeypatch.setattr(admin_module, "_db_engine", engine)

    # The instructor's token keeps working: the forced revocation failure
    # left their session alive, so GoTrue still accepts it.
    async def verified(authorization):
        token = (authorization or "").removeprefix("Bearer ")
        if token == "instructor":
            return {"id": INSTRUCTOR, "email": "gv@example.test", "user_metadata": {}}
        if token == "admin":
            return {"id": ADMIN, "email": "admin@example.test", "user_metadata": {}}
        from fastapi import HTTPException
        raise HTTPException(401, "Unauthorized")

    monkeypatch.setattr(auth_module, "get_supabase_user", verified)
    monkeypatch.setattr(admin_module, "get_supabase_user", verified)
    admin_guard = AsyncMock(return_value={"id": ADMIN, "email": "admin@example.test"})

    from main import app
    with patch.object(sec_module, "require_admin", new=admin_guard), \
            patch.object(admin_module, "require_admin", new=admin_guard):
        with TestClient(app, raise_server_exceptions=False) as api:
            yield db, engine, api


def _suspend_with_failed_revocation(db, engine, api):
    db.auth.admin.fail_ban = True
    engine.fail = True
    r = api.patch(f"/admin/users/{INSTRUCTOR}/active",
                  json={"is_active": False, "reason": "nghi lộ tài khoản"}, headers=AUTH)
    assert r.status_code == 200, r.text
    assert r.json()["sessions_revoked"] is False and r.json()["revoke_error"] == "ban_failed"
    assert INSTRUCTOR not in db.auth.admin.banned and engine.sessions[INSTRUCTOR] == 2


def _code(db):
    return db.tables["access_codes"][0]


def _assert_still_suspended(db):
    row = db.user(INSTRUCTOR)
    assert row["is_active"] is False and row["suspended_at"]


def _activate(api, token="instructor"):
    return api.post("/auth/activate", json={"access_code": CODE},
                    headers={"Authorization": f"Bearer {token}"})


def test_ac9_activation_and_admin_issued_code_are_refused(world):
    db, engine, api = world
    _suspend_with_failed_revocation(db, engine, api)

    # Self-service activation with a valid unused code.
    r = _activate(api)
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == SUSPENDED_DETAIL
    assert _code(db)["is_used"] is False and _code(db)["used_by"] is None
    assert not [op for op in db.ops if op == ("access_codes", "update")]
    _assert_still_suspended(db)

    # An admin issues them a code: the trigger refuses the activation and the
    # issuance compensates its own code and assignment.
    r = api.post("/admin/access-codes/generate-and-assign",
                 json={"user_id": INSTRUCTOR, "permissions": ["practice_single"]}, headers=AUTH)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == SUSPENDED_DETAIL
    issued = [c for c in db.tables["access_codes"] if c.get("code") != CODE]
    assert len(issued) == 1 and issued[0]["is_revoked"] is True and issued[0]["is_active"] is False
    assert all(a["is_active"] is False for a in db.tables["user_code_assignments"])
    _assert_still_suspended(db)

    # The original code is still usable by someone else.
    assert _code(db)["is_used"] is False

    # /auth/me and /auth/check-active report the suspension.
    me = api.get("/auth/me", headers={"Authorization": "Bearer instructor"})
    assert me.status_code == 200, me.text
    assert me.json()["suspended"] is True and me.json()["is_active"] is False
    status = api.get("/auth/check-active", headers={"Authorization": "Bearer instructor"})
    assert status.json() == {"is_active": False, "suspended": True}

    # Every instructor route refuses the still-valid token.
    for path in ("/instructor/students", "/instructor/cohorts"):
        denied = api.get(path, headers={"Authorization": "Bearer instructor"})
        assert denied.status_code == 403, (path, denied.text)
        assert denied.json()["detail"] == activation_gate.INACTIVE_DETAIL


def test_suspension_committed_between_step_1d_and_step_3_is_refused(world):
    """Step 1d read no marker; the suspension commits before Step 3's write.
    The migration-332 trigger refuses the write and the code stays unused."""
    db, _engine, api = world
    db.user(INSTRUCTOR)["is_active"] = False          # never activated yet

    def concurrent_suspension(table, op):
        row = db.user(INSTRUCTOR)
        if table == "users" and op == "update" and not row["suspended_at"]:
            row.update(suspended_at="2026-10-29T01:00:00+00:00", suspended_by=ADMIN2,
                       suspension_reason="song song")

    db.on_execute = concurrent_suspension
    r = _activate(api)
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == SUSPENDED_DETAIL
    assert _code(db)["is_used"] is False
    _assert_still_suspended(db)


def test_step_1d_read_failure_is_an_error_not_an_activation(world):
    db, _engine, api = world
    db.user(INSTRUCTOR)["is_active"] = False
    reads = {"n": 0}

    def users_read_down(table, op):
        if table == "users" and op == "select":
            reads["n"] += 1
            if reads["n"] == 1:
                raise RuntimeError("users down")

    db.on_execute = users_read_down
    r = _activate(api)
    assert r.status_code == 500
    assert _code(db)["is_used"] is False and db.user(INSTRUCTOR)["is_active"] is False


def test_never_activated_instructor_still_activates(world):
    """``suspended_at`` is distinct from "never activated" (FR-006): Step 1d
    lets an inactive account without the marker activate normally."""
    db, _engine, api = world
    db.user(INSTRUCTOR)["is_active"] = False
    r = _activate(api)
    assert r.status_code == 200, r.text
    assert db.user(INSTRUCTOR)["is_active"] is True
    assert _code(db)["is_used"] is True and _code(db)["used_by"] == INSTRUCTOR
    status = api.get("/auth/check-active", headers={"Authorization": "Bearer instructor"})
    assert status.json() == {"is_active": True, "suspended": False}


def test_reactivation_then_activation_paths_work_again(world):
    db, engine, api = world
    _suspend_with_failed_revocation(db, engine, api)
    db.auth.admin.fail_ban = False
    r = api.patch(f"/admin/users/{INSTRUCTOR}/active",
                  json={"is_active": True, "reason": "đã xác minh"}, headers=AUTH)
    assert r.status_code == 200 and r.json()["sign_in_restored"] is True
    status = api.get("/auth/check-active", headers={"Authorization": "Bearer instructor"})
    assert status.json() == {"is_active": True, "suspended": False}
