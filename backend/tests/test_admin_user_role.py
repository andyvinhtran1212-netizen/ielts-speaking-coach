"""Tests for Sprint 12.8 — PATCH /admin/users/{user_id}/role.

Pins:
  - Role values constrained to {admin, instructor, student}
  - Self-demotion blocked (admin can't drop themselves from the admin role)
  - 404 when target user doesn't exist
  - Admin auth gate (handled via require_admin mock)
  - ADMINAAL2-0032 FR-019 (migration 336): a suspended account's role change
    is refused by the database; the route answers 409 with a Vietnamese
    message, and the same change works after reactivation
"""

from __future__ import annotations

from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError


class _Resp:
    def __init__(self, data):
        self.data = data


class _TableQuery:
    def __init__(self, fake, table_name):
        self.fake = fake
        self.table_name = table_name
        self._mode = "select"
        self._update = None
        self.filters: list[tuple[str, object]] = []

    def select(self, *_args, **_kw):
        self._mode = "select"
        return self

    def update(self, payload):
        self._mode = "update"
        self._update = payload
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def order(self, *_args, **_kw):
        return self

    def execute(self):
        rows = self.fake.tables.setdefault(self.table_name, [])
        matched = [r for r in rows if all(r.get(f) == v for f, v in self.filters)]
        if self._mode == "update":
            for r in matched:
                # Migration 336's trigger, as PostgREST reports it.
                if (r.get("suspended_at") and "role" in (self._update or {})
                        and self._update["role"] != r.get("role")):
                    raise APIError({"code": "P0001", "message": self.fake.role_guard_message,
                                    "details": r["id"], "hint": None})
            for r in matched:
                r.update(self._update or {})
            return _Resp(matched)
        return _Resp(matched)


class _Rpc:
    def __init__(self, fn):
        self._fn = fn

    def execute(self):
        return _Resp(self._fn())


class _FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {"users": []}
        self.role_guard_message = "account_suspended_role_change"
        self.rpc_calls: list[dict] = []

    def table(self, name):
        return _TableQuery(self, name)

    def rpc(self, name, params):
        # ADMINAAL2-0032 FR-007: the role route delegates to migration 332's
        # fn_set_staff_privilege. This stand-in keeps the role-only path the
        # route uses: target lookup, no-op, and migration 336's role freeze.
        assert name == "fn_set_staff_privilege"
        self.rpc_calls.append(params)

        def run():
            def fail(message):
                raise APIError({"code": "P0001", "message": message, "details": None, "hint": None})

            if params["p_actor"] == params["p_target"]:
                fail("self_change_forbidden")
            target = next((r for r in self.tables["users"] if r["id"] == params["p_target"]), None)
            if target is None:
                fail("target_not_found")
            before = {"role": target.get("role"), "is_active": target.get("is_active"),
                      "suspended_at": target.get("suspended_at")}
            if params["p_role"] == target.get("role"):
                return [{"changed": False, "audit_id": None, "before": before, "after": before}]
            if target.get("suspended_at"):
                fail(self.role_guard_message)
            target["role"] = params["p_role"]
            return [{"changed": True, "audit_id": str(uuid4()), "before": before,
                     "after": {**before, "role": params["p_role"]}}]

        return _Rpc(run)


_ADMIN_ID   = "00000000-0000-0000-0000-00000000aaaa"
_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}


