"""Tests for /admin/students/* endpoints (Sprint W2 Phase 1).

Covers three layers:
  1. Auth gate — no/invalid Bearer → 401, never reaches handler body.
  2. Pydantic body validation — required fields + numeric bounds.
  3. Happy-path handler logic — handler wiring with require_admin and
     student_service stubbed out so we exercise the request/response shape
     without touching Supabase.

W0 already pinned the "no auth header → 401" cases for create + list +
detail in test_admin_writing_routers.py; we keep one cross-check here for
the import endpoint and add new gate cases for PATCH/DELETE.
"""

from __future__ import annotations

from io import BytesIO
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_STUDENT_ROW = {
    "id": "00000000-0000-0000-0000-000000000001",
    "student_code": "S001",
    "full_name": "Nguyễn Văn A",
    "target_band": 7.0,
    "target_date": None,
    "persona_notes": None,
    "current_band_estimate": None,
    "created_at": "2026-05-01T00:00:00Z",
    "created_by": _ADMIN_USER["id"],
}


# ── Auth gate (extends W0 coverage) ──────────────────────────────────

def test_students_import_requires_auth_header():
    """File-upload endpoints validate body shape before handler runs, so we
    send a dummy file to reach the auth gate. Goal: confirm no auth → 401."""
    r = _client().post(
        "/admin/students/import",
        files={"file": ("x.csv", BytesIO(b"student_code,full_name\n"), "text/csv")},
    )
    assert r.status_code == 401


def test_students_patch_requires_auth_header():
    r = _client().patch(
        "/admin/students/00000000-0000-0000-0000-000000000000",
        json={"full_name": "x"},
    )
    assert r.status_code == 401


def test_students_delete_requires_auth_header():
    r = _client().delete("/admin/students/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 401


# ── Pydantic body validation (auth bypassed, so 422 = Pydantic) ──────

def test_create_rejects_missing_required_fields():
    """Empty body → 422 from Pydantic, before handler runs."""
    with patch("routers.admin_students.require_admin", new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/students", json={}, headers=_ADMIN_AUTH)
    assert r.status_code == 422


def test_create_rejects_target_band_out_of_range():
    with patch("routers.admin_students.require_admin", new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post(
            "/admin/students",
            json={"student_code": "S1", "full_name": "A", "target_band": 12.0},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 422


def test_create_rejects_blank_student_code():
    with patch("routers.admin_students.require_admin", new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post(
            "/admin/students",
            json={"student_code": "", "full_name": "A"},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 422


# ── Happy-path handler wiring (service mocked) ───────────────────────

def test_create_student_happy_path():
    with patch("routers.admin_students.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_students.student_service.create_student",
               return_value=_STUDENT_ROW) as mock_create:
        r = _client().post(
            "/admin/students",
            json={"student_code": "S001", "full_name": "Nguyễn Văn A", "target_band": 7.0},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 201, r.text
    assert r.json()["student_code"] == "S001"
    # admin_id propagated from require_admin's return dict
    kwargs = mock_create.call_args.kwargs
    assert kwargs["admin_id"] == _ADMIN_USER["id"]
    assert kwargs["data"]["student_code"] == "S001"
    assert kwargs["data"]["target_band"] == 7.0
    # exclude_none drops fields not provided
    assert "persona_notes" not in kwargs["data"]


def test_list_students_passes_query_params():
    with patch("routers.admin_students.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_students.student_service.list_students",
               return_value=[_STUDENT_ROW]) as mock_list:
        r = _client().get(
            "/admin/students?search=nguyen&limit=10&offset=20",
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200
    assert mock_list.call_args.kwargs == {"search": "nguyen", "limit": 10, "offset": 20}
    assert r.json() == [_STUDENT_ROW]


def test_list_students_rejects_oversized_limit():
    """limit > 200 → 422 from Query bounds."""
    with patch("routers.admin_students.require_admin", new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().get("/admin/students?limit=500", headers=_ADMIN_AUTH)
    assert r.status_code == 422


def test_get_student_returns_history():
    detail = {**_STUDENT_ROW, "essay_history": []}
    with patch("routers.admin_students.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_students.student_service.get_student_with_history",
               return_value=detail):
        r = _client().get(
            f"/admin/students/{_STUDENT_ROW['id']}",
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200
    assert r.json()["essay_history"] == []


def test_update_student_strips_none_fields():
    with patch("routers.admin_students.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_students.student_service.update_student",
               return_value=_STUDENT_ROW) as mock_update:
        r = _client().patch(
            f"/admin/students/{_STUDENT_ROW['id']}",
            json={"full_name": "New Name", "target_band": None},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200
    kwargs = mock_update.call_args.kwargs
    assert kwargs["student_id"] == _STUDENT_ROW["id"]
    assert kwargs["data"] == {"full_name": "New Name"}  # None stripped


def test_delete_student_returns_204():
    with patch("routers.admin_students.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_students.student_service.delete_student",
               return_value=None) as mock_del:
        r = _client().delete(
            f"/admin/students/{_STUDENT_ROW['id']}",
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 204
    mock_del.assert_called_once_with(_STUDENT_ROW["id"])


def test_import_csv_happy_path():
    csv_bytes = b"student_code,full_name\nS010,Test Student\n"
    with patch("routers.admin_students.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_students.student_service.bulk_import_students",
               return_value={"imported": 1, "errors": []}) as mock_bulk:
        r = _client().post(
            "/admin/students/import",
            files={"file": ("students.csv", BytesIO(csv_bytes), "text/csv")},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200, r.text
    assert r.json() == {"imported": 1, "errors": []}
    kwargs = mock_bulk.call_args.kwargs
    assert kwargs["admin_id"] == _ADMIN_USER["id"]
    assert "student_code,full_name" in kwargs["csv_content"]


def test_import_csv_rejects_non_utf8():
    """Latin-1-only bytes → 400 from decode guard."""
    bad_bytes = b"student_code,full_name\nS010,T\xe9st\n"  # 0xe9 invalid utf-8 mid-byte
    with patch("routers.admin_students.require_admin", new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post(
            "/admin/students/import",
            files={"file": ("students.csv", BytesIO(bad_bytes), "text/csv")},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 400
    assert "UTF-8" in r.json()["detail"]
