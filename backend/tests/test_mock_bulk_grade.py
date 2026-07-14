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

    claim_calls = []

    def fake_claim_mock(essay_ids, **kw):
        # word-count-gated claim helper: only s1's [e1, e2] reaches here (s2 is a
        # foreign exam → skipped before claim; s3 has no essays → [None, None]).
        claim_calls.append((essay_ids, kw))
        if essay_ids == ["e1", "e2"]:
            return {"queued": [("e1", "j-e1")], "short": [], "skipped": ["e2"]}
        return {"queued": [], "short": [], "skipped": []}

    bg = MagicMock(__name__="_bg_grade_essay")
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.get_sitting", side_effect=fake_get_sitting), \
         patch("routers.admin_mock_exams.svc.claim_mock_writing_grading",
               side_effect=fake_claim_mock), \
         patch("routers.admin_mock_exams.essay_service._bg_grade_essay", new=bg):
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/writing/bulk-grade",
            json={"sitting_ids": ["s1", "s2", "s3"], "grading_tier": "instructor"},
            headers=_AUTH,
        )

    assert r.status_code == 202, r.text
    body = r.json()
    assert body["queued"] == ["e1"]      # only the pending essay of an in-exam sitting
    assert body["skipped"] == ["e2"]     # e2 not pending; s2 (foreign) + s3 (no essays) untouched
    assert body["grading_tier"] == "instructor"
    # e3 (foreign exam) must never have been claimed; tier passed through.
    assert not any("e3" in (ids or []) for ids, _ in claim_calls)
    assert (["e1", "e2"], {"grading_tier": "instructor"}) in claim_calls
    assert bg.call_args_list[0].args == ("e1", "j-e1")


def test_bulk_grade_reports_too_short_essays():
    """Word-count gate: a too-short essay is reported in `short`, not queued."""
    s1 = {"id": "s1", "mock_exam_id": _EXAM, "essay_task1_id": "e1", "essay_task2_id": "e2"}

    def fake_claim_mock(essay_ids, **kw):
        return {"queued": [("e1", "j-e1")], "short": ["e2"], "skipped": []}

    bg = MagicMock(__name__="_bg_grade_essay")
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.get_sitting", return_value=s1), \
         patch("routers.admin_mock_exams.svc.claim_mock_writing_grading",
               side_effect=fake_claim_mock), \
         patch("routers.admin_mock_exams.essay_service._bg_grade_essay", new=bg):
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/writing/bulk-grade",
            json={"sitting_ids": ["s1"], "grading_tier": "standard"},
            headers=_AUTH,
        )
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["queued"] == ["e1"]
    assert body["short"] == ["e2"]      # held for admin decision, not auto-graded
    assert bg.call_count == 1


def test_bulk_grade_skips_sitting_flagged_for_retest():
    """P4 (2026-07-12): a sitting the admin flagged for retest is skipped
    entirely — no point grading a retaker's Writing — and reported separately."""
    s1 = {"id": "s1", "mock_exam_id": _EXAM, "essay_task1_id": "e1",
          "essay_task2_id": None, "needs_retest": True}
    s2 = {"id": "s2", "mock_exam_id": _EXAM, "essay_task1_id": "e2",
          "essay_task2_id": None, "needs_retest": False}

    def fake_get_sitting(sid):
        return {"s1": s1, "s2": s2}.get(sid)

    claim_calls = []

    def fake_claim_mock(essay_ids, **kw):
        claim_calls.append(essay_ids)
        return {"queued": [("e2", "j-e2")] if essay_ids == ["e2", None] else [],
                "short": [], "skipped": []}

    bg = MagicMock(__name__="_bg_grade_essay")
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.get_sitting", side_effect=fake_get_sitting), \
         patch("routers.admin_mock_exams.svc.claim_mock_writing_grading",
               side_effect=fake_claim_mock), \
         patch("routers.admin_mock_exams.essay_service._bg_grade_essay", new=bg):
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/writing/bulk-grade",
            json={"sitting_ids": ["s1", "s2"], "grading_tier": "standard"},
            headers=_AUTH,
        )

    assert r.status_code == 202, r.text
    body = r.json()
    assert body["queued"] == ["e2"]           # only the non-retaker graded
    assert body["retest_skipped"] == ["s1"]   # flagged sitting skipped
    # s1 (retaker) essays must never have been claimed.
    assert not any("e1" in (ids or []) for ids in claim_calls)


def test_skip_grading_marks_essay_and_maps_errors():
    """POST /writing/essays/{id}/skip-grading delegates to the service; a
    SittingConflictError (non-mock / already-reviewed essay) maps to 409."""
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.skip_mock_writing_grading",
               return_value={"ok": True, "essay_id": "e1", "grading_skipped": True}) as ok:
        r = _client().post("/admin/mock-exams/writing/essays/e1/skip-grading", headers=_AUTH)
    assert r.status_code == 200, r.text
    assert r.json()["grading_skipped"] is True
    ok.assert_called_once()

    import services.mock_exam_service as svc
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.svc.skip_mock_writing_grading",
               side_effect=svc.SittingConflictError("Chỉ áp dụng cho bài Writing của mock test.")):
        r = _client().post("/admin/mock-exams/writing/essays/e9/skip-grading", headers=_AUTH)
    assert r.status_code == 409, r.text


def test_bulk_grade_rejects_bad_tier():
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)):
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/writing/bulk-grade",
            json={"sitting_ids": ["s1"], "grading_tier": "quick"},
            headers=_AUTH,
        )
    assert r.status_code == 422
