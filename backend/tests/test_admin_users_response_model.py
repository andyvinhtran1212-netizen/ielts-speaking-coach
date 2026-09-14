"""Contract coverage for the native admin user directory response."""

from fastapi.routing import APIRoute
from pydantic import ValidationError
import pytest

from models.admin_users import AdminUserDirectoryRowOut
from routers.admin import router


def _row(**overrides):
    value = {
        "id": "user-1",
        "email": "learner@example.test",
        "display_name": None,
        "created_at": "2026-09-14T00:00:00+00:00",
        "is_active": True,
        "role": "user",
        "sessions_today": 2,
        "cohort_name": None,
        "cohort_names": [],
        "cohort_lookup_failed": False,
        "code_summary": {
            "codes": [{"id": "code-1", "code": "AVER-1", "code_type": "mass"}],
            "code_count": 1,
            "code_type": "mass",
            "permissions": ["practice_single"],
            "has_active_code": True,
        },
    }
    value.update(overrides)
    return value


def test_admin_users_get_publishes_concrete_response_model():
    route = next(
        item for item in router.routes
        if isinstance(item, APIRoute)
        and item.path == "/admin/users"
        and "GET" in item.methods
    )
    assert route.response_model == list[AdminUserDirectoryRowOut]


def test_legacy_user_role_and_sparse_code_projection_round_trip():
    value = AdminUserDirectoryRowOut.model_validate(_row())
    dumped = value.model_dump(mode="json")
    assert dumped["role"] == "user"
    assert dumped["code_summary"]["codes"][0]["permissions"] == []
    assert dumped["code_summary"]["codes"][0]["created_at"] is None


@pytest.mark.parametrize(
    "override",
    [
        {"sessions_today": -1},
        {"role": "owner"},
        {"unexpected": "would be silently stripped without strict validation"},
    ],
)
def test_malformed_directory_rows_fail_closed(override):
    with pytest.raises(ValidationError):
        AdminUserDirectoryRowOut.model_validate(_row(**override))
