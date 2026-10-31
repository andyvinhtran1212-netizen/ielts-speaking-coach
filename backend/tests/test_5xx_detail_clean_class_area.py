"""Class-area 5xx errors stay safe even without main.py's HTTPException handler.

Each route is called directly (no main.py handler) with the database or the
service it delegates to raising a PostgREST-shaped error. The HTTPException
must carry only a static Vietnamese message, drop the chained cause, and the
real error must reach the module logger with its traceback.
"""

import asyncio
import inspect
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from routers import admin_class_assignments as assignments
from routers import admin_class_lessons as lessons
from routers import class_student
from services.errors import GENERIC_MESSAGE


_DB_ERROR = 'relation "users" column secret_col contains private-db-value'
_COHORT = "00000000-0000-0000-0000-00000000c001"
_ASSIGNMENT = "00000000-0000-0000-0000-00000000a001"
_ID = "00000000-0000-0000-0000-000000000001"
_INTERNAL = (_DB_ERROR, "relation", "secret_col", "private-db-value", "users",
             "class_assignments", "class_assignment_items", "class_lessons",
             "class_action_log", "fn_delete_class_assignment_if_unsubmitted",
             "quiz_course_bank_assignment_revision")


def _failing_client(rows_before_error=()):
    client = MagicMock()
    query = MagicMock()
    client.table.return_value = query
    client.rpc.return_value = query
    for method in ("select", "eq", "in_", "limit", "order", "insert", "update", "delete"):
        getattr(query, method).return_value = query
    query.execute.side_effect = [
        *(SimpleNamespace(data=rows, count=len(rows)) for rows in rows_before_error),
        Exception(_DB_ERROR),
    ]
    return client


def _raise(*_args, **_kwargs):
    raise Exception(_DB_ERROR)


def _admin_router(monkeypatch, module, rows_before_error=()):
    monkeypatch.setattr(module, "require_admin", AsyncMock(return_value={"id": _ID}))
    monkeypatch.setattr(module, "_require_cohort", lambda _cohort_id: None)
    monkeypatch.setattr(module, "supabase_admin", _failing_client(rows_before_error))


# ── per-site setup: (module, callable, kwargs) after arranging the failure ──

def _list_assignments_read(mp):
    _admin_router(mp, assignments)
    return assignments, assignments.list_assignments, {"cohort_id": _COHORT}


def _list_assignments_progress(mp):
    _admin_router(mp, assignments, ([{"id": _ASSIGNMENT}],))
    for name in ("reconcile_ledger_from_sessions", "reconcile_test_attempts",
                 "reconcile_course_items"):
        mp.setattr(assignments, name, lambda *_a, **_k: None)
    mp.setattr(assignments, "progress_for_assignments", _raise)
    return assignments, assignments.list_assignments, {"cohort_id": _COHORT}


def _course_bank_revision(mp):
    _admin_router(mp, assignments)
    return assignments, assignments._course_bank_assignment_revision, {"bank_id": _ID}


def _return_student_work(mp):
    _admin_router(mp, assignments, (
        [{"id": _ASSIGNMENT, "cohort_id": _COHORT, "status": "published"}],
        [{"id": _ID, "artifact_kind": "session", "artifact_id": None}],
    ))
    mp.setattr(assignments, "is_accepting_submissions", lambda _asg: True)
    mp.setattr(assignments, "return_item_to_student", _raise)
    return assignments, assignments.return_student_work, {
        "cohort_id": _COHORT, "assignment_id": _ASSIGNMENT, "student_id": _ID}


def _create_assignment(mp):
    _admin_router(mp, assignments)
    mp.setattr(assignments, "_resolve_speaking_topic", lambda *_a: (_ID, {}))
    mp.setattr(assignments, "create_class_assignment", _raise)
    return assignments, assignments.create_assignment, {
        "cohort_id": _COHORT,
        "body": assignments.AssignmentCreate(skill="speaking", title="Test", content_id=_ID)}


def _backfill_assignment(mp):
    _admin_router(mp, assignments, ([{"id": _ASSIGNMENT, "cohort_id": _COHORT}],))
    mp.setattr(assignments, "backfill_assignment_items", _raise)
    return assignments, assignments.backfill_assignment, {
        "cohort_id": _COHORT, "assignment_id": _ASSIGNMENT,
        "body": assignments.BackfillBody()}


def _update_assignment(mp):
    _admin_router(mp, assignments)
    return assignments, assignments.update_assignment, {
        "cohort_id": _COHORT, "assignment_id": _ASSIGNMENT,
        "body": assignments.AssignmentPatch(status="archived")}


def _class_action_log(mp):
    _admin_router(mp, assignments)
    mp.setattr(assignments, "read_class_actions", _raise)
    return assignments, assignments.class_action_log, {
        "cohort_id": _COHORT, "limit": 50, "before": None}


def _update_assignment_due(mp):
    _admin_router(mp, assignments)
    mp.setattr(assignments, "change_assignment_due_at", _raise)
    return assignments, assignments.update_assignment_due, {
        "cohort_id": _COHORT, "assignment_id": _ASSIGNMENT,
        "body": assignments.DuePatch(due_date="2026-11-01", due_time="19:00")}


def _delete_assignment(mp):
    _admin_router(mp, assignments)
    return assignments, assignments.delete_assignment, {
        "cohort_id": _COHORT, "assignment_id": _ASSIGNMENT}


