"""Tests for routers/cohorts.py + admin access-code extensions (Sprint 12.2).

Two surfaces under test:

  1. Cohort CRUD — POST/GET/PATCH /admin/cohorts.

  2. Access-code code_type ↔ cohort_id validation in
     routers/admin.py (Sprint 12.2 extension of the Migration 009 endpoints).
     Pins:
       - mass + cohort_id=null  → ok
       - direct + cohort_id=null → 422
       - direct + cohort_id=uuid → ok
       - staff + cohort_id=uuid  → 422 (staff codes must NOT have a cohort)
       - PATCH effective-value validation (cohort_id alone on an existing
         direct code stays valid; flipping type alone re-checks).

The fake Supabase client mirrors the in-memory pattern in
test_access_code_permissions.py — extended to support insert/update so
router writes round-trip correctly.
"""

from __future__ import annotations

from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


# ── In-memory Supabase fake (insert + select + update) ────────────────


class _Resp:
    def __init__(self, data):
        self.data = data


class _TableQuery:
    def __init__(self, fake, table_name):
        self.fake = fake
        self.table_name = table_name
        self._mode = "select"
        self._payload = None
        self._update = None
        self.filters: list[tuple[str, str, object]] = []
        self.in_filter: tuple[str, list] | None = None
        self.limit_n = None
        self._order_field = None
        self._order_desc = False

    # ── Mode setters ────────────────────────────────────────────────

    def select(self, *_args, **_kw):
        self._mode = "select"
        return self

    def insert(self, payload):
        self._mode = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._mode = "update"
        self._update = payload
        return self

    def delete(self):
        self._mode = "delete"
        return self

    # ── Filters / ordering ──────────────────────────────────────────

    def eq(self, field, value):
        self.filters.append((field, "eq", value))
        return self

    def in_(self, field, values):
        self.in_filter = (field, list(values))
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def order(self, field, desc=False):
        self._order_field = field
        self._order_desc = bool(desc)
        return self

    # ── Execute ─────────────────────────────────────────────────────

    def execute(self):
        rows = self.fake.tables.setdefault(self.table_name, [])

        if self._mode == "insert":
            new_rows = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = []
            for r in new_rows:
                row = dict(r)
                row.setdefault("id", str(uuid4()))
                rows.append(row)
                inserted.append(row)
            return _Resp(inserted)

        # select / update / delete all start from filtered set
        matched = [r for r in rows if self._matches(r)]

        if self._mode == "update":
            for r in matched:
                r.update(self._update or {})
            return _Resp(matched)

        if self._mode == "delete":
            for r in matched:
                rows.remove(r)
            return _Resp(matched)

        # select
        if self._order_field:
            matched = sorted(
                matched,
                key=lambda r: r.get(self._order_field) or "",
                reverse=self._order_desc,
            )
        if self.limit_n is not None:
            matched = matched[: self.limit_n]
        return _Resp(matched)

    def _matches(self, row):
        for field, _op, value in self.filters:
            if row.get(field) != value:
                return False
        if self.in_filter:
            field, values = self.in_filter
            if row.get(field) not in values:
                return False
        return True


class _FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {
            "cohorts": [],
            "access_codes": [],
            "user_code_assignments": [],
            "users": [],
        }

    def table(self, name: str):
        return _TableQuery(self, name)


# ── Test client fixtures ──────────────────────────────────────────────


_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}


@pytest.fixture
def fake_db(monkeypatch):
    fake = _FakeSupabase()
    # Patch where the router modules look it up.
    monkeypatch.setattr("routers.admin.supabase_admin", fake)
    monkeypatch.setattr("routers.cohorts.supabase_admin", fake)
    return fake


@pytest.fixture
def client(fake_db):
    from main import app
    with patch("routers.cohorts.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin.require_admin",   new=AsyncMock(return_value=_ADMIN_USER)):
        with TestClient(app) as c:
            yield c


# ── Cohort CRUD ───────────────────────────────────────────────────────


