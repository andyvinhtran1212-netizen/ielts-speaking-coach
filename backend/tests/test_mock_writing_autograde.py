"""POST /api/mock-exams/sittings/{id}/sections/{section}/submit auto-starts AI
grading for the Writing essays it promoted (2026-07-14) — the student-submit
half of closing the mock-writing grading gap, so a mock essay lands 'graded' +
ready for admin review without a manual "Bắt đầu chấm" click."""
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_AUTH = {"Authorization": "Bearer faketoken"}
_USER = {"id": "u1"}
_SID = "sit-1"


def test_writing_submit_autoschedules_grading():
    sitting = {"id": _SID, "essay_task1_id": "e1", "essay_task2_id": "e2"}
    bg = MagicMock(__name__="_bg_grade_essay")
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.submit_section", return_value=sitting), \
         patch("routers.mock_exams.svc.get_sitting", return_value=sitting), \
         patch("routers.mock_exams.svc.claim_mock_writing_grading",
               return_value={"queued": [("e1", "j1"), ("e2", "j2")], "short": [], "skipped": []}) as mock_claim, \
         patch("routers.mock_exams.essay_service._bg_grade_essay", new=bg):
        r = _client().post(
            f"/api/mock-exams/sittings/{_SID}/sections/writing/submit",
            json={"task1_text": "a", "task2_text": "b"}, headers=_AUTH,
        )
    assert r.status_code == 200, r.text
    # The stamped essay ids (read back off the persisted sitting) are claimed…
    mock_claim.assert_called_once_with(["e1", "e2"])
    # …and each queued job is launched as a BackgroundTask (TestClient runs
    # background tasks after the response).
    assert bg.call_count == 2
    assert {c.args for c in bg.call_args_list} == {("e1", "j1"), ("e2", "j2")}


def test_writing_submit_short_essay_not_scheduled():
    """A too-short essay is reported in `short`, not `queued` → no grading task."""
    sitting = {"id": _SID, "essay_task1_id": "e1", "essay_task2_id": "e2"}
    bg = MagicMock(__name__="_bg_grade_essay")
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.submit_section", return_value=sitting), \
         patch("routers.mock_exams.svc.get_sitting", return_value=sitting), \
         patch("routers.mock_exams.svc.claim_mock_writing_grading",
               return_value={"queued": [("e1", "j1")], "short": ["e2"], "skipped": []}), \
         patch("routers.mock_exams.essay_service._bg_grade_essay", new=bg):
        r = _client().post(
            f"/api/mock-exams/sittings/{_SID}/sections/writing/submit",
            json={"task1_text": "a", "task2_text": "b"}, headers=_AUTH,
        )
    assert r.status_code == 200, r.text
    assert bg.call_count == 1                       # only the long task queued
    assert bg.call_args_list[0].args == ("e1", "j1")


def test_writing_submit_with_no_promoted_essays_schedules_nothing():
    """An empty (unanswered) Writing submit promotes no essay → nothing queued."""
    sitting = {"id": _SID, "essay_task1_id": None, "essay_task2_id": None}
    bg = MagicMock(__name__="_bg_grade_essay")
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.submit_section", return_value=sitting), \
         patch("routers.mock_exams.svc.get_sitting", return_value=sitting), \
         patch("routers.mock_exams.svc.claim_mock_writing_grading",
               return_value={"queued": [], "short": [], "skipped": []}), \
         patch("routers.mock_exams.essay_service._bg_grade_essay", new=bg):
        r = _client().post(
            f"/api/mock-exams/sittings/{_SID}/sections/writing/submit",
            json={"task1_text": "", "task2_text": ""}, headers=_AUTH,
        )
    assert r.status_code == 200, r.text
    assert bg.call_count == 0


def test_non_writing_submit_never_touches_grading():
    """Listening/Reading submits must not reach the Writing auto-grade path."""
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.submit_section", return_value={"id": _SID}), \
         patch("routers.mock_exams.svc.claim_mock_writing_grading") as mock_claim:
        r = _client().post(
            f"/api/mock-exams/sittings/{_SID}/sections/reading/submit",
            json={}, headers=_AUTH,
        )
    assert r.status_code == 200, r.text
    mock_claim.assert_not_called()
