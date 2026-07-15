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


def test_result_includes_attempt_ids_and_delivered_essays():
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
         patch("routers.mock_exams.review_wf.get_review_for_sitting", return_value=review), \
         patch("routers.mock_exams.essay_service.delivered_essay_ids",
               return_value={"essay-1", "essay-2"}):
        r = _client().get(
            "/api/mock-exams/sittings/" + _SITTING_ID + "/result", headers=_AUTH,
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["listening_attempt_id"] == "l-attempt-1"
    assert body["reading_attempt_id"] == "r-attempt-1"
    # both essays delivered → both linkable
    assert body["essay_task1_id"] == "essay-1"
    assert body["essay_task2_id"] == "essay-2"


def test_result_hides_undelivered_writing_essay():
    """Codex P2 (2026-07-12): release leaves a still-'graded' essay undelivered;
    that id must NOT be surfaced (writing-result.html only shows 'delivered', so
    it would be a dead-end link). Only the delivered essay comes back."""
    sitting = {
        "id":             _SITTING_ID,
        "user_id":        _USER["id"],
        "status":         "released",
        "essay_task1_id": "essay-1",   # delivered
        "essay_task2_id": "essay-2",   # still graded → not delivered
    }
    review = {"final_bands": {"writing": 6.0}}
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.get_sitting", return_value=sitting), \
         patch("routers.mock_exams.review_wf.get_review_for_sitting", return_value=review), \
         patch("routers.mock_exams.essay_service.delivered_essay_ids",
               return_value={"essay-1"}):
        r = _client().get(
            "/api/mock-exams/sittings/" + _SITTING_ID + "/result", headers=_AUTH,
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["essay_task1_id"] == "essay-1"
    assert body["essay_task2_id"] is None   # undelivered → hidden


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


# ── Per-task Writing outcome (2026-07-15) ─────────────────────────────
#
# The TRF only ever linked a DELIVERED essay and said NOTHING about a task that
# never got graded — a student with one graded task saw one link and a silent
# gap. writing_task_states reports what actually happened per task so the page
# can say it. Pure function: no DB, no mocks needed.

def _states(**kw):
    from services import mock_exam_service as svc
    sitting = {
        "essay_task1_id": kw.get("e1"), "essay_task2_id": kw.get("e2"),
        "writing_submission": {
            "task1": {"word_count": kw.get("wc1")},
            "task2": {"word_count": kw.get("wc2")},
        },
    }
    return {t["task"]: t for t in svc.writing_task_states(sitting, kw.get("delivered", set()))}


def test_writing_states_delivered_task_is_linkable():
    st = _states(e1="e1", e2="e2", wc1=180, wc2=300, delivered={"e1", "e2"})
    assert st["task1"]["state"] == "delivered" and st["task1"]["essay_id"] == "e1"
    assert st["task2"]["state"] == "delivered" and st["task2"]["essay_id"] == "e2"


def test_writing_states_too_short_reports_the_real_reason():
    """The reason is a FACT on the row (word count vs the IELTS minimum), not the
    admin's retest decision — the page must explain the gap even if nobody ticked
    anything."""
    st = _states(e1="e1", e2="e2", wc1=180, wc2=121, delivered={"e1"})
    assert st["task1"]["state"] == "delivered"          # graded task still shown
    assert st["task2"]["state"] == "too_short"
    assert st["task2"]["word_count"] == 121
    assert st["task2"]["min_words"] == 250              # Task 2 minimum, not Task 1's
    assert st["task2"]["essay_id"] is None              # unreadable → no dead-end link


def test_writing_states_task1_uses_its_own_minimum():
    st = _states(e1="e1", e2="e2", wc1=140, wc2=300, delivered={"e2"})
    assert st["task1"]["state"] == "too_short" and st["task1"]["min_words"] == 150
    assert st["task2"]["state"] == "delivered"


def test_writing_states_long_enough_but_undelivered_is_not_called_too_short():
    """A long essay that simply isn't readable yet must not be blamed on length —
    that would tell the student a falsehood about their own work."""
    st = _states(e1="e1", e2="e2", wc1=180, wc2=300, delivered=set())
    assert st["task1"]["state"] == "not_graded"
    assert st["task2"]["state"] == "not_graded"


def test_writing_states_missing_task_is_missing_not_too_short():
    st = _states(e1=None, e2="e2", wc1=None, wc2=300, delivered={"e2"})
    assert st["task1"]["state"] == "missing"
    assert st["task2"]["state"] == "delivered"


def test_result_payload_carries_writing_tasks_and_retest_flags():
    sitting = {
        "id": _SITTING_ID, "user_id": _USER["id"], "status": "released",
        "essay_task1_id": "essay-1", "essay_task2_id": "essay-2",
        "writing_submission": {"task1": {"word_count": 176}, "task2": {"word_count": 121}},
    }
    review = {"final_bands": {"writing": 5.0}, "retest_flags": {"writing": True, "reading": False}}
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.get_sitting", return_value=sitting), \
         patch("routers.mock_exams.review_wf.get_review_for_sitting", return_value=review), \
         patch("routers.mock_exams.essay_service.delivered_essay_ids", return_value={"essay-1"}):
        r = _client().get("/api/mock-exams/sittings/" + _SITTING_ID + "/result", headers=_AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    tasks = {t["task"]: t for t in body["writing_tasks"]}
    assert tasks["task1"]["state"] == "delivered"
    assert tasks["task2"]["state"] == "too_short" and tasks["task2"]["word_count"] == 121
    # only the flagged skills ride along — an unticked one is not an obligation
    assert body["retest_flags"] == {"writing": True}
