"""Learner session payloads must remain concrete and backwards-compatible."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from models.session_contracts import (  # noqa: E402
    SessionAudioUrl,
    SessionDetailResponse,
    SessionListResponse,
    SessionPageResponse,
    SessionRow,
    SessionStatsResponse,
)
from pydantic import TypeAdapter  # noqa: E402
from routers.sessions import router  # noqa: E402


RETENTION = {
    "days_until_audio_purge": 12,
    "days_until_content_purge": 57,
    "is_audio_purged": False,
    "is_content_purged": False,
    "is_hidden": False,
}
ROW = {
    "id": "session-1",
    "user_id": "user-1",
    "mode": "practice",
    "part": 1,
    "topic": "Home",
    "status": "completed",
    "started_at": "2026-09-14T00:00:00+00:00",
    "overall_band": 6.5,
    "retention": RETENTION,
}


def test_dual_shape_history_and_stats_validate_live_shapes():
    adapter = TypeAdapter(SessionListResponse)
    adapter.validate_python([ROW])
    adapter.validate_python({
        "sessions": [ROW], "total": 1, "page": 1,
        "page_size": 20, "total_pages": 1,
    })
    SessionStatsResponse.model_validate({
        "sessions": [{
            key: ROW[key] for key in ("id", "started_at", "mode", "part", "topic", "status")
        } | {"overall_band": 6.5}],
        "summary": {
            "total_sessions": 1, "avg_band_30d": 6.5,
            "current_streak": 1, "last_topic": "Home", "last_part": 1,
            "last_mode": "practice", "last_session_at": ROW["started_at"],
        },
    })


def test_detail_keeps_safety_flags_and_allows_operational_columns():
    detail = SessionDetailResponse.model_validate({
        **ROW,
        "session_id": "session-1",
        "questions": [{"id": "question-1", "question_text": "Where do you live?", "custom": 1}],
        "responses": [{
            "id": "response-1", "question_id": "question-1",
            "feedback": {"strengths": ["Clear"]}, "audio_available": False,
        }],
        "response_receipts": [{
            "id": "response-1", "question_id": "question-1",
            "persisted_at": "2026-09-14T00:01:00+00:00",
        }],
        "question_lookup_failed": False,
        "response_lookup_failed": False,
        "results_sealed": False,
        "error_code": None,
    })
    assert detail.model_dump()["error_code"] is None
    assert detail.questions[0].model_dump()["custom"] == 1


def test_audio_contract_requires_private_signed_url_shape():
    SessionAudioUrl.model_validate({
        "response_id": "response-1", "question_id": "question-1",
        "url": "https://signed.example.test/audio", "expires_in": 3600,
    })


def test_every_learner_session_read_route_exposes_its_response_model():
    expected = {
        ("GET", "/sessions"): SessionListResponse,
        ("GET", "/sessions/stats"): SessionStatsResponse,
        ("GET", "/sessions/{session_id}"): SessionDetailResponse,
        ("GET", "/sessions/{session_id}/audio-urls"): list[SessionAudioUrl],
    }
    routes = {
        (method, route.path): route.response_model
        for route in router.routes
        for method in getattr(route, "methods", set())
    }
    for key, model in expected.items():
        assert routes[key] == model


def test_page_model_is_not_mistaken_for_legacy_list():
    page = SessionPageResponse.model_validate({
        "sessions": [ROW], "total": 1, "page": 1,
        "page_size": 20, "total_pages": 1,
    })
    assert page.sessions[0] == SessionRow.model_validate(ROW)
