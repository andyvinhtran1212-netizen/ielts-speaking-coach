"""Admin retake-assignment endpoints (PR A, 2026-07-12).

POST/GET/DELETE /admin/mock-exams/{exam_id}/assignments — auth gate + that the
router forwards to mock_exam_assignment_service with the admin id + skills."""
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_AUTH = {"Authorization": "Bearer faketoken"}
_ADMIN = {"id": "admin-1"}
_EXAM = "exam-1"


def test_assignments_require_auth():
    assert _client().get(f"/admin/mock-exams/{_EXAM}/assignments").status_code == 401
    assert _client().post(f"/admin/mock-exams/{_EXAM}/assignments", json={}).status_code == 401
    assert _client().delete(f"/admin/mock-exams/{_EXAM}/assignments/s1").status_code == 401


def test_create_assignments_forwards_rows_and_admin():
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.assign_svc.assign",
               return_value={"group_id": "g1", "assigned": ["u1"], "skipped": []}) as mock_assign:
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/assignments",
            json={"source_exam_id": "src", "assignments": [
                {"user_id": "u1", "skills": ["writing"], "open_from": None, "open_until": None},
            ]},
            headers=_AUTH,
        )
    assert r.status_code == 200, r.text
    assert r.json()["assigned"] == ["u1"]
    args, kwargs = mock_assign.call_args
    assert args[0] == _EXAM
    assert args[1][0]["user_id"] == "u1"
    assert args[1][0]["skills"] == ["writing"]
    assert kwargs["created_by"] == "admin-1"
    assert kwargs["source_exam_id"] == "src"


def test_delete_assignment_forwards():
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.assign_svc.remove") as mock_remove:
        r = _client().delete(f"/admin/mock-exams/{_EXAM}/assignments/u1", headers=_AUTH)
    assert r.status_code == 200, r.text
    mock_remove.assert_called_once_with(_EXAM, "u1")
