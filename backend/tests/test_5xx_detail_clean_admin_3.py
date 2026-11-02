"""Admin slice 3 errors stay safe without main.py's sanitizing handler (PC-J266)."""

import logging
import sys
import types
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from routers import admin
from services.errors import GENERIC_MESSAGE


_DB_ERROR = 'relation "users" column secret_col contains private-db-value'
_ID = "00000000-0000-0000-0000-000000000001"
_TOPIC = [{"id": _ID, "title": "Travel"}]
_QUESTION = [{"id": _ID, "topic_id": _ID, "part": 1,
              "question_text": "Do you like travelling?", "is_active": True}]
_AUDIO = {"audio_url": "https://example.test/a.mp3", "audio_path": "q/a.mp3",
          "synthesized": True}
_GRAMMAR = "Dịch vụ ngữ pháp tạm thời không khả dụng. Vui lòng thử lại."
_QUERY_METHODS = ("select", "eq", "limit", "order", "insert", "update", "delete",
                  "in_", "range", "gte", "lt", "is_", "filter", "or_")


def _prepare(monkeypatch, steps=()):
    """Each step is the rows of one successful execute() or an exception."""
    client = MagicMock()
    query = MagicMock()
    client.table.return_value = query
    for method in _QUERY_METHODS:
        getattr(query, method).return_value = query
    query.execute.side_effect = [
        step if isinstance(step, Exception) else SimpleNamespace(data=step, count=len(step))
        for step in steps
    ] + [Exception(_DB_ERROR)]
    client.storage.from_.return_value.download.side_effect = Exception(_DB_ERROR)
    monkeypatch.setattr(admin, "supabase_admin", client)
    monkeypatch.setattr(admin, "require_admin", AsyncMock(return_value={"id": _ID}))
    # No timestamp write or audio synthesis provider may run in these tests.
    monkeypatch.setattr(admin, "_touch_topic", MagicMock())
    monkeypatch.setattr(admin.speaking_audio, "render_question_audio",
                        MagicMock(return_value=_AUDIO))
    return query


def _fail_grammar_import(monkeypatch):
    def _getattr(name):
        raise Exception(_DB_ERROR)

    broken = types.ModuleType("services.grammar_content")
    broken.__getattr__ = _getattr
    monkeypatch.setitem(sys.modules, "services.grammar_content", broken)


def _legacy_ai_usage_schema(monkeypatch):
    monkeypatch.setattr(admin.ai_usage_logger, "is_legacy_schema_error", lambda exc: True)


_SESSION_FILTERS = {"user_id": None, "user_email": None, "mode": None, "status": None,
                    "error_code": None, "has_error": None, "date_from": None,
                    "date_to": None, "limit": 50, "offset": 0}
_LEGACY_ORIGINAL = Exception(_DB_ERROR)


