"""Service errors stay safe even without main.py's HTTPException handler."""

import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from services import student_service, topic_service
from services.errors import GENERIC_MESSAGE


_DB_ERROR = 'relation "users" column secret_col contains private-db-value'
_ID = "00000000-0000-0000-0000-000000000001"
_ROW = [{"id": _ID}]


def _failing_client(rows_before_error=()):
    client = MagicMock()
    query = MagicMock()
    client.table.return_value = query
    client.rpc.return_value = query
    for method in ("select", "eq", "limit", "order", "insert", "update", "delete"):
        getattr(query, method).return_value = query
    query.execute.side_effect = [
        *(SimpleNamespace(data=rows, count=len(rows)) for rows in rows_before_error),
        Exception(_DB_ERROR),
    ]
    return client


@pytest.mark.parametrize("service,operation,kwargs,rows_before_error", [
    pytest.param(student_service, "create_student",
                 {"data": {"user_id": _ID}, "admin_id": _ID}, (), id="student-lookup"),
    pytest.param(student_service, "create_student",
                 {"data": {"student_code": "S001", "full_name": "Test"}, "admin_id": _ID},
                 (), id="student-insert"),
    pytest.param(student_service, "update_student",
                 {"student_id": _ID, "data": {"full_name": "Test"}}, (), id="student-update"),
    pytest.param(student_service, "archive_student",
                 {"student_id": _ID, "actor_id": _ID}, (), id="student-archive"),
    pytest.param(student_service, "restore_student",
                 {"student_id": _ID, "actor_id": _ID}, (), id="student-restore"),
    pytest.param(topic_service, "list_topics", {}, (), id="topic-list"),
    pytest.param(topic_service, "get_topic", {"topic_id": _ID}, (), id="topic-get"),
    pytest.param(topic_service, "create_topic", {"title": "Test"}, (), id="topic-create"),
    pytest.param(topic_service, "update_topic",
                 {"topic_id": _ID, "data": {"title": "Test"}}, (_ROW,), id="topic-update"),
    pytest.param(topic_service, "_row_count",
                 {"table": "vocab_cards", "topic_id": _ID}, (), id="topic-count"),
    pytest.param(topic_service, "delete_topic",
                 {"topic_id": _ID}, (_ROW, [], []), id="topic-delete"),
    pytest.param(topic_service, "get_topic_bundle",
                 {"topic_id": _ID}, (_ROW,), id="topic-bundle-cards"),
    pytest.param(topic_service, "get_topic_bundle",
                 {"topic_id": _ID}, (_ROW, []), id="topic-bundle-banks"),
])
def test_direct_service_5xx_detail_is_clean(
    monkeypatch, caplog, service, operation, kwargs, rows_before_error,
):
    client = _failing_client(rows_before_error)
    monkeypatch.setattr(service, "supabase_admin", client)

    with caplog.at_level(logging.ERROR, logger=service.logger.name):
        with pytest.raises(HTTPException) as exc_info:
            getattr(service, operation)(**kwargs)

    error = exc_info.value
    assert error.status_code == 500
    assert isinstance(error.detail, str)
    for internal in (_DB_ERROR, "relation", "secret_col", "private-db-value",
                     "users", "vocab_cards", "quiz_banks", "content_topics"):
        assert internal not in error.detail
    assert error.__cause__ is None
    assert error.__suppress_context__ is True
    assert any(record.name == service.logger.name
               and record.levelno == logging.ERROR
               and "failed" in record.getMessage()
               for record in caplog.records)


@pytest.mark.parametrize("service,router_name,method,path,request_kwargs", [
    pytest.param(student_service, "admin_students", "patch", f"/admin/students/{_ID}",
                 {"json": {"full_name": "Test"}}, id="student-main-app"),
    pytest.param(topic_service, "admin_topics", "get", f"/admin/content-topics/{_ID}",
                 {}, id="topic-main-app"),
])
def test_main_app_preserves_safe_500_shape(
    monkeypatch, service, router_name, method, path, request_kwargs,
):
    import main
    from routers import admin_students, admin_topics

    router = {"admin_students": admin_students, "admin_topics": admin_topics}[router_name]
    monkeypatch.setattr(router, "require_admin", AsyncMock(return_value={"id": _ID}))
    monkeypatch.setattr(service, "supabase_admin", _failing_client())

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
