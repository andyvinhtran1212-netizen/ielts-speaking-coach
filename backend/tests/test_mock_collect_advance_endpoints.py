"""POST /admin/mock-exams/{id}/collect and /advance — the stale-screen guard.

Both actions are irreversible for a whole class, and both are reachable from a
console that polls every 5s: the section can change under the admin between the
render and the click. So both carry the section the admin's screen was SHOWING,
and the server refuses when it disagrees with the canonical one.

The guard is worthless if the parameter can simply be omitted — the service
then falls back to reading the canonical active_section, which is exactly the
value the guard exists to distrust. These pin that it cannot be (Codex review,
PRs #842 and #843).
"""
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_AUTH = {"Authorization": "Bearer faketoken"}
_ADMIN = {"id": "admin-1"}
_EXAM = "exam-1"


def test_collect_requires_from_section():
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.collect_section") as mock_collect:
        r = _client().post(f"/admin/mock-exams/{_EXAM}/collect", headers=_AUTH)
    assert r.status_code == 422, r.text
    mock_collect.assert_not_called()


def test_collect_rejects_a_section_name_that_cannot_be_collected():
    # 'not_started' and 'done' are not papers; accepting them would let a
    # malformed screen state reach the service as a real request.
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.collect_section") as mock_collect:
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/collect?from_section=not_started", headers=_AUTH)
    assert r.status_code == 422, r.text
    mock_collect.assert_not_called()


def test_collect_forwards_the_screen_section():
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.collect_section",
               return_value={"section": "listening", "collected": 3}) as mock_collect:
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/collect?from_section=listening", headers=_AUTH)
    assert r.status_code == 200, r.text
    assert r.json() == {"section": "listening", "collected": 3}
    mock_collect.assert_called_once_with(_EXAM, "admin-1", "listening")


def test_collect_maps_a_stale_screen_to_409():
    from services.mock_exam_service import SittingConflictError
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.collect_section",
               side_effect=SittingConflictError("đã chuyển phần")):
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/collect?from_section=listening", headers=_AUTH)
    assert r.status_code == 409, r.text


def test_collect_maps_a_lookup_failure_to_503_not_a_success():
    """A failed lookup is "we don't know", not "0 bài đã thu"."""
    from services.mock_exam_service import MockExamError
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.collect_section",
               side_effect=MockExamError("không đọc được")):
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/collect?from_section=listening", headers=_AUTH)
    assert r.status_code == 503, r.text


def test_advance_requires_from_section_in_the_body():
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.advance_section") as mock_adv:
        r = _client().post(f"/admin/mock-exams/{_EXAM}/advance", json={}, headers=_AUTH)
    assert r.status_code == 422, r.text
    mock_adv.assert_not_called()


def test_advance_forwards_the_screen_section():
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.advance_section",
               return_value={"active_section": "reading"}) as mock_adv:
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/advance",
            json={"from_section": "listening"}, headers=_AUTH)
    assert r.status_code == 200, r.text
    mock_adv.assert_called_once_with(_EXAM, "admin-1", "listening")
