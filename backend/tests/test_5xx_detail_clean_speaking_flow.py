"""Speaking-flow router 5xx stay safe even without main.py's HTTPException handler."""

import asyncio
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from routers import export, grading, pronunciation, questions
from services.errors import GENERIC_MESSAGE


_DB_ERROR = 'relation "users" column secret_col contains private-db-value'
_ID = "00000000-0000-0000-0000-000000000001"
_SESSION = {"id": _ID, "user_id": _ID, "part": 1, "topic": "Hometown",
            "mode": "practice", "status": "in_progress", "started_at": None,
            "class_assignment_item_id": None,
            "resume_expires_at": "2999-01-01T00:00:00+00:00"}
_QUESTION = {"id": _ID, "session_id": _ID, "question_text": "Q?"}
_INTERNAL = (_DB_ERROR, "relation", "secret_col", "private-db-value", "users",
             "sessions", "questions", "responses", "load_session",
             "load_question", "entitlement")


def _failing_client(rows_before_error=()):
    client = MagicMock()
    query = MagicMock()
    client.table.return_value = query
    for method in ("select", "eq", "in_", "limit", "order", "insert"):
        getattr(query, method).return_value = query
    query.execute.side_effect = [
        *(SimpleNamespace(data=rows) for rows in rows_before_error),
        Exception(_DB_ERROR),
    ]
    return client


def _admit(monkeypatch, module):
    monkeypatch.setattr(module, "get_supabase_user", AsyncMock(return_value={"id": _ID}))
    monkeypatch.setattr(module, "require_speaking_entitlement", lambda *_a: None)
    if hasattr(module, "require_resume_active"):
        monkeypatch.setattr(module, "require_resume_active", lambda *_a: None)


def _patch_questions(monkeypatch, rows_before_error, *, pinned=()):
    _admit(monkeypatch, questions)
    monkeypatch.setattr(questions, "supabase_admin", _failing_client(rows_before_error))
    monkeypatch.setattr(questions, "_load_pinned_class_questions",
                        lambda *_a: [dict(row) for row in pinned])
    monkeypatch.setattr(questions, "_load_from_library", lambda *_a: [])
    monkeypatch.setattr(questions, "generate_part1_questions",
                        AsyncMock(return_value=[{"question_text": "Q?"}]))


def _patch_grading(monkeypatch, rows_before_error, *, entitlement_error=False):
    _admit(monkeypatch, grading)
    db = _failing_client(rows_before_error)

    async def execute(builder):
        return builder(db).execute()
    monkeypatch.setattr(grading, "aexecute", execute)
    if entitlement_error:
        def guard(*_a):
            raise Exception(_DB_ERROR)
        monkeypatch.setattr(grading, "require_speaking_entitlement", guard)


def _patch_pronunciation(monkeypatch, rows_before_error):
    _admit(monkeypatch, pronunciation)
    monkeypatch.setattr(pronunciation, "supabase_admin", _failing_client(rows_before_error))


def _patch_export(monkeypatch, rows_before_error, *, pdf_error=False):
    monkeypatch.setattr(export, "get_supabase_user", AsyncMock(return_value={"id": _ID}))
    monkeypatch.setattr(export, "supabase_admin", _failing_client(rows_before_error))
    if pdf_error:
        monkeypatch.setattr(export, "generate_session_pdf",
                            AsyncMock(side_effect=RuntimeError(_DB_ERROR)))


def _q_generate(mp, rows, **kw):
    _patch_questions(mp, rows, **kw)
    return questions.generate_questions(_ID, None)


def _q_custom(mp, rows):
    _patch_questions(mp, rows)
    return questions.save_custom_questions(_ID, questions._CustomQBody(questions=["Q?"]), None)


def _q_list(mp, rows):
    _patch_questions(mp, rows)
    return questions.list_questions(_ID, None)


def _grade(mp, rows, **kw):
    _patch_grading(mp, rows, **kw)
    upload = SimpleNamespace(filename="a.webm", content_type="audio/webm",
                             read=AsyncMock(return_value=b"audio"))
    return grading.grade_response_endpoint(_ID, _ID, upload)