def _my_assignments(mp):
    mp.setattr(class_student, "get_supabase_user", AsyncMock(return_value={"id": _ID}))
    mp.setattr(class_student, "_student_for_user", lambda *_a: {"id": _ID})
    mp.setattr(class_student, "active_cohort_ids_for_student", lambda *_a: [_COHORT])
    mp.setattr(class_student, "_visible_assignments", _raise)
    return class_student, class_student.my_assignments, {"authorization": "Bearer t"}


def _list_lessons(mp):
    _admin_router(mp, lessons)
    return lessons, lessons.list_lessons, {"cohort_id": _COHORT}


def _create_lesson(mp):
    _admin_router(mp, lessons)
    return lessons, lessons.create_lesson, {
        "cohort_id": _COHORT, "body": lessons.LessonCreate(title="Test")}


def _update_lesson(mp):
    _admin_router(mp, lessons)
    return lessons, lessons.update_lesson, {
        "cohort_id": _COHORT, "lesson_id": _ID, "body": lessons.LessonPatch(title="Test")}


def _delete_lesson(mp):
    _admin_router(mp, lessons)
    return lessons, lessons.delete_lesson, {"cohort_id": _COHORT, "lesson_id": _ID}


@pytest.mark.parametrize("arrange,expected_detail", [
    pytest.param(_list_assignments_read, "Lỗi khi tải bài giao. Vui lòng thử lại.", id="assignments-list"),
    pytest.param(_list_assignments_progress, "Lỗi khi tính tiến độ nộp bài. Vui lòng thử lại.", id="assignments-progress"),
    pytest.param(_course_bank_revision, "Không đọc được phiên bản bộ bài tập. Vui lòng thử lại.", id="assignments-course-bank-revision"),
    pytest.param(_return_student_work, "Lỗi khi trả bài. Vui lòng thử lại.", id="assignments-return"),
    pytest.param(_create_assignment, "Lỗi khi giao bài. Vui lòng thử lại.", id="assignments-create"),
    pytest.param(_backfill_assignment, "Lỗi khi bù người nhận. Vui lòng thử lại.", id="assignments-backfill"),
    pytest.param(_update_assignment, "Lỗi khi cập nhật bài giao. Vui lòng thử lại.", id="assignments-update"),
    pytest.param(_class_action_log, "Lỗi khi đọc nhật ký thao tác. Vui lòng thử lại.", id="assignments-action-log"),
    pytest.param(_update_assignment_due, "Lỗi khi đổi hạn. Vui lòng thử lại.", id="assignments-due"),
    pytest.param(_delete_assignment, "Lỗi khi xoá bài giao. Vui lòng thử lại.", id="assignments-delete"),
    pytest.param(_my_assignments, "Lỗi khi tải bài tập. Vui lòng thử lại.", id="class-student-my-assignments"),
    pytest.param(_list_lessons, "Lỗi khi tải buổi học. Vui lòng thử lại.", id="lessons-list"),
    pytest.param(_create_lesson, "Lỗi khi tạo buổi học. Vui lòng thử lại.", id="lessons-create"),
    pytest.param(_update_lesson, "Lỗi khi cập nhật buổi học. Vui lòng thử lại.", id="lessons-update"),
    pytest.param(_delete_lesson, "Lỗi khi xoá buổi học. Vui lòng thử lại.", id="lessons-delete"),
])
def test_direct_router_5xx_detail_is_clean(monkeypatch, caplog, arrange, expected_detail):
    module, operation, kwargs = arrange(monkeypatch)
    if "authorization" in inspect.signature(operation).parameters:
        kwargs.setdefault("authorization", "Bearer t")

    with caplog.at_level(logging.ERROR, logger=module.logger.name):
        with pytest.raises(HTTPException) as exc_info:
            result = operation(**kwargs)
            if inspect.iscoroutine(result):
                asyncio.run(result)

    error = exc_info.value
    assert error.status_code == 500
    assert error.detail == expected_detail
    for internal in _INTERNAL:
        assert internal not in error.detail
    assert error.__cause__ is None
    assert error.__suppress_context__ is True
    assert any(record.name == module.logger.name
               and record.levelno == logging.ERROR
               and "failed" in record.getMessage()
               and record.exc_info is not None
               for record in caplog.records)


@pytest.mark.parametrize("router_name,method,path,request_kwargs", [
    pytest.param("admin_class_assignments", "patch",
                 f"/admin/cohorts/{_COHORT}/assignments/{_ASSIGNMENT}",
                 {"json": {"status": "archived"}}, id="assignments-main-app"),
    pytest.param("admin_class_lessons", "delete",
                 f"/admin/cohorts/{_COHORT}/lessons/{_ID}", {}, id="lessons-main-app"),
    pytest.param("class_student", "get", "/api/class/my-assignments", {},
                 id="class-student-main-app"),
])
def test_main_app_preserves_safe_500_shape(
    monkeypatch, router_name, method, path, request_kwargs,
):
    import main

    if router_name == "class_student":
        _my_assignments(monkeypatch)
    else:
        router = {"admin_class_assignments": assignments,
                  "admin_class_lessons": lessons}[router_name]
        _admin_router(monkeypatch, router)

    client = TestClient(main.app)
    try:
        response = getattr(client, method)(path, **request_kwargs)
    finally:
        client.close()

    assert response.status_code == 500
    assert response.json() == {"detail": {
        "error_code": "internal_error",
        "message": GENERIC_MESSAGE,
        "ref": response.headers["X-Request-ID"],
    }}
    assert response.json()["detail"]["ref"]
    for internal in (_DB_ERROR, "relation", "secret_col", "private-db-value"):
        assert internal not in response.text
