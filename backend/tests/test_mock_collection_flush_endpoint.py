"""Student final-autosave acknowledgement endpoint."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


_AUTH = {"Authorization": "Bearer faketoken"}
_USER = {"id": "student-1"}
_SITTING = "sitting-1"


def _client() -> TestClient:
    from main import app
    return TestClient(app)


def test_flush_ack_forwards_authenticated_owner_and_section():
    expected = {
        "section": "reading", "acknowledged": True, "settled": False,
    }
    with patch(
        "routers.mock_exams.get_supabase_user",
        new=AsyncMock(return_value=_USER),
    ), patch(
        "routers.mock_exams.svc.acknowledge_collection_flush",
        return_value=expected,
    ) as acknowledge:
        response = _client().post(
            f"/api/mock-exams/sittings/{_SITTING}/sections/reading/flush-ack",
            headers=_AUTH,
        )

    assert response.status_code == 200, response.text
    assert response.json() == expected
    acknowledge.assert_called_once_with(_SITTING, _USER["id"], "reading")


def test_flush_ack_maps_wrong_owner_to_403():
    with patch(
        "routers.mock_exams.get_supabase_user",
        new=AsyncMock(return_value=_USER),
    ), patch(
        "routers.mock_exams.svc.acknowledge_collection_flush",
        side_effect=PermissionError("Sitting không thuộc về bạn."),
    ):
        response = _client().post(
            f"/api/mock-exams/sittings/{_SITTING}/sections/reading/flush-ack",
            headers=_AUTH,
        )

    assert response.status_code == 403, response.text


def test_flush_ack_maps_non_collected_section_to_409():
    from services.mock_exam_service import SittingConflictError

    with patch(
        "routers.mock_exams.get_supabase_user",
        new=AsyncMock(return_value=_USER),
    ), patch(
        "routers.mock_exams.svc.acknowledge_collection_flush",
        side_effect=SittingConflictError("chưa thu"),
    ):
        response = _client().post(
            f"/api/mock-exams/sittings/{_SITTING}/sections/writing/flush-ack",
            headers=_AUTH,
        )

    assert response.status_code == 409, response.text
