"""POST /api/mock-exams/sittings/{id}/integrity — the HTTP boundary.

record_integrity() sanitises field by field: junk is DROPPED, never raised,
because a soft informational signal must never be able to break an exam. The
route was undoing that with constrained Pydantic fields — a mixed payload like
{"blur_count": "bad", "offline_events": 2} was rejected wholesale with a 422
before the service ever saw it, so the valid counter was lost too (Codex review,
PR #849).

The service-level test asserted the sanitisation directly, which is exactly why
it did not catch this: the failure lived one layer above it. These go through
the endpoint.
"""
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_AUTH = {"Authorization": "Bearer faketoken"}
_USER = {"id": "user-1"}
_SIT = "sit-1"
_URL = f"/api/mock-exams/sittings/{_SIT}/integrity"


def test_a_junk_field_does_not_discard_the_valid_ones():
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.record_integrity", return_value={}) as mock_rec:
        r = _client().post(_URL, json={"blur_count": "bad", "offline_events": 2},
                           headers=_AUTH)
    assert r.status_code == 200, r.text
    signals = mock_rec.call_args[0][2]
    # The route hands the raw values straight through; the service decides.
    assert signals["blur_count"] == "bad"
    assert signals["offline_events"] == 2


def test_a_negative_value_reaches_the_service_to_be_dropped():
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.record_integrity", return_value={}) as mock_rec:
        r = _client().post(_URL, json={"resumes": -4, "blur_count": 3}, headers=_AUTH)
    assert r.status_code == 200, r.text
    signals = mock_rec.call_args[0][2]
    assert signals["resumes"] == -4 and signals["blur_count"] == 3


def test_the_sanitisation_is_end_to_end_not_just_at_the_service():
    """The whole point: junk in, valid counters still persisted."""
    captured = {}

    def fake_record(sitting_id, user_id, signals):
        # the real service's own filter, reached through HTTP
        from services.mock_exam_service import _INTEGRITY_COUNTERS
        out = {}
        for key in _INTEGRITY_COUNTERS:
            raw = signals.get(key)
            if raw is None:
                continue
            try:
                v = int(raw)
            except (TypeError, ValueError):
                continue
            if v < 0:
                continue
            out[key] = v
        captured.update(out)
        return out

    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.record_integrity", side_effect=fake_record):
        r = _client().post(
            _URL, json={"blur_count": "bad", "resumes": -1, "offline_events": 2},
            headers=_AUTH)
    assert r.status_code == 200, r.text
    assert captured == {"offline_events": 2}


def test_it_still_requires_authentication():
    assert _client().post(_URL, json={"blur_count": 1}).status_code == 401
