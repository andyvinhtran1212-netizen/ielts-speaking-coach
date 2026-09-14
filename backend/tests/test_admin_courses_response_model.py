"""Contract coverage for the admin course ladder list."""

from fastapi.routing import APIRoute
from pydantic import ValidationError
import pytest

from models.admin_courses import AdminCourseListOut, AdminCourseOut
from routers.admin_courses import router


def _course(**overrides):
    value = {
        "id": "course-1",
        "code": "C1",
        "name": "Khóa nền tảng tiếng Anh",
        "description": None,
        "sort_order": 1,
        "is_active": True,
        "created_by": None,
        "created_at": "2026-09-14T00:00:00+00:00",
        "updated_at": "2026-09-14T00:00:00+00:00",
    }
    value.update(overrides)
    return value


def test_admin_courses_get_publishes_concrete_response_model():
    route = next(
        item for item in router.routes
        if isinstance(item, APIRoute)
        and item.path == "/admin/courses"
        and "GET" in item.methods
    )
    assert route.response_model is AdminCourseListOut


def test_course_ladder_fields_round_trip():
    dumped = AdminCourseListOut.model_validate({"courses": [_course()]}) \
        .model_dump(mode="json")
    assert dumped["courses"][0]["code"] == "C1"
    assert dumped["courses"][0]["sort_order"] == 1
    assert dumped["courses"][0]["is_active"] is True


@pytest.mark.parametrize(
    "override",
    [
        {"id": None},
        {"is_active": "not-a-boolean"},
        {"unexpected": "must not be silently stripped"},
    ],
)
def test_malformed_course_rows_fail_closed(override):
    with pytest.raises(ValidationError):
        AdminCourseOut.model_validate(_course(**override))
