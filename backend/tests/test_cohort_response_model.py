"""Response-model coverage for `/admin/cohorts` picker and rollup modes."""

from fastapi.routing import APIRoute
from pydantic import ValidationError
import pytest

from models.cohorts import AdminCohortListOut
from routers.cohorts import router


def _base_row():
    return {
        "id": "cohort-1",
        "name": "Khoá 1",
        "code_prefix": "C1",
        "description": None,
        "is_active": True,
        "created_by": None,
        "created_at": "2026-09-14T00:00:00+00:00",
        "updated_at": "2026-09-14T00:00:00+00:00",
        "course_id": None,
    }


def test_route_uses_one_superset_and_preserves_picker_shape():
    route = next(
        item for item in router.routes
        if isinstance(item, APIRoute) and item.path == "/admin/cohorts"
    )
    assert route.response_model is AdminCohortListOut
    assert route.response_model_exclude_unset is True

    value = AdminCohortListOut.model_validate({"cohorts": [_base_row()]})
    dumped = value.model_dump(mode="json", exclude_unset=True)
    assert "course" not in dumped["cohorts"][0]
    assert "member_count" not in dumped["cohorts"][0]
    assert "rollup_failed" not in dumped


def test_rollup_mode_keeps_course_counts_and_failure_truth():
    row = {
        **_base_row(),
        "course_id": "course-1",
        "course": {
            "id": "course-1",
            "code": "C1",
            "name": "Khóa nền tảng tiếng Anh",
            "sort_order": 1,
            "is_active": True,
        },
        "member_count": None,
        "unactivated_count": None,
    }
    dumped = AdminCohortListOut.model_validate({
        "cohorts": [row],
        "rollup_failed": True,
    }).model_dump(mode="json", exclude_unset=True)
    assert dumped["cohorts"][0]["course"]["code"] == "C1"
    assert dumped["cohorts"][0]["member_count"] is None
    assert dumped["rollup_failed"] is True


@pytest.mark.parametrize(
    "payload",
    [
        {"cohorts": [{**_base_row(), "member_count": -1}]},
        {"cohorts": [{**_base_row(), "unknown": True}]},
        {"cohorts": "not-a-list"},
    ],
)
def test_malformed_cohort_payloads_fail_closed(payload):
    with pytest.raises(ValidationError):
        AdminCohortListOut.model_validate(payload)