def _pron(mp, rows):
    _patch_pronunciation(mp, rows)
    return pronunciation.assess_full_test_pronunciation(_ID, body=pronunciation.FullPronRequest())


def _export(mp, rows, **kw):
    _patch_export(mp, rows, **kw)
    return export.export_session_pdf(_ID, None)


@pytest.mark.parametrize("module,call", [
    pytest.param(questions, lambda mp: _q_generate(mp, ()), id="questions-generate-session"),
    pytest.param(questions, lambda mp: _q_generate(mp, ([_SESSION],)),
                 id="questions-generate-existing"),
    pytest.param(questions, lambda mp: _q_generate(mp, ([_SESSION], []), pinned=[_QUESTION]),
                 id="questions-generate-pinned-insert"),
    pytest.param(questions, lambda mp: _q_generate(mp, ([_SESSION], [])),
                 id="questions-generate-insert"),
    pytest.param(questions, lambda mp: _q_custom(mp, ()), id="questions-custom-session"),
    pytest.param(questions, lambda mp: _q_custom(mp, ([_SESSION],)),
                 id="questions-custom-insert"),
    pytest.param(questions, lambda mp: _q_list(mp, ()), id="questions-list-session"),
    pytest.param(questions, lambda mp: _q_list(mp, ([_SESSION],)),
                 id="questions-list-questions"),
    pytest.param(grading, lambda mp: _grade(mp, ()), id="grading-session"),
    pytest.param(grading, lambda mp: _grade(mp, ([_SESSION],)), id="grading-question"),
    pytest.param(grading, lambda mp: _grade(mp, ([_SESSION], [_QUESTION]),
                                            entitlement_error=True),
                 id="grading-unexpected-step"),
    pytest.param(pronunciation, lambda mp: _pron(mp, ()), id="pronunciation-session"),
    pytest.param(pronunciation, lambda mp: _pron(mp, ([_SESSION],)),
                 id="pronunciation-responses"),
    pytest.param(export, lambda mp: _export(mp, ()), id="export-session"),
    pytest.param(export, lambda mp: _export(mp, ([_SESSION],), pdf_error=True),
                 id="export-pdf"),
])
def test_direct_router_5xx_detail_is_clean(monkeypatch, caplog, module, call):
    with caplog.at_level(logging.ERROR, logger=module.logger.name):
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(call(monkeypatch))

    error = exc_info.value
    assert error.status_code == 500
    assert isinstance(error.detail, str)
    assert error.detail.endswith("Vui lòng thử lại.")
    for internal in _INTERNAL:
        assert internal not in error.detail
    assert error.__cause__ is None
    assert error.__suppress_context__ is True
    assert any(record.name == module.logger.name
               and record.levelno == logging.ERROR
               and record.exc_info is not None
               for record in caplog.records)


_MAIN_APP = {
    "questions": (questions, _patch_questions, "get", f"/sessions/{_ID}/questions", {}),
    "grading": (grading, _patch_grading, "post", f"/sessions/{_ID}/responses", {
        "data": {"question_id": _ID},
        "files": {"audio_file": ("a.webm", b"audio", "audio/webm")},
    }),
    "pronunciation": (pronunciation, _patch_pronunciation, "post",
                      f"/sessions/{_ID}/pronunciation/full", {"json": {}}),
    "export": (export, _patch_export, "get", f"/sessions/{_ID}/export/pdf", {}),
}


@pytest.mark.parametrize("router_name", sorted(_MAIN_APP))
def test_main_app_preserves_safe_500_shape(monkeypatch, caplog, router_name):
    import main

    module, patch, method, path, request_kwargs = _MAIN_APP[router_name]
    patch(monkeypatch, ())
    client = TestClient(main.app)
    try:
        with caplog.at_level(logging.ERROR, logger=module.logger.name):
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
    # The 500 came from the patched router failure, not from an unrelated path.
    assert any(record.name == module.logger.name and record.levelno == logging.ERROR
               for record in caplog.records)
