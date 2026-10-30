"""Course quiz 5xx errors (slice 2/3) stay safe without main.py's handler."""

import inspect
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from services import quiz_service
from services.errors import GENERIC_MESSAGE


_DB_ERROR = 'relation "quiz_sessions" column secret_col contains private-db-value'
_ID = "00000000-0000-0000-0000-000000000001"
_SESSION_ID = "00000000-0000-0000-0000-000000000002"
_ITEM = {"id": _ID, "assignment_id": _ID}
_WRITING_QUESTIONS = [{"qid": "W1", "prompt": "Rewrite the sentence."}]
_WRITING_KWARGS = {"user_id": _ID, "bank_id": _ID, "answers": {"W1": "I study English."}}
_RECEIPT_ERROR = "Kết quả đã chấm nhưng chưa thu được bài; hãy thử lại"


def _failing_client(rows_before_error=()):
    client = MagicMock()
    query = MagicMock()
    client.table.return_value = query
    for method in ("select", "eq", "is_", "limit", "order", "insert", "update", "upsert"):
        getattr(query, method).return_value = query
    query.execute.side_effect = [
        *(SimpleNamespace(data=rows, count=len(rows)) for rows in rows_before_error),
        Exception(_DB_ERROR),
    ]
    return client


@pytest.fixture
def course_preconditions(monkeypatch):
    """Bypass access/shape lookups; keep the 15 failing service blocks real."""
    for name in ("_bank_meta_or_404", "_bank_meta_for_review_or_404"):
        monkeypatch.setattr(quiz_service, name, lambda *_a, **_k: {"id": _ID})
    for name in ("_assignment_item_for", "_assignment_item_for_review"):
        monkeypatch.setattr(quiz_service, name, lambda *_a, **_k: dict(_ITEM))
    monkeypatch.setattr(quiz_service, "_owned_session", lambda *_a: {
        "id": _SESSION_ID, "user_id": _ID, "bank_id": _ID,
    })
    monkeypatch.setattr(quiz_service, "_grammar_bank_for_session", lambda *_a: None)
    monkeypatch.setattr(quiz_service, "course_required_sections", lambda *_a: ["writing"])
    monkeypatch.setattr(quiz_service, "mark_item_submitted", lambda *_a, **_k: False)
    monkeypatch.setattr(quiz_service.course_writing_grader, "grade", AsyncMock(return_value=(
        [{"qid": "W1", "ok": True}], "mock-grader",
    )))


