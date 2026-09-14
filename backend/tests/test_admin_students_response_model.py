"""Contract coverage for the native admin student directory list."""

from fastapi.routing import APIRoute
from pydantic import ValidationError
import pytest

from models.admin_students import AdminStudentDirectoryRowOut
from routers.admin_students import router


def _row(**overrides):
    value = {
        "id": "student-1",
        "student_code": "C1-001",
        "full_name": "Nguyễn Minh Anh",
        "target_band": 7.0,
        "target_date": "2026-12-01",
        "persona_notes": None,
        "current_band_estimate": 6.0,
        "user_id": "user-1",
        "created_by": "admin-1",
        "created_at": "2026-09-14T00:00:00+00:00",
        "updated_at": "2026-09-14T00:00:00+00:00",
        "flag_count": 1,
        "last_flagged_at": None,
        "is_under_review": False,
        "instructor_id": None,
        "cohort_id": "cohort-1",
        "cohorts": [{"id": "cohort-1", "name": "Khoá 1", "is_primary": True}],
        "cohort_name": "Khoá 1",
        "cohort_lookup_failed": False,
        "membership_lookup_failed": False,
    }
    value.update(overrides)
    return value


def test_admin_students_list_publishes_concrete_response_model():
    route = next(
        item for item in router.routes
        if isinstance(item, APIRoute)
        and item.path == "/admin/students"
        and "GET" in item.methods
    )
    assert route.response_model == list[AdminStudentDirectoryRowOut]


def test_directory_truth_round_trips_without_losing_lookup_failures():
    dumped = AdminStudentDirectoryRowOut.model_validate(_row(
        cohort_name=None,
        cohort_lookup_failed=True,
        membership_lookup_failed=True,
    )).model_dump(mode="json")
    assert dumped["cohorts"][0]["is_primary"] is True
    assert dumped["cohort_name"] is None
    assert dumped["cohort_lookup_failed"] is True
    assert dumped["membership_lookup_failed"] is True


@pytest.mark.parametrize(
    "override",
    [
        {"target_band": 9.5},
        {"flag_count": -1},
        {"cohorts": [{"id": "cohort-1", "name": "Khoá 1"}]},
        {"unexpected": "must not be silently stripped"},
    ],
)
def test_malformed_directory_rows_fail_closed(override):
    with pytest.raises(ValidationError):
        AdminStudentDirectoryRowOut.model_validate(_row(**override))
