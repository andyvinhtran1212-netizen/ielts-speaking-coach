"""Contract coverage for the admin Writing grading queue list."""

from fastapi.routing import APIRoute
from pydantic import ValidationError
import pytest

from models.admin_writing_queue import AdminWritingQueuePageOut, AdminWritingQueueRowOut
from routers.admin_writing import router


def _row(**overrides):
    value = {
        "id": "essay-1",
        "student_id": "student-1",
        "task_type": "task2",
        "status": "graded",
        "analysis_level": 3,
        "selected_model": "gemini-2.5-pro",
        "word_count": 285,
        "created_at": "2026-09-14T00:00:00+00:00",
        "delivered_at": None,
        "error_message": None,
        "sitting_id": None,
        "grading_skipped_at": None,
        "student_full_name": "Nguyễn Minh Anh",
        "student_code": "C1-001",
        "band": 6.5,
        "deadline": "2026-09-20T00:00:00+00:00",
        "task1_image_missing": False,
    }
    value.update(overrides)
    return value


def test_writing_essay_list_publishes_concrete_response_model():
    route = next(
        item for item in router.routes
        if isinstance(item, APIRoute)
        and item.path == "/admin/writing/essays"
        and "GET" in item.methods
    )
    assert route.response_model == list[AdminWritingQueueRowOut]

    page_route = next(
        item for item in router.routes
        if isinstance(item, APIRoute)
        and item.path == "/admin/writing/essay-queue"
        and "GET" in item.methods
    )
    assert page_route.response_model == AdminWritingQueuePageOut


def test_queue_operational_truth_round_trips():
    dumped = AdminWritingQueueRowOut.model_validate(_row(
        status="failed",
        error_message="grader unavailable",
        task1_image_missing=True,
    )).model_dump(mode="json")
    assert dumped["status"] == "failed"
    assert dumped["error_message"] == "grader unavailable"
    assert dumped["task1_image_missing"] is True


@pytest.mark.parametrize(
    "override",
    [
        {"status": "unknown"},
        {"analysis_level": 6},
        {"band": 9.5},
        {"word_count": -1},
        {"unexpected": "must not be silently stripped"},
    ],
)
def test_malformed_queue_rows_fail_closed(override):
    with pytest.raises(ValidationError):
        AdminWritingQueueRowOut.model_validate(_row(**override))
