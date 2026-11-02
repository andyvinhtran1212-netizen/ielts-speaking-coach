"""Admin slice 2 errors stay safe without main.py's sanitizing handler (PC-J265)."""

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
_CODE = [{"id": _ID, "code": "AVR-TEST", "is_revoked": False}]
_QUESTION = [{"id": _ID, "part": 1, "question_text": "Do you like travelling?"}]


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
    # No audit or topic timestamp write may run once a step has failed.
    monkeypatch.setattr(admin, "_audit_entitlement", MagicMock())
    monkeypatch.setattr(admin, "_touch_topic", MagicMock())
    return query


@pytest.mark.parametrize("operation,kwargs,rows_before_error,expected_detail", [
    pytest.param("delete_access_code", {"code_id": _ID},
                 (), "Lỗi khi tải access code. Vui lòng thử lại.", id="revoke-load"),
    pytest.param("delete_access_code", {"code_id": _ID},
                 (_CODE, []), "Lỗi khi thu hồi access code. Vui lòng thử lại.", id="revoke-update"),
    pytest.param("get_access_code_detail", {"code_id": _ID},
                 (), "Lỗi khi tải access code. Vui lòng thử lại.", id="code-detail"),
    pytest.param("remove_user_from_code", {"code_id": _ID, "user_id": _ID},
                 (), "Lỗi khi gỡ user khỏi code. Vui lòng thử lại.", id="remove-user"),
    pytest.param("hard_delete_access_code", {"code_id": _ID},
                 (), "Lỗi khi tải access code. Vui lòng thử lại.", id="hard-delete-load"),
    pytest.param("hard_delete_access_code", {"code_id": _ID},
                 (_CODE, [], []), "Lỗi khi xóa access code. Vui lòng thử lại.",
                 id="hard-delete-code"),
    pytest.param("get_access_code_audit", {"code_id": _ID},
                 (), "Lỗi khi tải lịch sử chỉnh sửa. Vui lòng thử lại.", id="code-audit"),
    pytest.param("list_topics", {}, (),
                 "Lỗi khi tải topics. Vui lòng thử lại.", id="list-topics"),
    pytest.param("create_topic", {"body": admin.CreateTopicRequest(title="Travel", part=1)},
                 (), "Lỗi khi tạo topic. Vui lòng thử lại.", id="create-topic"),
    pytest.param("patch_topic",
                 {"topic_id": _ID, "body": admin.PatchTopicRequest(title="Travel")},
                 (), "Lỗi khi cập nhật topic. Vui lòng thử lại.", id="patch-topic"),
    pytest.param("delete_topic", {"topic_id": _ID},
                 (), "Lỗi khi xóa topic. Vui lòng thử lại.", id="delete-topic"),
    pytest.param("bulk_delete_topics", {"body": admin.BulkTopicIdsRequest(topic_ids=[_ID])},
                 (), "Lỗi khi tải topics. Vui lòng thử lại.", id="bulk-delete-load"),
    pytest.param("bulk_add_topics", {"body": admin.BulkAddTopicsRequest(part=1, lines="Travel")},
                 (), "Lỗi khi thêm topics. Vui lòng thử lại.", id="bulk-add"),
    pytest.param("list_topic_questions", {"topic_id": _ID},
                 (), "Lỗi khi tải questions. Vui lòng thử lại.", id="list-questions"),
    pytest.param("create_topic_question",
                 {"topic_id": _ID, "body": admin.CreateTopicQuestionRequest(
                     part=1, question_text="Do you like travelling?")},
                 (), "Không xác định được thứ tự câu hỏi. Vui lòng thử lại.",
                 id="create-question-order"),
    pytest.param("create_topic_question",
                 {"topic_id": _ID, "body": admin.CreateTopicQuestionRequest(
                     part=1, question_text="Do you like travelling?", order_num=1)},
                 (), "Lỗi khi tạo question. Vui lòng thử lại.", id="create-question-insert"),
    pytest.param("update_topic_question",
                 {"topic_id": _ID, "question_id": _ID,
                  "body": admin.UpdateTopicQuestionRequest(question_text="Why?")},
                 (), "Lỗi khi tải question hiện tại. Vui lòng thử lại.",
                 id="update-question-load"),
    pytest.param("update_topic_question",
                 {"topic_id": _ID, "question_id": _ID,
                  "body": admin.UpdateTopicQuestionRequest(question_text="Why?")},
                 (_QUESTION,), "Lỗi khi cập nhật question. Vui lòng thử lại.",
                 id="update-question-write"),
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
    for internal in (_DB_ERROR, "relation", "secret_col", "private-db-value", "users"):
        assert internal not in error.detail
    assert error.__cause__ is None
    assert error.__suppress_context__ is True
    assert str(error.__context__) == _DB_ERROR
    assert query.execute.call_count == len(rows_before_error) + 1
    admin._audit_entitlement.assert_not_called()
    admin._touch_topic.assert_not_called()
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
        response = client.get(f"/admin/access-codes/{_ID}/audit")
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
