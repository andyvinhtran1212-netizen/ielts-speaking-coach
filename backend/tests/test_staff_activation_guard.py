"""Q-13 — staff roles do not replace activation.

The learner activation gate (services/activation_gate.py) skips /admin,
/api/admin and /instructor by prefix, so the staff guards in routers/admin.py
own the ``users.is_active`` check for those surfaces. Before Q-13 an account
with role=instructor (or admin) but is_active=false passed require_instructor /
require_admin and read the whole staff console (reproduced on staging).

These tests run the REAL guards and the REAL is_active lookup
(``live_activation_gate``) over an in-memory ``users`` table. Any other table
access answers 418 (and is recorded), so a 418 / a recorded table proves a
request got PAST the guard into the handler, while 403 "Tài khoản chưa được kích hoạt" proves the guard stopped it
before any staff data was read.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
import routers.admin as admin_module
import routers.auth as auth_module
import routers.instructor as instructor_module
from services import activation_gate
from services.activation_gate import INACTIVE_DETAIL

USERS = {
    "instructor-active":   {"role": "instructor", "is_active": True},
    "instructor-inactive": {"role": "instructor", "is_active": False},
    "admin-active":        {"role": "admin",      "is_active": True},
    "admin-inactive":      {"role": "admin",      "is_active": False},
    "learner-active":      {"role": "user",       "is_active": True},
    "learner-inactive":    {"role": "user",       "is_active": False},
}


class _Result:
    def __init__(self, data):
        self.data = data


class _UsersQuery:
    def __init__(self, db):
        self.db, self.uid = db, None

    def select(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def eq(self, col, val):
        assert col == "id", col
        self.uid = val
        return self

    def execute(self):
        if self.db.fail_active_lookup and self.db.lookups and self.db.lookups[-1] == self.uid:
            raise RuntimeError("users lookup down")
        self.db.lookups.append(self.uid)
        row = USERS.get(self.uid)
        return _Result([{"id": self.uid, **row}] if row else [])


class _StaffDB:
    """``users`` reads only; any other table means the handler was reached."""

    def __init__(self):
        self.lookups: list = []
        self.touched: list = []           # non-users tables the handler read
        self.fail_active_lookup = False   # fail the 2nd (is_active) users read

    def table(self, name):
        if name != "users":
            self.touched.append(name)
            raise HTTPException(418, f"handler reached ({name})")
        return _UsersQuery(self)


class _AuthResponse:
    status_code = 200

    def __init__(self, uid):
        self._uid = uid

    def json(self):
        return {"id": self._uid, "email": f"{self._uid}@example.test", "user_metadata": {}}


class _AuthClient:
    is_closed = False

    class cookies:  # noqa: N801 — mimics httpx.AsyncClient.cookies
        @staticmethod
        def clear():
            pass

    async def get(self, _url, headers):
        return _AuthResponse(headers["Authorization"].removeprefix("Bearer "))


@pytest.fixture
def staff(live_activation_gate, monkeypatch):
    db = _StaffDB()
    monkeypatch.setattr(admin_module, "supabase_admin", db)
    monkeypatch.setattr(activation_gate, "supabase_admin", db)
    monkeypatch.setattr(instructor_module, "supabase_admin", db)
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _AuthClient())

    def _instructor_db_reached(_me):
        raise HTTPException(418, "handler reached (instructor_db)")

    monkeypatch.setattr(instructor_module, "instructor_db", _instructor_db_reached)
    api = TestClient(main.app, raise_server_exceptions=False)

    class Harness:
        users = db

        @staticmethod
        def get(path, uid):
            return api.get(path, headers={"Authorization": f"Bearer {uid}"})

    return Harness


def _guard(fn, uid):
    return asyncio.run(fn(f"Bearer {uid}"))


def _inactive(resp):
    return resp.status_code == 403 and resp.json().get("detail") == INACTIVE_DETAIL


# ── Guard functions ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("uid", ["instructor-active", "admin-active"])
def test_require_instructor_admits_active_staff(staff, uid):
    assert _guard(admin_module.require_instructor, uid)["id"] == uid


@pytest.mark.parametrize("uid", ["instructor-inactive", "admin-inactive"])
def test_require_instructor_rejects_inactive_staff(staff, uid):
    with pytest.raises(HTTPException) as ei:
        _guard(admin_module.require_instructor, uid)
    assert ei.value.status_code == 403 and ei.value.detail == INACTIVE_DETAIL


def test_require_admin_admits_active_admin(staff):
    assert _guard(admin_module.require_admin, "admin-active")["id"] == "admin-active"


def test_require_admin_rejects_inactive_admin(staff):
    with pytest.raises(HTTPException) as ei:
        _guard(admin_module.require_admin, "admin-inactive")
    assert ei.value.status_code == 403 and ei.value.detail == INACTIVE_DETAIL


@pytest.mark.parametrize("fn,uid", [
    (admin_module.require_instructor, "learner-active"),
    (admin_module.require_instructor, "learner-inactive"),
    (admin_module.require_instructor, "nobody"),
    (admin_module.require_admin, "instructor-active"),
    (admin_module.require_admin, "instructor-inactive"),
    (admin_module.require_admin, "learner-active"),
])
def test_role_denial_is_unchanged_and_precedes_activation(staff, fn, uid):
    with pytest.raises(HTTPException) as ei:
        _guard(fn, uid)
    assert ei.value.status_code == 403 and ei.value.detail != INACTIVE_DETAIL
    assert staff.users.lookups == [uid]          # role read only, no activation read


@pytest.mark.parametrize("fn,uid", [
    (admin_module.require_instructor, "instructor-active"),
    (admin_module.require_admin, "admin-active"),
])
def test_activation_lookup_failure_fails_closed(staff, fn, uid):
    staff.users.fail_active_lookup = True
    with pytest.raises(HTTPException) as ei:
        _guard(fn, uid)
    assert ei.value.status_code == 503


# ── Real routes (the staging reproduction) ──────────────────────────────────

INSTRUCTOR_READS = ["/instructor/cohorts", "/instructor/students", "/instructor/codes"]


@pytest.mark.parametrize("path", INSTRUCTOR_READS)
@pytest.mark.parametrize("uid", ["instructor-inactive", "admin-inactive"])
def test_inactive_staff_cannot_read_instructor_routes(staff, path, uid):
    resp = staff.get(path, uid)
    assert _inactive(resp), resp.text
    assert staff.users.touched == []


@pytest.mark.parametrize("path", INSTRUCTOR_READS)
@pytest.mark.parametrize("uid", ["instructor-active", "admin-active"])
def test_active_staff_still_reach_instructor_routes(staff, path, uid):
    resp = staff.get(path, uid)
    assert resp.status_code == 418, resp.text


def test_inactive_admin_cannot_impersonate_an_instructor(staff):
    resp = staff.get("/instructor/cohorts?as_instructor=instructor-active", "admin-inactive")
    assert _inactive(resp), resp.text          # stopped before the governance_audit write


def test_inactive_admin_cannot_read_admin_routes(staff):
    resp = staff.get("/admin/access-codes", "admin-inactive")
    assert _inactive(resp), resp.text
    assert staff.users.touched == []


def test_active_admin_still_reaches_admin_routes(staff):
    staff.get("/admin/access-codes", "admin-active")   # handler wraps the 418 as 500
    assert staff.users.touched == ["access_codes"]