@pytest.fixture
def fake_db(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr("routers.admin.supabase_admin", fake)
    return fake


@pytest.fixture
def revoked(monkeypatch):
    """Session revocation stand-in (it runs on the direct DB connection)."""
    from services import staff_security

    calls: list[dict] = []

    async def fake_revoke(user_id, *, ban, engine, auth_admin):
        calls.append({"user_id": user_id, "ban": ban})
        return staff_security.RevokeOutcome(True, None, ban)

    monkeypatch.setattr(staff_security, "revoke_sessions", fake_revoke)
    return calls


@pytest.fixture
def client(fake_db, revoked):
    from main import app
    with patch(
        "routers.admin.require_admin",
        new=AsyncMock(return_value={"id": _ADMIN_ID, "email": "admin@x"}),
    ):
        with TestClient(app) as c:
            yield c


def _seed_user(fake_db, role="student", uid=None):
    user = {"id": uid or str(uuid4()), "email": f"{role}@x", "role": role}
    fake_db.tables["users"].append(user)
    return user


class TestRoleChange:
    def test_promote_student_to_instructor(self, client, fake_db):
        u = _seed_user(fake_db, role="student")
        r = client.patch(
            f"/admin/users/{u['id']}/role",
            json={"role": "instructor"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["role"] == "instructor"
        assert fake_db.tables["users"][0]["role"] == "instructor"

    def test_demote_admin_other_user(self, client, fake_db):
        u = _seed_user(fake_db, role="admin")
        r = client.patch(
            f"/admin/users/{u['id']}/role",
            json={"role": "student"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200
        assert fake_db.tables["users"][0]["role"] == "student"

    def test_self_demotion_blocked(self, client, fake_db):
        # Admin tries to demote themselves — must be rejected with 400.
        _seed_user(fake_db, role="admin", uid=_ADMIN_ID)
        r = client.patch(
            f"/admin/users/{_ADMIN_ID}/role",
            json={"role": "student"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 400
        # Row unchanged.
        assert fake_db.tables["users"][0]["role"] == "admin"

    def test_self_keep_admin_role_passes(self, client, fake_db):
        # Self-update that keeps admin role is harmless and must succeed.
        _seed_user(fake_db, role="admin", uid=_ADMIN_ID)
        r = client.patch(
            f"/admin/users/{_ADMIN_ID}/role",
            json={"role": "admin"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200

    def test_invalid_role_rejected_400(self, client, fake_db):
        u = _seed_user(fake_db, role="student")
        r = client.patch(
            f"/admin/users/{u['id']}/role",
            json={"role": "superuser"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 400
        assert fake_db.tables["users"][0]["role"] == "student"

    def test_missing_user_returns_404(self, client):
        r = client.patch(
            f"/admin/users/{uuid4()}/role",
            json={"role": "student"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 404

    def test_role_normalized_to_lowercase(self, client, fake_db):
        # ADMIN / Admin / admin all hit the same allow-list.
        u = _seed_user(fake_db, role="student")
        r = client.patch(
            f"/admin/users/{u['id']}/role",
            json={"role": "ADMIN"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200
        assert fake_db.tables["users"][0]["role"] == "admin"


class TestSuspendedAccountRoleChange:
    """FR-019: reactivate first, then change the role."""

    MESSAGE = ("Không thể đổi vai trò của tài khoản đang bị tạm khóa. "
               "Hãy mở khóa tài khoản trước, rồi đổi vai trò.")

    def _suspended(self, fake_db, role="instructor"):
        user = _seed_user(fake_db, role=role)
        user.update({"is_active": False, "suspended_at": "2026-10-28T11:00:00+00:00"})
        return user

    @pytest.mark.parametrize("target_role,new_role", [
        ("instructor", "student"), ("instructor", "admin"), ("admin", "instructor")])
    def test_role_change_of_a_suspended_account_is_409_and_changes_nothing(
            self, client, fake_db, target_role, new_role):
        u = self._suspended(fake_db, target_role)
        r = client.patch(f"/admin/users/{u['id']}/role", json={"role": new_role}, headers=_ADMIN_AUTH)
        assert r.status_code == 409, r.text
        assert r.json()["detail"] == {"code": "account_suspended_role_change", "message": self.MESSAGE}
        assert fake_db.tables["users"][0]["role"] == target_role

    def test_same_role_on_a_suspended_account_is_not_a_change(self, client, fake_db):
        u = self._suspended(fake_db)
        r = client.patch(f"/admin/users/{u['id']}/role", json={"role": "instructor"}, headers=_ADMIN_AUTH)
        assert r.status_code == 200, r.text

    def test_role_change_works_after_reactivation(self, client, fake_db):
        u = self._suspended(fake_db)
        first = client.patch(f"/admin/users/{u['id']}/role", json={"role": "student"}, headers=_ADMIN_AUTH)
        assert first.status_code == 409
        u.update({"is_active": True, "suspended_at": None})   # PATCH …/active (FR-006)
        r = client.patch(f"/admin/users/{u['id']}/role", json={"role": "student"}, headers=_ADMIN_AUTH)
        assert r.status_code == 200, r.text
        body = r.json()
        # FR-007 keeps these fields and adds changed / audit_id / sessions_revoked.
        assert {k: body[k] for k in ("ok", "id", "role")} == {"ok": True, "id": u["id"], "role": "student"}
        assert body["changed"] is True and body["sessions_revoked"] is True
        assert fake_db.tables["users"][0]["role"] == "student"

    def test_any_other_database_error_stays_a_500(self, client, fake_db):
        u = self._suspended(fake_db)
        fake_db.role_guard_message = "account_suspended"
        r = client.patch(f"/admin/users/{u['id']}/role", json={"role": "student"}, headers=_ADMIN_AUTH)
        assert r.status_code == 500
        assert fake_db.tables["users"][0]["role"] == "instructor"


class TestUnassignedCodesPool:
    """GET /admin/access-codes/pool — the 'ready to assign' pool. Declared
    before /access-codes/{code_id} so 'pool' isn't parsed as a code_id."""

    def test_pool_returns_only_unused_unrevoked_codes(self, client, fake_db):
        fake_db.tables["access_codes"] = [
            {"id": "c1", "code": "FREE-1",  "is_used": False, "is_revoked": False, "code_type": "mass"},
            {"id": "c2", "code": "USED-1",  "is_used": True,  "is_revoked": False, "code_type": "mass"},
            {"id": "c3", "code": "REVK-1",  "is_used": False, "is_revoked": True,  "code_type": "mass"},
        ]
        r = client.get("/admin/access-codes/pool", headers=_ADMIN_AUTH)
        assert r.status_code == 200, r.text   # NOT 422 (route ordering correct)
        codes = {row["code"] for row in r.json()}
        assert codes == {"FREE-1"}            # used + revoked excluded
