"""Admin slice 1 errors stay safe without main.py's sanitizing handler (PC-J264)."""

import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from routers import admin
from services.errors import GENERIC_MESSAGE


_DB_ERROR = 'relation "users" column secret_col contains private-db-value'
_ID = "00000000-0000-0000-0000-000000000001"
_TOPIC = [{"id": _ID, "title": "Travel", "part": 1}]
_SESSION = [{"id": _ID, "user_id": _ID, "topic": "Staging live failure injection"}]
_OWNER = [{"email": "student@staging-e2e.averlearning.com"}]


def _prepare(monkeypatch, rows_before_error=()):
    client = MagicMock()
    query = MagicMock()
    client.table.return_value = query
    for method in ("select", "eq", "limit", "order", "insert", "update", "delete", "in_"):
        getattr(query, method).return_value = query
    query.execute.side_effect = [
        *(SimpleNamespace(data=rows, count=len(rows)) for rows in rows_before_error),
        Exception(_DB_ERROR),
    ]
    monkeypatch.setattr(admin, "supabase_admin", client)
    monkeypatch.setattr(admin, "require_admin", AsyncMock(return_value={"id": _ID}))
    monkeypatch.setattr(admin.settings, "ENVIRONMENT", "staging")
    monkeypatch.setattr(admin.settings, "SUPABASE_URL", f"https://{admin._STAGING_E2E_SUPABASE_HOST}")
    monkeypatch.setattr(admin, "generate_part1_questions", AsyncMock(return_value=[{
        "question_text": "Do you like travelling?",
    }]))
    # Keep the best-effort timestamp write separate from the saved-question read.
    monkeypatch.setattr(admin, "_touch_topic", MagicMock())
    return query


@pytest.mark.parametrize("operation,kwargs,rows_before_error,expected_detail", [
    pytest.param("_replace_topic_questions_with_visibility_swap",
                 {"topic_id": _ID, "rows": [{"question_text": "Travel?"}], "existing_rows": []},
                 (), "Lỗi khi lưu questions mới. Vui lòng thử lại.", id="swap-insert"),
    pytest.param("_generate_questions_for_topic",
                 {"topic_id": _ID, "user_id": _ID, "replace_existing": False},
                 (), "Lỗi khi tải topic. Vui lòng thử lại.", id="generate-topic-load"),
    pytest.param("_generate_questions_for_topic",
                 {"topic_id": _ID, "user_id": _ID, "replace_existing": False},
                 (_TOPIC,), "Lỗi khi kiểm tra questions hiện tại. Vui lòng thử lại.",
                 id="generate-existing-questions"),
    pytest.param("_generate_questions_for_topic",
                 {"topic_id": _ID, "user_id": _ID, "replace_existing": False},
                 (_TOPIC, []), "Lỗi khi lưu questions. Vui lòng thử lại.", id="generate-insert"),
    pytest.param("_generate_questions_for_topic",
                 {"topic_id": _ID, "user_id": _ID, "replace_existing": False},
                 (_TOPIC, [], []), "Lỗi khi tải questions đã lưu. Vui lòng thử lại.",
                 id="generate-saved-questions"),
    pytest.param("admin_cleanup_e2e_session", {"session_id": _ID},
                 (), "Không thể kiểm tra E2E session. Vui lòng thử lại.", id="cleanup-session"),
    pytest.param("admin_cleanup_e2e_session", {"session_id": _ID},
                 (_SESSION,), "Không thể kiểm tra chủ E2E session. Vui lòng thử lại.",
                 id="cleanup-owner"),
    pytest.param("admin_cleanup_e2e_session", {"session_id": _ID},
                 (_SESSION, _OWNER), "Không thể kiểm tra audio E2E session. Vui lòng thử lại.",
                 id="cleanup-audio"),
    pytest.param("admin_cleanup_e2e_session", {"session_id": _ID},
                 (_SESSION, _OWNER, []), "Không thể cleanup E2E session. Vui lòng thử lại.",
                 id="cleanup-delete"),
    pytest.param("list_users", {}, (),
                 "Lỗi khi tải danh sách users. Vui lòng thử lại.", id="list-users"),
    pytest.param("get_stats", {}, (),
                 "Lỗi khi tải stats. Vui lòng thử lại.", id="stats"),
    pytest.param("generate_access_codes", {"body": admin.GenerateCodesRequest(count=1)},
                 ([],), "Lỗi khi tạo access codes. Vui lòng thử lại.", id="generate-codes"),
    pytest.param("list_access_codes", {}, (),
                 "Lỗi khi tải access codes. Vui lòng thử lại.", id="list-codes"),
    pytest.param("list_unassigned_codes", {}, (),
                 "Lỗi khi tải pool mã. Vui lòng thử lại.", id="pool-codes"),
    pytest.param("patch_access_code", {"code_id": _ID, "body": admin.PatchCodeRequest(notes="Test")},
                 ([],), "Lỗi khi cập nhật access code. Vui lòng thử lại.", id="patch-code"),
])
@pytest.mark.asyncio
async def test_direct_router_5xx_detail_is_clean(
    monkeypatch, caplog, operation, kwargs, rows_before_error, expected_detail,
):
    query = _prepare(monkeypatch, rows_before_error)

    with caplog.at_level(logging.ERROR, logger=admin.logger.name):
        with pytest.raises(HTTPException) as exc_info:
            await getattr(admin, operation)(**kwargs)

    error = exc_info.value
    assert error.status_code == 500
    assert error.detail == expected_detail
    for internal in (_DB_ERROR, "relation", "secret_col", "private-db-value"):
        assert internal not in error.detail
    # The requested list_users message itself contains the static noun "users".
    # The exact-detail assertion above also rules out appended driver text.
    assert "users" not in error.detail.replace("danh sách users", "danh sách")
    assert error.__cause__ is None
    assert error.__suppress_context__ is True
    assert str(error.__context__) == _DB_ERROR
    assert query.execute.call_count == len(rows_before_error) + 1
    assert any(
        record.name == admin.logger.name
        and record.levelno == logging.ERROR
        and "failed" in record.getMessage()
        and record.exc_info is not None
        and record.exc_info[1] is error.__context__
        for record in caplog.records
    )


def test_main_app_preserves_safe_500_shape(monkeypatch):
    import main

    query = _prepare(monkeypatch)
    # No lifespan: exercise routing/handlers without startup DB tasks.
    client = TestClient(main.app)
    try:
        response = client.get("/admin/stats")
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
