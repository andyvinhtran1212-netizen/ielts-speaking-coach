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
         patch("routers.admin_mock_exams.svc.collect_preflight") as mock_pre:
        r = _client().post(f"/admin/mock-exams/{_EXAM}/collect", headers=_AUTH)
    assert r.status_code == 422, r.text
    mock_pre.assert_not_called()


def test_collect_rejects_a_section_name_that_cannot_be_collected():
    # 'not_started' and 'done' are not papers; accepting them would let a
    # malformed screen state reach the service as a real request.
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.collect_preflight") as mock_pre:
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/collect?from_section=not_started", headers=_AUTH)
    assert r.status_code == 422, r.text
    mock_pre.assert_not_called()


def test_collect_forwards_the_screen_section_and_queues_the_sweep():
    """The validation is SYNCHRONOUS (so a rejected request is a real error,
    not a silent 202); only the per-sitting sweep is queued."""
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.collect_preflight",
               return_value={"section": "listening", "pending": 3}) as mock_pre, \
         patch("routers.admin_mock_exams.svc.mark_section_collected", return_value=True) as mock_mark, \
         patch("routers.admin_mock_exams.svc.collect_section_after_flush_grace") as mock_sweep:
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/collect?from_section=listening", headers=_AUTH)
    assert r.status_code == 202, r.text
    mock_sweep.assert_called_once_with(_EXAM, "admin-1", "listening")
    assert r.json() == {"section": "listening", "pending": 3, "queued": True}
    mock_pre.assert_called_once_with(_EXAM, None, "listening")
    # admissions close from the moment the request is ACCEPTED, not from
    # whenever the queued sweep happens to run
    mock_mark.assert_called_once_with(_EXAM, "listening")


def test_collect_does_not_queue_when_advance_wins_the_marker_race():
    """Preflight is only a read. If advance commits before the marker update,
    collect must return a conflict instead of sweeping the old section."""
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.collect_preflight",
               return_value={"section": "listening", "pending": 3}), \
         patch("routers.admin_mock_exams.svc.mark_section_collected", return_value=False), \
         patch("routers.admin_mock_exams.svc.collect_section_after_flush_grace") as mock_sweep:
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/collect?from_section=listening", headers=_AUTH)
    assert r.status_code == 409, r.text
    mock_sweep.assert_not_called()


def test_advance_maps_collection_coordination_failure_to_409():
    from services.mock_exam_service import SittingConflictError
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.advance_section",
               side_effect=SittingConflictError("đang thu bài")):
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/advance",
            json={"from_section": "listening"}, headers=_AUTH)
    assert r.status_code == 409, r.text


def test_collect_maps_a_stale_screen_to_409():
    from services.mock_exam_service import SittingConflictError
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.collect_preflight",
               side_effect=SittingConflictError("đã chuyển phần")), \
         patch("routers.admin_mock_exams.svc.mark_section_collected") as mock_mark:
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/collect?from_section=listening", headers=_AUTH)
    assert r.status_code == 409, r.text
    mock_mark.assert_not_called()


def test_collect_maps_a_lookup_failure_to_503_not_a_success():
    """A failed pending-count lookup is "we don't know", not "0 bài đã thu".

    The count runs synchronously in the preflight precisely so a dead database
    is a real error here rather than a 202 followed by a background sweep that
    collects nothing (Codex review, PR #844)."""
    from services.mock_exam_service import MockExamError
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.collect_preflight",
               side_effect=MockExamError("không đọc được")), \
         patch("routers.admin_mock_exams.svc.mark_section_collected") as mock_mark:
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/collect?from_section=listening", headers=_AUTH)
    assert r.status_code == 503, r.text
    mock_mark.assert_not_called()


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


def test_recovery_from_a_finished_exam_is_accepted():
    """After the final advance the monitor shows 'done'. Rejecting that as a
    screen state 422'd every recovery click once the exam had finished — the
    exact case the button exists for (Codex review, PR #844)."""
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.collect_preflight",
               return_value={"section": "writing", "pending": 2}), \
         patch("routers.admin_mock_exams.svc.mark_section_collected"), \
         patch("routers.admin_mock_exams.svc.collect_section_after_flush_grace"):
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/collect?section=writing&from_section=done",
            headers=_AUTH)
    assert r.status_code == 202, r.text


def test_a_nonsense_screen_state_is_still_rejected():
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.collect_preflight") as mock_pre:
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/collect?from_section=banana", headers=_AUTH)
    assert r.status_code == 422, r.text
    mock_pre.assert_not_called()