@pytest.mark.parametrize("operation,kwargs,steps,extra,status,expected_detail", [
    pytest.param("render_topic_question_audio", {"topic_id": _ID, "question_id": _ID},
                 (), None, 500, "Không đọc được câu hỏi. Vui lòng thử lại.",
                 id="render-audio-lookup"),
    pytest.param("render_topic_question_audio", {"topic_id": _ID, "question_id": _ID},
                 (_TOPIC, _QUESTION), None, 502, "Không tạo được audio. Vui lòng thử lại.",
                 id="render-audio-render"),
    pytest.param("render_topic_question_audio", {"topic_id": _ID, "question_id": _ID},
                 (_TOPIC, _QUESTION, _TOPIC), None, 502,
                 "Không tạo được audio. Vui lòng thử lại.", id="render-audio-save"),
    pytest.param("delete_topic_question", {"topic_id": _ID, "question_id": _ID},
                 (), None, 500, "Lỗi khi xóa question. Vui lòng thử lại.",
                 id="delete-question"),
    pytest.param("get_ai_usage", {"days": None}, (), None, 500,
                 "Lỗi khi tải AI usage. Vui lòng thử lại.", id="ai-usage"),
    pytest.param("get_ai_usage", {"days": None}, (_LEGACY_ORIGINAL,),
                 _legacy_ai_usage_schema, 500, "Lỗi khi tải AI usage. Vui lòng thử lại.",
                 id="ai-usage-legacy-fallback"),
    pytest.param("admin_list_sessions", {**_SESSION_FILTERS, "user_email": "a@example.test"},
                 (), None, 500, "Lỗi khi tra email học viên. Vui lòng thử lại.",
                 id="list-sessions-email"),
    pytest.param("admin_list_sessions", _SESSION_FILTERS, (), None, 500,
                 "Lỗi khi tải sessions. Vui lòng thử lại.", id="list-sessions"),
    pytest.param("admin_get_session", {"session_id": _ID}, (), None, 500,
                 "Lỗi khi tải session. Vui lòng thử lại.", id="get-session"),
    pytest.param("admin_get_alerts", {"limit": 30}, (), None, 500,
                 "Lỗi khi tải session errors. Vui lòng thử lại.", id="alerts-session-errors"),
    pytest.param("admin_get_alerts", {"limit": 30}, ([],), None, 500,
                 "Lỗi khi tải grading failures. Vui lòng thử lại.",
                 id="alerts-grading-failures"),
    pytest.param("_run_regrade_response",
                 {"resp": {"id": _ID, "transcript": "", "audio_storage_path": "u/s/r.webm"},
                  "session": {"part": 1, "user_id": _ID}, "question_text": "Why?",
                  "admin_email": "admin@example.test"},
                 None, None, 502, f"Response {_ID}: không thể tải audio. Vui lòng thử lại.",
                 id="regrade-audio-download"),
    pytest.param("admin_patch_d1_question",
                 {"question_id": _ID, "payload": admin.D1QuestionPatchPayload(hint="h")},
                 (), None, 500, "Không cập nhật được câu hỏi D1. Vui lòng thử lại.",
                 id="d1-patch"),
    pytest.param("admin_delete_d1_question", {"question_id": _ID}, (), None, 500,
                 "Không xoá được câu hỏi D1. Vui lòng thử lại.", id="d1-delete"),
    pytest.param("admin_create_lemma_override",
                 {"payload": admin.LemmaOverridePayload(original_word="Ran", lemma="run")},
                 (), None, 500, "Không tạo được lemma override. Vui lòng thử lại.",
                 id="lemma-create"),
    pytest.param("admin_delete_lemma_override", {"override_id": _ID}, (), None, 500,
                 "Không xoá được lemma override. Vui lòng thử lại.", id="lemma-delete"),
    pytest.param("admin_list_grammar_articles", {"category": None, "search": None},
                 None, _fail_grammar_import, 500, _GRAMMAR, id="grammar-list"),
    pytest.param("admin_preview_grammar_article", {"slug": "present-perfect"},
                 None, _fail_grammar_import, 500, _GRAMMAR, id="grammar-preview"),
    pytest.param("admin_grammar_analytics", {"days": 7},
                 None, _fail_grammar_import, 500, _GRAMMAR, id="grammar-analytics"),
    pytest.param("admin_grammar_recommend_test",
                 {"payload": admin.GrammarRecommendPayload(issue="missing article")},
                 None, _fail_grammar_import, 500, _GRAMMAR, id="grammar-recommend"),
])
@pytest.mark.asyncio
async def test_direct_router_5xx_detail_is_clean(
    monkeypatch, caplog, operation, kwargs, steps, extra, status, expected_detail,
):
    # steps=None: the failure is outside the table query chain (Storage/import).
    query = _prepare(monkeypatch, steps or ())
    if extra:
        extra(monkeypatch)

    with caplog.at_level(logging.ERROR, logger=admin.logger.name):
        with pytest.raises(HTTPException) as exc_info:
            await getattr(admin, operation)(**kwargs)

    error = exc_info.value
    assert error.status_code == status
    assert error.detail == expected_detail
    for internal in (_DB_ERROR, "relation", "secret_col", "private-db-value", "users"):
        assert internal not in error.detail
    assert error.__cause__ is None
    assert error.__suppress_context__ is True
    assert str(error.__context__) == _DB_ERROR
    assert query.execute.call_count == (0 if steps is None else len(steps) + 1)
    admin._touch_topic.assert_not_called()
    assert any(
        record.name == admin.logger.name
        and record.levelno == logging.ERROR
        and "failed" in record.getMessage()
        and record.exc_info is not None
        and record.exc_info[1] is error.__context__
        for record in caplog.records
    )


@pytest.mark.asyncio
async def test_ai_usage_legacy_fallback_logs_original_and_fallback_errors(monkeypatch, caplog):
    original = Exception("original " + _DB_ERROR)
    _prepare(monkeypatch, (original,))
    _legacy_ai_usage_schema(monkeypatch)

    with caplog.at_level(logging.ERROR, logger=admin.logger.name):
        with pytest.raises(HTTPException) as exc_info:
            await admin.get_ai_usage(days=None)

    fallback = exc_info.value.__context__
    assert str(fallback) == _DB_ERROR
    logged = [record.exc_info[1] for record in caplog.records
              if record.levelno == logging.ERROR and record.exc_info]
    assert original in logged
    assert fallback in logged


def test_main_app_preserves_safe_500_shape(monkeypatch):
    import main

    query = _prepare(monkeypatch)
    # No lifespan: exercise routing/handlers without startup DB tasks.
    client = TestClient(main.app)
    try:
        response = client.get(f"/admin/sessions/{_ID}")
    finally:
        client.close()

    assert query.execute.call_count == 1
    assert response.status_code == 500
    assert response.json() == {"detail": {
        "error_code": "internal_error",
        "message": GENERIC_MESSAGE,
        "ref": response.headers["X-Request-ID"],
    }}
    assert response.json()["detail"]["ref"]
    for internal in (_DB_ERROR, "relation", "secret_col", "private-db-value", "users"):
        assert internal not in response.text
