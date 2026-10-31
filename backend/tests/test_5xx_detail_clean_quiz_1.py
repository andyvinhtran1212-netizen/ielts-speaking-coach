"""quiz_service 5xx errors (slice 1/3) stay safe without main.py's handler."""

import logging
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from services import quiz_service
from services.errors import GENERIC_MESSAGE


_DB_ERROR = 'relation "quiz_sessions" column secret_col contains private-db-value'
_ID = "00000000-0000-0000-0000-000000000001"
_SESSION_ID = "00000000-0000-0000-0000-000000000002"
_ITEM = {"id": _ID, "assignment_id": _ID}
_VOCAB_BANK = {"id": _ID, "code": "V-TEST", "skill_area": "vocab"}
_SESSION = {"id": _SESSION_ID, "user_id": _ID, "bank_id": _ID, "grammar_reset_at": None}
_WRITABLE = {"timed": False, "completion_mode": quiz_service.COURSE_COMPLETION_MASTERY}


def _failing_client(rows_before_error=()):
    client = MagicMock()
    query = MagicMock()
    client.table.return_value = query
    client.rpc.return_value = query
    for method in ("select", "eq", "neq", "limit", "order", "insert", "update",
                   "upsert", "delete"):
        getattr(query, method).return_value = query
    query.execute.side_effect = [
        *(SimpleNamespace(data=rows, count=len(rows)) for rows in rows_before_error),
        Exception(_DB_ERROR),
    ]
    return client


_PROGRESS_PATCHES = {
    "_owned_session": lambda *_a, **_k: dict(_SESSION),
    "_assert_quiz_progress_writable": lambda *_a, **_k: dict(_WRITABLE),
    "_grammar_bank_for_session": lambda *_a, **_k: None,
}