class TestCohortCreate:
    def test_create_minimal(self, client, fake_db):
        r = client.post(
            "/admin/cohorts",
            json={"name": "Lớp Tháng 5"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200, r.text
        row = r.json()
        assert row["name"] == "Lớp Tháng 5"
        assert row["is_active"] is True
        assert row["created_by"] == _ADMIN_USER["id"]
        assert fake_db.tables["cohorts"][0]["name"] == "Lớp Tháng 5"

    def test_create_with_prefix_and_description(self, client, fake_db):
        r = client.post(
            "/admin/cohorts",
            json={
                "name": "Lớp Trực Tiếp 2026",
                "code_prefix": "DT26",
                "description": "Học viên 1-1",
            },
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200
        row = r.json()
        assert row["code_prefix"] == "DT26"
        assert row["description"] == "Học viên 1-1"

    def test_create_rejects_empty_name(self, client):
        r = client.post("/admin/cohorts", json={"name": ""}, headers=_ADMIN_AUTH)
        assert r.status_code == 422


class TestCohortList:
    def test_list_returns_active_by_default_when_filter_passed(self, client, fake_db):
        fake_db.tables["cohorts"] = [
            {"id": "c1", "name": "A", "is_active": True,  "created_at": "2026-01-01T00:00:00Z"},
            {"id": "c2", "name": "B", "is_active": False, "created_at": "2026-01-02T00:00:00Z"},
        ]
        r = client.get("/admin/cohorts?is_active=true", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        names = [c["name"] for c in r.json()["cohorts"]]
        assert names == ["A"]

    def test_list_returns_archived_when_requested(self, client, fake_db):
        fake_db.tables["cohorts"] = [
            {"id": "c1", "name": "A", "is_active": True,  "created_at": "2026-01-01T00:00:00Z"},
            {"id": "c2", "name": "B", "is_active": False, "created_at": "2026-01-02T00:00:00Z"},
        ]
        r = client.get("/admin/cohorts?is_active=false", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        names = [c["name"] for c in r.json()["cohorts"]]
        assert names == ["B"]

    def test_list_returns_all_when_filter_omitted(self, client, fake_db):
        fake_db.tables["cohorts"] = [
            {"id": "c1", "name": "A", "is_active": True,  "created_at": "2026-01-01T00:00:00Z"},
            {"id": "c2", "name": "B", "is_active": False, "created_at": "2026-01-02T00:00:00Z"},
        ]
        r = client.get("/admin/cohorts", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        assert len(r.json()["cohorts"]) == 2


class TestCohortPatch:
    def test_archive_cohort(self, client, fake_db):
        fake_db.tables["cohorts"] = [
            {"id": "c1", "name": "A", "is_active": True, "created_at": "x"}
        ]
        r = client.patch(
            "/admin/cohorts/c1",
            json={"is_active": False},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200
        assert r.json()["is_active"] is False
        assert fake_db.tables["cohorts"][0]["is_active"] is False

    def test_patch_404_unknown(self, client):
        r = client.patch("/admin/cohorts/nope", json={"name": "X"}, headers=_ADMIN_AUTH)
        assert r.status_code == 404

    def test_patch_rejects_empty_body(self, client, fake_db):
        fake_db.tables["cohorts"] = [{"id": "c1", "name": "A", "is_active": True}]
        r = client.patch("/admin/cohorts/c1", json={}, headers=_ADMIN_AUTH)
        assert r.status_code == 400


# ── Access-code code_type ↔ cohort_id validation ──────────────────────


class TestAccessCodeCodeTypeValidation:
    def test_generate_mass_code_ok(self, client, fake_db):
        r = client.post(
            "/admin/access-codes/generate",
            json={"count": 2, "permissions": ["all"], "code_type": "mass"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["created"] == 2
        for row in fake_db.tables["access_codes"]:
            assert row["code_type"] == "mass"
            assert "cohort_id" not in row

    def test_generate_direct_without_cohort_rejected(self, client):
        r = client.post(
            "/admin/access-codes/generate",
            json={"count": 1, "permissions": ["writing"], "code_type": "direct"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 422
        assert "direct" in r.text

    def test_generate_direct_with_cohort_ok(self, client, fake_db):
        fake_db.tables["cohorts"] = [{"id": "c1", "name": "Direct A"}]
        r = client.post(
            "/admin/access-codes/generate",
            json={
                "count": 1,
                "permissions": ["writing"],
                "code_type": "direct",
                "cohort_id": "c1",
            },
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200, r.text
        assert fake_db.tables["access_codes"][0]["code_type"] == "direct"
        assert fake_db.tables["access_codes"][0]["cohort_id"] == "c1"

    def test_generate_staff_with_cohort_rejected(self, client):
        r = client.post(
            "/admin/access-codes/generate",
            json={
                "count": 1,
                "permissions": ["all"],
                "code_type": "staff",
                "cohort_id": "c1",
            },
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 422
        assert "không được gắn cohort_id" in r.text

    def test_generate_staff_without_cohort_ok(self, client, fake_db):
        r = client.post(
            "/admin/access-codes/generate",
            json={"count": 1, "permissions": ["all"], "code_type": "staff"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200, r.text
        assert fake_db.tables["access_codes"][0]["code_type"] == "staff"

    def test_generate_unknown_code_type_rejected(self, client):
        r = client.post(
            "/admin/access-codes/generate",
            json={"count": 1, "permissions": ["all"], "code_type": "weird"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 422


class TestAccessCodePatchTypeValidation:
    def test_patch_flip_to_direct_without_cohort_rejected(self, client, fake_db):
        fake_db.tables["access_codes"] = [
            {"id": "ac1", "code": "AAAA-BBBB", "code_type": "mass", "cohort_id": None}
        ]
        r = client.patch(
            "/admin/access-codes/ac1",
            json={"code_type": "direct"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 422

    def test_patch_flip_to_direct_with_cohort_ok(self, client, fake_db):
        fake_db.tables["access_codes"] = [
            {"id": "ac1", "code": "AAAA-BBBB", "code_type": "mass", "cohort_id": None}
        ]
        r = client.patch(
            "/admin/access-codes/ac1",
            json={"code_type": "direct", "cohort_id": "c1"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200, r.text
        assert fake_db.tables["access_codes"][0]["code_type"] == "direct"
        assert fake_db.tables["access_codes"][0]["cohort_id"] == "c1"

    def test_patch_notes_only_no_type_revalidation(self, client, fake_db):
        # Patching `notes` alone shouldn't trigger the type↔cohort guard
        # (the existing row stays self-consistent).
        fake_db.tables["access_codes"] = [
            {"id": "ac1", "code": "AAAA-BBBB", "code_type": "direct", "cohort_id": "c1"}
        ]
        r = client.patch(
            "/admin/access-codes/ac1",
            json={"notes": "Lớp 2026.05"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200, r.text
        assert fake_db.tables["access_codes"][0]["notes"] == "Lớp 2026.05"


class TestAccessCodeListEnrichment:
    def test_list_returns_cohort_name_for_direct_codes(self, client, fake_db):
        fake_db.tables["cohorts"] = [{"id": "c1", "name": "Direct A"}]
        fake_db.tables["access_codes"] = [
            {
                "id": "ac1", "code": "AAAA-BBBB",
                "is_used": False, "is_revoked": False, "is_active": True,
                "used_by": None, "used_at": None,
                "created_at": "2026-01-01T00:00:00Z",
                "permissions": ["writing"], "session_limit": None, "expires_at": None,
                "code_type": "direct", "cohort_id": "c1", "notes": None,
            },
            {
                "id": "ac2", "code": "CCCC-DDDD",
                "is_used": False, "is_revoked": False, "is_active": True,
                "used_by": None, "used_at": None,
                "created_at": "2026-01-02T00:00:00Z",
                "permissions": ["all"], "session_limit": None, "expires_at": None,
                "code_type": "mass", "cohort_id": None, "notes": None,
            },
        ]
        r = client.get("/admin/access-codes", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        codes = r.json()
        by_id = {c["id"]: c for c in codes}
        assert by_id["ac1"]["cohort_name"] == "Direct A"
        assert by_id["ac2"]["cohort_name"] is None


# ── Pure helper unit ──────────────────────────────────────────────────


class TestCodeTypeComboHelper:
    def test_mass_with_null_cohort_passes(self):
        from routers.admin import _validate_code_type_combo
        _validate_code_type_combo("mass", None)  # should not raise

    def test_direct_with_uuid_cohort_passes(self):
        from routers.admin import _validate_code_type_combo
        _validate_code_type_combo("direct", "c1")

    def test_direct_without_cohort_raises_422(self):
        from fastapi import HTTPException
        from routers.admin import _validate_code_type_combo
        with pytest.raises(HTTPException) as exc:
            _validate_code_type_combo("direct", None)
        assert exc.value.status_code == 422

    def test_staff_with_cohort_raises_422(self):
        from fastapi import HTTPException
        from routers.admin import _validate_code_type_combo
        with pytest.raises(HTTPException) as exc:
            _validate_code_type_combo("staff", "c1")
        assert exc.value.status_code == 422

    def test_unknown_type_raises_422(self):
        from fastapi import HTTPException
        from routers.admin import _validate_code_type_combo
        with pytest.raises(HTTPException) as exc:
            _validate_code_type_combo("invalid", None)
        assert exc.value.status_code == 422
