"""reading-rich Part C — post-submit chữa-bài review endpoint.

GET /api/reading/test/attempts/{attempt_id}/review:
  • HARD-gates on status == 'submitted' (409 otherwise) — the rich solution is
    stripped during the test (Part A) and must never leak to an in-progress /
    abandoned attempt.
  • merges grading_details (user vs correct) + payload.solution (revealed) +
    per-passage translation, and rolls up by_part.
  • 403 when the attempt belongs to another user.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

_AUTH = {"Authorization": "Bearer fake.user.jwt"}
_USER = {"id": "00000000-0000-0000-0000-00000000bbbb", "email": "u@x"}
_OTHER = {"id": "00000000-0000-0000-0000-0000000cccccc", "email": "o@x"}


def _client():
    from main import app
    return TestClient(app, raise_server_exceptions=False)


class _Chain:
    """A permissive query-chain stub: every builder method returns self;
    .execute() yields the configured data."""
    def __init__(self, data):
        self._data = data
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def execute(self): return MagicMock(data=self._data)


def _db(tables):
    db = MagicMock()
    db.table.side_effect = lambda name: _Chain(tables.get(name, []))
    return db


_SUBMITTED_ATTEMPT = {
    "id": "a-uuid", "user_id": _USER["id"], "test_id": "t-uuid",
    "status": "submitted", "score": 1, "band_estimate": 5.0,
    "skill_breakdown": {"vocabulary_in_context": {"correct": 1, "total": 1}},
    "grading_details": [
        {"q_num": 1, "correct": True, "user_answer": "gravity", "expected": "gravity",
         "skill_tag": "vocabulary_in_context", "passage_order": 1},
    ],
}
_TEST_ROW = {"test_id": "TEST_06", "title": "Test 6", "module": "academic"}
_PASSAGES = [
    {"id": "p1", "slug": "p1", "title": "Water", "body_markdown": "Body…",
     "passage_order": 1, "metadata": {"translation_vi": "Bản dịch.", "img_prompts": []}},
]
_QUESTIONS = [
    {"q_num": 1, "question_type": "diagram_label_completion", "prompt": "Label 1 ____",
     "payload": {"solution": {"band": 5, "steps": "Định vị…", "source_excerpt": "…gravity…",
                              "vocab": ["gravity = trọng lực"], "trap_analysis": "Bẫy: gradient",
                              "tips": "Dự đoán từ loại"}},
     "passage_id": "p1"},
]


def test_review_gated_to_submitted_attempts():
    """An in-progress attempt must NOT leak the solution → 409."""
    in_progress = dict(_SUBMITTED_ATTEMPT, status="in_progress")
    db = _db({"reading_test_attempts": [in_progress]})
    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", db):
        r = _client().get("/api/reading/test/attempts/a-uuid/review", headers=_AUTH)
    assert r.status_code == 409


def test_review_403_for_other_users_attempt():
    db = _db({"reading_test_attempts": [_SUBMITTED_ATTEMPT]})
    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_OTHER)), \
         patch("routers.reading_student.supabase_admin", db):
        r = _client().get("/api/reading/test/attempts/a-uuid/review", headers=_AUTH)
    assert r.status_code == 403


def test_review_merges_solution_translation_and_by_part():
    db = _db({
        "reading_test_attempts": [_SUBMITTED_ATTEMPT],
        "reading_tests":         [_TEST_ROW],
        "reading_passages":      _PASSAGES,
        "reading_questions":     _QUESTIONS,
    })
    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", db):
        r = _client().get("/api/reading/test/attempts/a-uuid/review", headers=_AUTH)

    assert r.status_code == 200
    body = r.json()
    assert body["score"] == 1 and body["band_estimate"] == 5.0
    assert body["max_score"] == 1
    assert body["by_part"]["p1"] == {"correct": 1, "total": 1}
    # passage translation surfaced, raw metadata dropped
    p = body["passages"][0]
    assert p["translation_vi"] == "Bản dịch." and "metadata" not in p
    # per-Q grading merged with the REVEALED rich solution + prompt
    item = body["review"][0]
    assert item["correct"] is True and item["user_answer"] == "gravity"
    assert item["prompt"] == "Label 1 ____"
    assert item["solution"]["steps"] == "Định vị…"
    assert item["solution"]["trap_analysis"].startswith("Bẫy")


def test_review_requires_auth():
    assert _client().get("/api/reading/test/attempts/a-uuid/review").status_code == 401
