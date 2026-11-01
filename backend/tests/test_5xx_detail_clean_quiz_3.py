"""Course quiz 5xx errors (slice 3/3) stay safe without main.py's handler."""

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
_AT = "2026-10-30T00:00:00+00:00"
_ITEM = {"id": _ID, "assignment_id": _ID}
_LEDGER = {"id": _ID, "passed_at": None, "submitted_at": None, "mastery": {},
           "score": None, "updated_at": _AT}
_SESSION = {"id": _SESSION_ID, "user_id": _ID, "bank_id": _ID,
            "class_assignment_item_id": _ID, "kind": "run", "ended_by": "completed",
            "created_at": _AT, "ended_at": _AT, "duration_sec": 10}
# Reads course_verdict makes before its CAS write: assignment, sessions, ledger,
# answer key, saved attempts.
_VERDICT_READS = (
    [{"id": _ID, "content_config": {}}],
    [_SESSION],
    [_LEDGER],
    [{"qid": "Q1", "answer": 0, "type": "mcq"}],
    [{"session_id": _SESSION_ID, "qid": "Q1", "answer_given": "0", "created_at": _AT}],
)
_VERDICT_KWARGS = {"user_id": _ID, "bank_id": _ID, "session_ids": [_SESSION_ID]}
_WRONG_ATTEMPT = [{"bank_id": _ID, "session_id": _SESSION_ID, "qid": "Q1",
                   "item_key": "w1", "answer_given": "B", "created_at": _AT}]


def _failing_client(rows_before_error=()):
    client = MagicMock()
    query = MagicMock()
    client.table.return_value = query
    client.rpc.return_value = query
    for method in ("select", "eq", "in_", "is_", "limit", "order", "range", "update"):
        getattr(query, method).return_value = query
    query.not_ = query
    query.execute.side_effect = [
        *(SimpleNamespace(data=rows, count=len(rows)) for rows in rows_before_error),
        Exception(_DB_ERROR),
    ]
    return client


def _quiz_only_evidence(**kwargs):
    quiz = kwargs["attempt"]["sections"]["quiz"]
    return ["quiz"], {"quiz": quiz}, {"quiz": _SESSION_ID}


def _passed_two_section_evidence(**kwargs):
    quiz = kwargs["attempt"]["sections"]["quiz"]
    writing = {"completed": True, "pct": 100.0, "duration_sec": 0}
    return ["quiz", "writing"], {"quiz": quiz, "writing": writing}, {"quiz": _SESSION_ID}


@pytest.mark.parametrize("operation,kwargs,rows_before_error,expected_detail,evidence", [
    pytest.param("course_verdict", _VERDICT_KWARGS, _VERDICT_READS,
                 "Lỗi ghi kết luận. Vui lòng thử lại.", _quiz_only_evidence,
                 id="verdict-write"),
    pytest.param("course_verdict", _VERDICT_KWARGS, (*_VERDICT_READS, []),
                 "Lỗi đọc lại sổ sau tranh chấp ghi. Vui lòng thử lại.",
                 _quiz_only_evidence, id="verdict-conflict-reread"),
    pytest.param("course_verdict", _VERDICT_KWARGS, (*_VERDICT_READS, [_LEDGER]),
                 "Đã đạt nhưng chưa xác nhận được trạng thái thu bài. Vui lòng thử lại.",
                 _passed_two_section_evidence, id="verdict-hand-in-check"),
    pytest.param("bank_analytics", {"bank_id": _ID}, (),
                 "Lỗi truy vấn thống kê. Vui lòng thử lại.", None, id="bank-analytics"),
    pytest.param("admin_student_rollup", {}, (),
                 "Lỗi truy vấn tổng hợp học viên. Vui lòng thử lại.", None,
                 id="rollup"),
    pytest.param("admin_student_rollup", {}, ([{"user_id": _ID}],),
                 "Lỗi truy vấn học viên. Vui lòng thử lại.", None, id="rollup-users"),
    pytest.param("admin_student_detail", {"user_id": _ID}, ([], [], []),
                 "Lỗi truy vấn phiên của học viên. Vui lòng thử lại.", None,
                 id="student-detail-sessions"),
    pytest.param("_bank_ids_for_skill", {"skill_area": "vocab"}, (),
                 "Lỗi truy vấn bộ câu hỏi theo kỹ năng. Vui lòng thử lại.", None,
                 id="banks-for-skill"),
    pytest.param("student_mistakes", {"user_id": _ID}, (),
                 "Lỗi truy vấn câu đã trả lời sai. Vui lòng thử lại.", None,
                 id="mistakes-attempts"),
    pytest.param("student_mistakes", {"user_id": _ID}, (_WRONG_ATTEMPT,),
                 "Lỗi truy vấn bộ câu hỏi. Vui lòng thử lại.", None, id="mistakes-banks"),
    pytest.param("student_mistakes", {"user_id": _ID},
                 (_WRONG_ATTEMPT, [{"id": _ID, "skill_area": "vocab"}]),
                 "Lỗi truy vấn câu hỏi. Vui lòng thử lại.", None, id="mistakes-questions"),
    pytest.param("_sealed_course_session_ids", {"session_ids": [_SESSION_ID]}, (),
                 "Lỗi kiểm tra trạng thái nộp bài. Vui lòng thử lại.", None,
                 id="sealed-course-sessions"),
    pytest.param("student_progress", {"user_id": _ID}, (),
                 "Lỗi truy vấn tiến độ. Vui lòng thử lại.", None, id="progress"),
    pytest.param("student_progress", {"user_id": _ID},
                 ([{"bank_id": _ID, "mastered": 1, "in_progress": 0}],),
                 "Lỗi truy vấn bộ câu hỏi. Vui lòng thử lại.", None, id="progress-banks"),
    pytest.param("student_progress", {"user_id": _ID}, ([],),
                 "Lỗi truy vấn phiên. Vui lòng thử lại.", None, id="progress-sessions"),
    pytest.param("student_progress", {"user_id": _ID}, ([], []),
                 "Lỗi truy vấn tổng hợp phiên. Vui lòng thử lại.", None,
                 id="progress-session-totals"),
])
def test_direct_quiz_service_5xx_detail_is_clean(
    monkeypatch, caplog, operation, kwargs, rows_before_error, expected_detail, evidence,
):
    client = _failing_client(rows_before_error)
    monkeypatch.setattr(quiz_service, "supabase_admin", client)
    monkeypatch.setattr(quiz_service, "_assignment_item_for", lambda *_a, **_k: dict(_ITEM))
    monkeypatch.setattr(quiz_service, "mark_item_submitted", lambda *_a, **_k: False)
    if evidence is not None:
        monkeypatch.setattr(quiz_service, "_course_completion_evidence", evidence)

    with caplog.at_level(logging.ERROR, logger="services.quiz_service"):
        with pytest.raises(HTTPException) as exc_info:
            getattr(quiz_service, operation)(**kwargs)

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


@pytest.mark.parametrize("path", [
    pytest.param("/api/quiz/progress", id="progress-main-app"),
    pytest.param("/admin/quiz/students", id="rollup-main-app"),
])
def test_main_app_preserves_safe_500_shape(monkeypatch, path):
    import main
    from routers import admin_quiz
    from routers import quiz as quiz_router

    monkeypatch.setattr(quiz_router, "get_supabase_user", AsyncMock(return_value={"id": _ID}))
    monkeypatch.setattr(admin_quiz, "require_admin", AsyncMock(return_value={"id": _ID}))
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
    for internal in ("relation", "secret_col", "private-db-value", "quiz_"):
        assert internal not in response.text
