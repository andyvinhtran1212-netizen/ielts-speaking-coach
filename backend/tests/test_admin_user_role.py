"""Tests for Sprint 12.8 — PATCH /admin/users/{user_id}/role.

Pins:
  - Role values constrained to {admin, instructor, student}
  - Self-demotion blocked (admin can't drop themselves from the admin role)
  - 404 when target user doesn't exist
  - Admin auth gate (handled via require_admin mock)
"""

from __future__ import annotations

from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


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

    def execute(self):
        rows = self.fake.tables.setdefault(self.table_name, [])
        matched = [r for r in rows if all(r.get(f) == v for f, v in self.filters)]
        if self._mode == "update":
            for r in matched:
                r.update(self._update or {})
            return _Resp(matched)
        return _Resp(matched)


class _FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {"users": []}

    def table(self, name):
        return _TableQuery(self, name)


_ADMIN_ID   = "00000000-0000-0000-0000-00000000aaaa"
_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}


@pytest.fixture
def fake_db(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr("routers.admin.supabase_admin", fake)
    return fake


@pytest.fixture
def client(fake_db):
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