@pytest.mark.parametrize("operation,kwargs,rows_before_error,patches,expected_detail", [
    pytest.param("list_published_banks", {}, (), {},
                 "Lỗi truy vấn bộ câu hỏi. Vui lòng thử lại.", id="list-published-banks"),
    pytest.param("get_bank_for_play", {"bank_id": _ID}, (), {},
                 "Lỗi truy vấn bộ câu hỏi. Vui lòng thử lại.", id="play-bank"),
    pytest.param("get_bank_for_play", {"bank_id": _ID},
                 ([{**_VOCAB_BANK, "is_published": True}],), {},
                 "Lỗi truy vấn câu hỏi. Vui lòng thử lại.", id="play-questions"),
    pytest.param("_save_course_section_result",
                 {"user_id": _ID, "bank_id": _ID, "section": "reading",
                  "answers": {"q1": "A"}, "answer_rows": [{"id": "q1", "answer": "A"}],
                  "duration_sec": 1},
                 (), {"_assignment_item_for": lambda *_a, **_k: dict(_ITEM)},
                 "Lỗi lưu kết quả phần reading. Vui lòng thử lại.", id="course-section-save"),
    pytest.param("_review_course_section_result",
                 {"user_id": _ID, "bank_id": _ID, "section": "reading"},
                 (), {"_assignment_item_for_review": lambda *_a, **_k: dict(_ITEM)},
                 "Lỗi đọc kết quả phần reading. Vui lòng thử lại.", id="course-section-review"),
    pytest.param("course_reading_solution",
                 {"user_id": _ID, "bank_id": _ID, "submitted_answers": {"q1": "A"}},
                 (), {"_bank_meta_or_404": lambda *_a, **_k: {}},
                 "Lỗi đọc đáp án bài đọc. Vui lòng thử lại.", id="course-reading-solution"),
    pytest.param("course_listening_solution",
                 {"user_id": _ID, "bank_id": _ID, "submitted_answers": {"q1": "A"}},
                 (), {"_bank_meta_or_404": lambda *_a, **_k: {}},
                 "Lỗi đọc đáp án bài nghe. Vui lòng thử lại.", id="course-listening-solution"),
    pytest.param("_bank_meta_or_404", {"bank_id": _ID}, (), {},
                 "Lỗi truy vấn bộ câu hỏi. Vui lòng thử lại.", id="bank-meta"),
    pytest.param("_owned_session", {"session_id": _SESSION_ID, "user_id": _ID},
                 (), {}, "Lỗi truy vấn phiên làm bài. Vui lòng thử lại.", id="owned-session"),
    pytest.param("_assert_retake_allowed", {"item": dict(_ITEM)}, (), {},
                 "Lỗi kiểm tra quyền làm bài kiểm tra lại. Vui lòng thử lại.", id="retake-allowed"),
    pytest.param("start_session", {"user_id": _ID, "bank_id": _ID}, ([],),
                 {"_bank_meta_or_404": lambda *_a, **_k: dict(_VOCAB_BANK)},
                 "Lỗi tạo phiên làm bài. Vui lòng thử lại.", id="start-session-insert"),
    pytest.param("get_resume", {"user_id": _ID, "bank_id": _ID}, (), {},
                 "Lỗi đọc tiến độ. Vui lòng thử lại.", id="resume"),
    pytest.param("reset_progress", {"user_id": _ID, "bank_id": _ID}, (),
                 {"_bank_meta_or_404": lambda *_a, **_k: dict(_VOCAB_BANK)},
                 "Lỗi xoá tiến độ. Vui lòng thử lại.", id="reset-progress"),
    pytest.param("_assert_quiz_progress_writable",
                 {"session": {"class_assignment_item_id": _ID}}, (), {},
                 "Lỗi kiểm tra đồng hồ làm bài. Vui lòng thử lại.", id="progress-writable"),
    pytest.param("log_progress",
                 {"user_id": _ID, "session_id": _SESSION_ID,
                  "attempts": [{"item_key": "w1", "is_correct": True}], "word_stats": []},
                 (), _PROGRESS_PATCHES,
                 "Không ghi được câu trả lời. Vui lòng thử lại.", id="log-progress-attempts"),
    pytest.param("log_progress",
                 {"user_id": _ID, "session_id": _SESSION_ID,
                  "attempts": [], "word_stats": [{"item_key": "w1"}]},
                 (), _PROGRESS_PATCHES,
                 "Không ghi được thống kê từ. Vui lòng thử lại.", id="log-progress-word-stats"),
])
def test_direct_quiz_service_5xx_detail_is_clean(
    monkeypatch, caplog, operation, kwargs, rows_before_error, patches, expected_detail,
):
    monkeypatch.setattr(quiz_service, "supabase_admin", _failing_client(rows_before_error))
    for name, replacement in patches.items():
        monkeypatch.setattr(quiz_service, name, replacement)
    backend_errors = []
    monkeypatch.setattr(quiz_service, "_log_backend_error",
                        lambda **kw: backend_errors.append(kw))

    with caplog.at_level(logging.ERROR, logger=quiz_service.logger.name):
        with pytest.raises(HTTPException) as exc_info:
            getattr(quiz_service, operation)(**kwargs)

    error = exc_info.value
    assert error.status_code == 500
    assert isinstance(error.detail, str)
    assert error.detail == expected_detail
    for internal in (_DB_ERROR, "relation", "secret_col", "private-db-value", "quiz_"):
        assert internal not in error.detail
    assert error.__cause__ is None
    assert error.__suppress_context__ is True
    records = [record for record in caplog.records
               if record.name == quiz_service.logger.name
               and record.levelno == logging.ERROR
               and "failed" in record.getMessage()]
    assert records
    assert all(record.exc_info is not None for record in records)
    assert any(str(record.exc_info[1]) == _DB_ERROR for record in records)
    if operation == "log_progress":
        # error_logs persistence is kept alongside the traceback log.
        assert len(backend_errors) == 1


@pytest.mark.parametrize("path", [
    pytest.param("/api/quiz/banks", id="list-banks-main-app"),
    pytest.param(f"/api/quiz/banks/{_ID}/resume", id="resume-main-app"),
])
def test_main_app_preserves_safe_500_shape(monkeypatch, path):
    import main
    from routers import quiz as quiz_router

    async def signed_in(_authorization):
        return {"id": _ID}

    monkeypatch.setattr(quiz_router, "get_supabase_user", signed_in)
    monkeypatch.setattr(quiz_service, "supabase_admin", _failing_client())

    client = TestClient(main.app)
    try:
        response = client.get(path)
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
