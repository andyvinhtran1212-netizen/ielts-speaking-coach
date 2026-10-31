"""Router DB errors stay safe without main.py's sanitizing handler (PC-J251)."""

import inspect
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from fastapi import BackgroundTasks, HTTPException
from fastapi.testclient import TestClient

from routers import admin_courses, admin_quiz, admin_writing, grammar
from services.errors import GENERIC_MESSAGE


_DB_ERROR = 'relation "users" column secret_col contains private-db-value'
_ID = "00000000-0000-0000-0000-000000000001"
_ROW = [{"id": _ID}]
_WRITING_DETAIL = "Không cập nhật được dữ liệu bài viết. Vui lòng thử lại."
_INTERNALS = (
    "relation", "secret_col", "private-db-value", "users", "writing_essays",
    "writing_feedback_current", "quiz_banks", "quiz_questions", "courses",
    "grammar_recommendations", "article_views", "saved_articles",
)
_FEEDBACK = {
    "overallBandScore": 7.0,
    "overallBandScoreSummary": "Bài viết rõ ràng.",
    "keyTakeaways": {"strengths": ["Clarity"], "areasForImprovement": ["Grammar"]},
    "criteriaFeedback": {
        name: {"title": name, "explanation": "Clear", "feedback": "Clear", "bandScore": 7}
        for name in ("mainCriterion", "coherenceCohesion", "lexicalResource", "grammaticalRange")
    },
    "mistakeAnalysis": [],
    "aiContentAnalysis": {"likelihood": 5, "explanation": "Natural"},
    "improvedEssay": "An improved essay.",
}


def _failing_client(rows_before_error=()):
    client = MagicMock()
    query = MagicMock()
    client.table.return_value = query
    for method in (
        "select", "eq", "is_", "limit", "order", "insert", "update", "delete",
        "upsert", "gte", "in_",
    ):
        getattr(query, method).return_value = query
    query.execute.side_effect = [
        *(SimpleNamespace(data=rows, count=len(rows)) for rows in rows_before_error),
        Exception(_DB_ERROR),
    ]
    return client


def _prepare(monkeypatch, module, rows_before_error=()):
    client = _failing_client(rows_before_error)
    monkeypatch.setattr(module, "supabase_admin", client)
    if module is grammar:
        monkeypatch.setattr(module, "get_supabase_user", AsyncMock(return_value={"id": _ID}))
        monkeypatch.setattr(module.grammar_service, "get_article_by_slug", lambda slug: {
            "slug": slug, "title": "Present simple", "category": "tenses",
        })
    else:
        monkeypatch.setattr(module, "require_admin", AsyncMock(return_value={"id": _ID}))
    if module is admin_writing:
        # The version-budget read belongs to a separate service client.
        monkeypatch.setattr(module.essay_service, "live_version_count", lambda essay_id: 1)
    return client


