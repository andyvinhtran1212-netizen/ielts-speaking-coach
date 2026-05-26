"""Sprint 18.1 — "Convert thành học viên" path.

`POST /admin/students` now accepts an optional `user_id` that links the new
roster row to an EXISTING auth user directly (instead of waiting for
activation). create_student gains a one-student-per-user guard: re-converting
the same user returns 409. supabase_admin is mocked — no DB IO.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from routers.admin_students import CreateStudentRequest
from services import student_service


_ADMIN_ID = "00000000-0000-0000-0000-00000000aaaa"
_USER_ID = "11111111-1111-1111-1111-111111111111"


def _stub(precheck_data: list | None = None, insert_data: list | None = None) -> MagicMock:
    """Mimic supabase_admin.table(...) supporting BOTH the user_id pre-check
    (.select.eq.limit.execute) and the insert (.insert.execute) chains."""
    table = MagicMock()

    limit = MagicMock()
    limit.execute.return_value = MagicMock(data=precheck_data or [])
    eq = MagicMock(); eq.limit.return_value = limit
    sel = MagicMock(); sel.eq.return_value = eq
    table.select.return_value = sel

    insert = MagicMock()
    insert.execute.return_value = MagicMock(data=insert_data or [])
    table.insert.return_value = insert

    return MagicMock(return_value=table)


# ── Request model ────────────────────────────────────────────────────

def test_request_model_accepts_optional_user_id():
    body = CreateStudentRequest(student_code="S100", full_name="Nguyen A", user_id=_USER_ID)
    assert body.user_id == _USER_ID
    # Omitting it stays the legacy (activation-driven) behaviour.
    assert CreateStudentRequest(student_code="S100", full_name="A").user_id is None


# ── create_student convert path ──────────────────────────────────────

def test_convert_inserts_row_with_user_id():
    inserted = {"id": "x", "student_code": "S100", "full_name": "A", "user_id": _USER_ID}
    fake = MagicMock(table=_stub(precheck_data=[], insert_data=[inserted]))
    with patch.object(student_service, "supabase_admin", fake):
        row = student_service.create_student(
            data={"student_code": "S100", "full_name": "A", "user_id": _USER_ID},
            admin_id=_ADMIN_ID,
        )
    assert row == inserted
    # The pre-check filtered on the user_id, and the insert carried it through.
    table = fake.table.return_value
    table.select.assert_called_once()
    payload = table.insert.call_args.args[0]
    assert payload["user_id"] == _USER_ID
    assert payload["created_by"] == _ADMIN_ID


def test_convert_rejects_when_user_already_student():
    existing = [{"id": "old", "student_code": "S001", "full_name": "Existing"}]
    fake = MagicMock(table=_stub(precheck_data=existing))
    with patch.object(student_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as exc:
            student_service.create_student(
                data={"student_code": "S100", "full_name": "A", "user_id": _USER_ID},
                admin_id=_ADMIN_ID,
            )
    assert exc.value.status_code == 409
    # Insert must NOT have fired on the duplicate-user path.
    fake.table.return_value.insert.assert_not_called()
    detail = exc.value.detail
    assert isinstance(detail, dict) and detail["student"]["id"] == "old"
