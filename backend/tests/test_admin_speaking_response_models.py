"""Admin Speaking read/repair contracts must remain concrete in OpenAPI."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from models.admin_speaking import (  # noqa: E402
    AdminResponseRegradeResponse,
    AdminSessionRegradeResponse,
    AdminSpeakingSessionDetail,
    AdminSpeakingSessionRow,
    AdminSummaryRebuildResponse,
)
from routers.admin import router  # noqa: E402


ROW = {
    "id": "session-1", "user_id": "user-1", "user_email": "student@example.test",
    "user_lookup_failed": False, "mode": "test_part", "part": 2,
    "topic": "Home", "status": "completed",
    "started_at": "2026-09-14T00:00:00+00:00", "overall_band": 6.5,
}


def test_admin_read_models_validate_canonical_and_degraded_shapes():
    AdminSpeakingSessionRow.model_validate(ROW)
    detail = AdminSpeakingSessionDetail.model_validate({
        **ROW,
        "session_id": "session-1",
        "p1_session_id": None, "p2_session_id": "session-1", "p3_session_id": None,
        "full_test_siblings_lookup_failed": False,
        "questions_lookup_failed": False, "responses_lookup_failed": False,
        "questions": [{"id": "q1", "question_text": "Where?"}],
        "responses": [{
            "id": "r1", "question_id": "q1", "audio_available": True,
            "audio_lookup_failed": False, "audio_playback_url": "https://signed.test/a",
            "audio_storage_path": "user/session.webm",
        }],
    })
    assert detail.responses[0].model_dump()["audio_storage_path"] == "user/session.webm"


def test_admin_mutation_models_preserve_partial_failure_truth():
    AdminResponseRegradeResponse.model_validate({
        "ok": True, "response_id": "r1", "session_id": "s1",
        "overall_band": 6.5, "re_transcribed": False,
        "session_updated": False, "remaining_failed": 1, "session_band": 6.5,
    })
    AdminSessionRegradeResponse.model_validate({
        "ok": False, "partial_failure": True, "session_id": "s1",
        "regraded": 1, "skipped": 0, "failed": 1,
        "failed_details": ["r2: provider unavailable"],
        "overall_band": 6.5, "band_fc": 6.5, "band_lr": 6.5,
        "band_gra": 6.5, "band_p": 6.5,
    })
    AdminSummaryRebuildResponse.model_validate({
        "ok": True,
        "sessions": [{"session_id": "s1", "ok": False, "error": "Còn 1 response lỗi"}],
    })


def test_every_admin_speaking_surface_exposes_its_response_model():
    expected = {
        ("GET", "/admin/sessions"): list[AdminSpeakingSessionRow],
        ("GET", "/admin/sessions/{session_id}"): AdminSpeakingSessionDetail,
        ("POST", "/admin/responses/{response_id}/regrade"): AdminResponseRegradeResponse,
        ("POST", "/admin/sessions/{session_id}/regrade"): AdminSessionRegradeResponse,
        ("POST", "/admin/sessions/{session_id}/rebuild-summary"): AdminSummaryRebuildResponse,
    }
    routes = {
        (method, route.path): route.response_model
        for route in router.routes
        for method in getattr(route, "methods", set())
    }
    for key, model in expected.items():
        assert routes[key] == model
