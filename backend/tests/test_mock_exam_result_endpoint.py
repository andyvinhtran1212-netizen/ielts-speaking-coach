"""GET /api/mock-exams/sittings/{id}/result — TRF result endpoint (2026-07-12).

Pins the addition of listening_attempt_id/reading_attempt_id to the response,
which mock-result.html uses to link the student into the detailed chữa bài
for each skill once results are released."""
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_USER = {"id": "00000000-0000-0000-0000-0000000000aa"}
_AUTH = {"Authorization": "Bearer faketoken"}
_SITTING_ID = "00000000-0000-0000-0000-0000000000bb"


def test_result_includes_listening_and_reading_attempt_ids():
    sitting = {
        "id":                   _SITTING_ID,
        "user_id":              _USER["id"],
        "status":               "released",
        "listening_attempt_id": "l-attempt-1",
        "reading_attempt_id":   "r-attempt-1",
        "essay_task1_id":       "essay-1",
        "essay_task2_id":       "essay-2",
    }
    review = {
        "final_bands":         {"listening": 7.0, "reading": 7.0},
        "examiner_comment_vi": "Tốt",
        "per_skill_notes":     {},
        "released_at":         "2026-07-12T00:00:00Z",
    }
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.get_sitting", return_value=sitting), \
         patch("routers.mock_exams.review_wf.get_review_for_sitting", return_value=review):
        r = _client().get(
            "/api/mock-exams/sittings/" + _SITTING_ID + "/result", headers=_AUTH,
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["listening_attempt_id"] == "l-attempt-1"
    assert body["reading_attempt_id"] == "r-attempt-1"
    # so mock-result.html can link to the detailed Writing feedback
    assert body["essay_task1_id"] == "essay-1"
    assert body["essay_task2_id"] == "essay-2"


def test_result_omits_attempt_ids_when_sitting_has_none():
    """A speaking-only or writing-only exam has no listening/reading attempt —
    the field must be None, not a KeyError or a stray placeholder."""
    sitting = {"id": _SITTING_ID, "user_id": _USER["id"], "status": "released"}
    review = {"final_bands": {"speaking": 7.0}}
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.get_sitting", return_value=sitting), \
         patch("routers.mock_exams.review_wf.get_review_for_sitting", return_value=review):
        r = _client().get(
            "/api/mock-exams/sittings/" + _SITTING_ID + "/result", headers=_AUTH,
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["listening_attempt_id"] is None
    assert body["reading_attempt_id"] is None
    assert body["essay_task1_id"] is None
    assert body["essay_task2_id"] is None
