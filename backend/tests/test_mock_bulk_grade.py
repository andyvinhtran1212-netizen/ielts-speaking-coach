"""POST /admin/mock-exams/{exam_id}/writing/bulk-grade (2026-07-12).

Roster-grid bulk version of the per-essay start-grading button: queues each
selected sitting's PENDING writing essays, skips anything already claimed,
and never reaches into a sitting from a different exam."""
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_AUTH = {"Authorization": "Bearer faketoken"}
_ADMIN = {"id": "admin-1"}
_EXAM = "exam-1"


def test_bulk_grade_requires_auth():
    r = _client().post(f"/admin/mock-exams/{_EXAM}/writing/bulk-grade", json={"sitting_ids": []})
    assert r.status_code == 401


def test_bulk_grade_queues_pending_skips_others_and_foreign_exam():
    s1 = {"id": "s1", "mock_exam_id": _EXAM, "essay_task1_id": "e1", "essay_task2_id": "e2"}
    s2 = {"id": "s2", "mock_exam_id": "OTHER", "essay_task1_id": "e3", "essay_task2_id": None}
    s3 = {"id": "s3", "mock_exam_id": _EXAM, "essay_task1_id": None, "essay_task2_id": None}

    def fake_get_sitting(sid):
        return {"s1": s1, "s2": s2, "s3": s3}.get(sid)

    def fake_claim(essay_id, **kw):
        # e1 is pending → gets a job; e2 already graded → None (skip)
        return {"job_id": "j-" + essay_id, "eta_seconds": 10} if essay_id == "e1" else None

    bg = MagicMock(__name__="_bg_grade_essay")
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.get_sitting", side_effect=fake_get_sitting), \
         patch("routers.admin_mock_exams.essay_service.claim_pending_for_grading",
               side_effect=fake_claim) as mock_claim, \
         patch("routers.admin_mock_exams.essay_service._bg_grade_essay", new=bg):
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/writing/bulk-grade",
            json={"sitting_ids": ["s1", "s2", "s3"], "grading_tier": "instructor"},
            headers=_AUTH,
        )

    assert r.status_code == 202, r.text
    body = r.json()
    assert body["queued"] == ["e1"]      # only the pending essay of an in-exam sitting
    assert body["skipped"] == ["e2"]     # e2 not pending; s2 (foreign exam) + s3 (no essays) untouched
    assert body["grading_tier"] == "instructor"
    # e3 (foreign exam) must never have been claimed
    claimed_ids = [c.args[0] for c in mock_claim.call_args_list]
    assert "e3" not in claimed_ids
    assert mock_claim.call_args_list[0].kwargs["grading_tier"] == "instructor"


def test_bulk_grade_rejects_bad_tier():
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)):
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/writing/bulk-grade",
            json={"sitting_ids": ["s1"], "grading_tier": "quick"},
            headers=_AUTH,
        )
    assert r.status_code == 422