@pytest.mark.parametrize("operation,kwargs,rows_before_error,expected_detail", [
    pytest.param("_assert_course_session_accepting",
                 {"session": {"class_assignment_item_id": _ID}}, (),
                 "Lỗi kiểm tra hạn nộp. Vui lòng thử lại.", id="submission-deadline"),
    pytest.param("end_session",
                 {"user_id": _ID, "session_id": _SESSION_ID, "data": {}}, (),
                 "Lỗi kết thúc phiên làm bài. Vui lòng thử lại.", id="end-session"),
    pytest.param("course_writing_state", {"user_id": _ID, "bank_id": _ID}, (),
                 "Lỗi đọc phần tự luận. Vui lòng thử lại.", id="writing-state"),
    pytest.param("save_course_writing_draft", _WRITING_KWARGS, (),
                 "Lỗi kiểm lượt nộp. Vui lòng thử lại.", id="draft-submission-check"),
    pytest.param("save_course_writing_draft", _WRITING_KWARGS, ([],),
                 "Lỗi lưu nháp. Vui lòng thử lại.", id="draft-save"),
    pytest.param("submit_course_writing", _WRITING_KWARGS, (),
                 "Lỗi đọc đề tự luận. Vui lòng thử lại.", id="writing-questions"),
    pytest.param("submit_course_writing", _WRITING_KWARGS, (_WRITING_QUESTIONS,),
                 "Lỗi kiểm lượt nộp. Vui lòng thử lại.", id="writing-submission-check"),
    pytest.param("submit_course_writing", _WRITING_KWARGS, (_WRITING_QUESTIONS, []),
                 "Lỗi lưu bài tự luận. Vui lòng thử lại.", id="writing-save"),
    pytest.param("_course_live_required_sections", {"bank_id": _ID}, (),
                 "Lỗi đọc cấu trúc bài tập. Vui lòng thử lại.", id="course-structure"),
    pytest.param("begin_course_full_retry", {"user_id": _ID, "bank_id": _ID}, (),
                 "Không mở được lượt làm lại. Vui lòng thử lại.", id="full-retry"),
    pytest.param("_course_completion_evidence",
                 {"bank_id": _ID, "item_id": _ID, "user_id": _ID, "attempt": None}, (),
                 "Lỗi đọc kết quả các phần. Vui lòng thử lại.", id="section-results"),
    pytest.param("_ensure_course_result_receipt",
                 {"item": _ITEM, "artifact_kind": "course_writing", "artifact_id": _ID,
                  "score": 100, "error_message": _RECEIPT_ERROR}, (),
                 _RECEIPT_ERROR, id="result-receipt"),
    pytest.param("refresh_course_completion",
                 {"user_id": _ID, "bank_id": _ID, "item_id": _ID}, (),
                 "Lỗi đọc sổ hoàn thành. Vui lòng thử lại.", id="completion-read"),
    pytest.param("refresh_course_completion",
                 {"user_id": _ID, "bank_id": _ID, "item_id": _ID},
                 ([_ITEM], [{}], [], [], []),
                 "Lỗi ghi sổ hoàn thành. Vui lòng thử lại.", id="completion-write"),
    pytest.param("course_verdict",
                 {"user_id": _ID, "bank_id": _ID, "session_ids": [_SESSION_ID]}, (),
                 "Lỗi đọc dữ liệu xét đạt. Vui lòng thử lại.", id="verdict-read"),
])
@pytest.mark.asyncio
async def test_direct_quiz_service_5xx_detail_is_clean(
    monkeypatch, caplog, course_preconditions,
    operation, kwargs, rows_before_error, expected_detail,
):
    client = _failing_client(rows_before_error)
    monkeypatch.setattr(quiz_service, "supabase_admin", client)
    if operation == "begin_course_full_retry":
        monkeypatch.setattr(quiz_service, "_assignment_item_for", lambda *_a, **_k: {
            **_ITEM, "mastery": {"attempts": [
                {"attempt_no": 1, "completed": True, "pct": 40, "next_action": "retry_full"},
            ]},
        })

    with caplog.at_level(logging.ERROR, logger="services.quiz_service"):
        with pytest.raises(HTTPException) as exc_info:
            result = getattr(quiz_service, operation)(**kwargs)
            if inspect.isawaitable(result):
                await result

    error = exc_info.value
    assert error.status_code == 500
    assert isinstance(error.detail, str)
    assert error.detail == expected_detail
    for internal in ("relation", "secret_col", "private-db-value", "quiz_"):
        assert internal not in error.detail
    assert error.__cause__ is None
    assert error.__suppress_context__ is True
    assert client.table.return_value.execute.call_count == len(rows_before_error) + 1
    records = [record for record in caplog.records
               if record.name == "services.quiz_service" and record.levelno == logging.ERROR]
    assert records
    assert all(record.exc_info is not None for record in records)
    assert any(str(record.exc_info[1]) == _DB_ERROR for record in records)


@pytest.mark.parametrize("method,path,request_kwargs", [
    pytest.param("get", "/api/quiz/course/writing", {"params": {"bank_id": _ID}},
                 id="writing-state-main-app"),
    pytest.param("patch", f"/api/quiz/sessions/{_SESSION_ID}", {"json": {}},
                 id="end-session-main-app"),
])
def test_main_app_preserves_safe_500_shape(
    monkeypatch, course_preconditions, method, path, request_kwargs,
):
    import main
    from routers import quiz as quiz_router

    monkeypatch.setattr(quiz_router, "get_supabase_user", AsyncMock(return_value={"id": _ID}))
    monkeypatch.setattr(quiz_service, "supabase_admin", _failing_client())

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
    for internal in ("relation", "secret_col", "private-db-value", "quiz_"):
        assert internal not in response.text