@pytest.mark.parametrize("module,operation,kwargs,rows_before_error,expected_detail", [
    pytest.param(admin_writing, "_revoke_essay", {"essay_id": _ID},
                 ([{"status": "delivered"}],), _WRITING_DETAIL, id="writing-revoke"),
    pytest.param(admin_writing, "update_feedback", {"essay_id": UUID(_ID), "edits": _FEEDBACK},
                 ([{"status": "graded"}], [{"feedback_json": _FEEDBACK}]),
                 _WRITING_DETAIL, id="writing-feedback"),
    pytest.param(admin_writing, "update_instructor_note",
                 {"essay_id": UUID(_ID), "body": admin_writing.InstructorNoteUpdate(instructor_note="Note")},
                 ([{"status": "graded"}],), _WRITING_DETAIL, id="writing-instructor-note"),
    pytest.param(admin_writing, "trigger_regrade",
                 {"essay_id": UUID(_ID), "background_tasks": BackgroundTasks()},
                 ([{"id": _ID, "status": "graded"}],), _WRITING_DETAIL, id="writing-regrade"),
    pytest.param(admin_quiz, "list_banks", {"topic_id": None, "skill_area": None}, (),
                 "Lỗi truy vấn banks. Vui lòng thử lại.", id="quiz-list"),
    pytest.param(admin_quiz, "get_bank", {"bank_id": UUID(_ID)}, (),
                 "Lỗi truy vấn bank. Vui lòng thử lại.", id="quiz-get"),
    pytest.param(admin_quiz, "update_bank",
                 {"bank_id": UUID(_ID), "body": admin_quiz.BankUpdate(title="Test")}, (),
                 "Lỗi cập nhật bank. Vui lòng thử lại.", id="quiz-update"),
    pytest.param(admin_quiz, "delete_bank", {"bank_id": UUID(_ID)}, (_ROW,),
                 "Lỗi xoá bank. Vui lòng thử lại.", id="quiz-delete"),
    pytest.param(admin_courses, "list_courses", {"is_active": None}, (),
                 "Lỗi khi tải danh sách khoá học. Vui lòng thử lại.", id="course-list"),
    pytest.param(admin_courses, "create_course",
                 {"body": admin_courses.CourseCreate(code="TEST", name="Test")}, (),
                 "Lỗi khi tạo khoá học. Vui lòng thử lại.", id="course-create"),
    pytest.param(admin_courses, "update_course",
                 {"course_id": _ID, "body": admin_courses.CoursePatch(name="Test")}, (),
                 "Lỗi khi cập nhật khoá học. Vui lòng thử lại.", id="course-update"),
    pytest.param(grammar, "mark_recommendation_clicked", {"rec_id": _ID}, (),
                 "Lỗi cập nhật recommendation. Vui lòng thử lại.", id="grammar-click"),
    pytest.param(grammar, "track_article_view",
                 {"slug": "present-simple", "body": grammar.ViewBody()}, (),
                 "Lỗi track view. Vui lòng thử lại.", id="grammar-view"),
    pytest.param(grammar, "save_article", {"slug": "present-simple"}, (),
                 "Lỗi lưu bài. Vui lòng thử lại.", id="grammar-save"),
    pytest.param(grammar, "unsave_article", {"slug": "present-simple"}, (),
                 "Lỗi xóa bài đã lưu. Vui lòng thử lại.", id="grammar-unsave"),
    pytest.param(grammar, "get_dashboard_data", {}, (),
                 "Lỗi truy vấn dữ liệu. Vui lòng thử lại.", id="grammar-dashboard"),
])
@pytest.mark.asyncio
async def test_direct_router_5xx_detail_is_clean(
    monkeypatch, caplog, module, operation, kwargs, rows_before_error, expected_detail,
):
    client = _prepare(monkeypatch, module, rows_before_error)

    with caplog.at_level(logging.ERROR, logger=module.__name__):
        with pytest.raises(HTTPException) as exc_info:
            result = getattr(module, operation)(**kwargs)
            if inspect.isawaitable(result):
                await result

    error = exc_info.value
    assert error.status_code == 500
    assert isinstance(error.detail, str)
    assert error.detail == expected_detail
    for internal in _INTERNALS:
        assert internal not in error.detail
    assert error.__cause__ is None
    assert error.__suppress_context__ is True
    # Prove the intended DB failure was reached, rather than an earlier guard.
    assert str(error.__context__) == _DB_ERROR
    assert client.table.return_value.execute.call_count == len(rows_before_error) + 1
    assert any(
        record.name == module.__name__
        and record.levelno == logging.ERROR
        and "failed" in record.getMessage()
        and record.exc_info is not None
        and record.exc_info[1] is error.__context__
        for record in caplog.records
    )


@pytest.mark.parametrize("module,method,path,request_kwargs,rows_before_error", [
    pytest.param(admin_writing, "patch", f"/admin/writing/essays/{_ID}/instructor-note",
                 {"json": {"instructor_note": "Note"}}, ([{"status": "graded"}],),
                 id="writing-main-app"),
    pytest.param(admin_quiz, "get", "/admin/quiz/banks", {}, (), id="quiz-main-app"),
    pytest.param(admin_courses, "get", "/admin/courses", {}, (), id="courses-main-app"),
    pytest.param(grammar, "get", "/api/grammar/dashboard-data", {}, (), id="grammar-main-app"),
])
def test_main_app_preserves_safe_500_shape(
    monkeypatch, module, method, path, request_kwargs, rows_before_error,
):
    import main

    _prepare(monkeypatch, module, rows_before_error)
    # No lifespan: these tests exercise routing/handlers without startup DB tasks.
    client = TestClient(main.app)
    try:
        response = client.request(method, path, **request_kwargs)
    finally:
        client.close()

    assert response.status_code == 500
    assert response.json() == {"detail": {
        "error_code": "internal_error",
        "message": GENERIC_MESSAGE,
        "ref": response.headers["X-Request-ID"],
    }}
    assert response.json()["detail"]["ref"]
    for internal in _INTERNALS:
        assert internal not in response.text
