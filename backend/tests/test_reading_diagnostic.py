from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from services.reading_diagnostic_engine import build_reading_diagnostic


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_AUTH = {"Authorization": "Bearer fake.user.jwt"}
_USER = {"id": "00000000-0000-0000-0000-00000000bbbb", "email": "u@x"}


def test_build_reading_diagnostic_ranks_focus_skills_and_trend():
    attempts = [
        {
            "id": "att-latest",
            "status": "submitted",
            "submitted_at": "2026-05-28T12:00:00+00:00",
            "score": 23,
            "band_estimate": 6.0,
            "skill_breakdown": {
                "detail": {"correct": 1, "total": 4},
                "inference": {"correct": 2, "total": 3},
                "skimming": {"correct": 4, "total": 4},
            },
        },
        {
            "id": "att-prev",
            "status": "submitted",
            "submitted_at": "2026-05-20T12:00:00+00:00",
            "score": 20,
            "band_estimate": 5.5,
            "skill_breakdown": {
                "detail": {"correct": 3, "total": 4},
                "inference": {"correct": 1, "total": 4},
                "skimming": {"correct": 2, "total": 4},
            },
        },
    ]
    exercises = [
        {"id": "l2-detail-1", "slug": "detail-1", "title": "Detail drill 1", "skill_focus": "detail", "difficulty_level": "foundation", "estimated_minutes": 12, "topic_tags": []},
        {"id": "l2-detail-2", "slug": "detail-2", "title": "Detail drill 2", "skill_focus": "detail", "difficulty_level": "intermediate", "estimated_minutes": 14, "topic_tags": []},
        {"id": "l2-inf-1", "slug": "inf-1", "title": "Inference drill", "skill_focus": "inference", "difficulty_level": "advanced", "estimated_minutes": 15, "topic_tags": []},
    ]

    diag = build_reading_diagnostic(attempts, exercises)

    assert diag["selected_attempt_id"] == "att-latest"
    assert diag["attempts_considered"] == 2
    assert [s["skill_tag"] for s in diag["focus_skills"]] == ["detail", "inference"]

    detail = diag["focus_skills"][0]
    assert detail["diagnostic_level"] == "weak"
    assert detail["current"]["accuracy_pct"] == 25
    assert detail["aggregate"]["accuracy_pct"] == 50
    assert detail["trend"]["direction"] == "declining"
    assert [r["slug"] for r in detail["recommendations"]] == ["detail-1", "detail-2"]

    inference = diag["focus_skills"][1]
    assert inference["diagnostic_level"] == "watch"
    assert inference["trend"]["direction"] == "improving"
    assert inference["recommendation_count"] == 1


def test_build_reading_diagnostic_returns_empty_shape_without_attempts():
    diag = build_reading_diagnostic([], [])
    assert diag["attempts_considered"] == 0
    assert diag["skills"] == []
    assert diag["focus_skills"] == []


def test_reading_diagnostic_requires_auth():
    assert _client().get("/api/reading/diagnostic").status_code == 401


def test_reading_diagnostic_endpoint_returns_focus_skills_and_recommendations():
    attempts = [
        {
            "id": "att-latest",
            "status": "submitted",
            "submitted_at": "2026-05-28T12:00:00+00:00",
            "score": 22,
            "band_estimate": 5.5,
            "skill_breakdown": {
                "detail": {"correct": 1, "total": 4},
                "writer_view_TFNG": {"correct": 3, "total": 4},
            },
        },
        {
            "id": "att-prev",
            "status": "submitted",
            "submitted_at": "2026-05-18T12:00:00+00:00",
            "score": 18,
            "band_estimate": 5.0,
            "skill_breakdown": {
                "detail": {"correct": 2, "total": 4},
                "writer_view_TFNG": {"correct": 2, "total": 4},
            },
        },
    ]
    exercises = [
        {"id": "l2-detail-1", "slug": "detail-1", "title": "Detail drill 1", "skill_focus": "detail", "difficulty_level": "foundation", "estimated_minutes": 10, "topic_tags": ["facts"]},
    ]

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student._fetch_submitted_attempts_for_user", return_value=attempts), \
         patch("routers.reading_student._fetch_l2_skill_exercises", return_value=exercises):
        r = _client().get("/api/reading/diagnostic?attempt_id=att-latest", headers=_AUTH)

    assert r.status_code == 200
    body = r.json()
    assert body["selected_attempt_id"] == "att-latest"
    assert body["attempts_considered"] == 2
    assert body["focus_skills"][0]["skill_tag"] == "detail"
    assert body["focus_skills"][0]["recommendations"][0]["slug"] == "detail-1"
    assert body["skills"][1]["skill_tag"] == "writer_view_TFNG"
    assert body["skills"][1]["diagnostic_level"] == "strong"
