"""Partial-result 200 bodies never echo exception text (PC-J527).

main.py sanitizes 5xx details only. These three admin routes catch an
exception and report it inside a 200 body (per-item partial result), so the
handler never sees it: the message must be static, carry a `ref`, and the
exception must be logged under that ref with exc_info.
"""

import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from routers import admin, admin_reading
from services import reading_prose_import


_DB_ERROR = 'relation "users" column secret_col contains private-db-value'
_INTERNAL = (_DB_ERROR, "relation", "secret_col", "private-db-value")
_ID = "00000000-0000-0000-0000-000000000001"
_RESP_ID = "00000000-0000-0000-0000-000000000002"
_AUTH = {"Authorization": "Bearer fake.admin.jwt"}


@pytest.fixture
def client(monkeypatch):
    import main

    monkeypatch.setattr(admin, "require_admin", AsyncMock(return_value={"id": _ID, "email": "admin@x"}))
    monkeypatch.setattr(admin_reading, "require_admin", AsyncMock(return_value={"id": _ID, "email": "admin@x"}))
    # No lifespan: exercise routing/handlers without startup DB tasks.
    test_client = TestClient(main.app)
    try:
        yield test_client
    finally:
        test_client.close()


def _logged_ref(caplog, logger_name: str, ref: str) -> logging.LogRecord:
    matches = [
        record for record in caplog.records
        if record.name == logger_name
        and record.levelno == logging.ERROR
        and f"ref={ref}" in record.getMessage()
    ]
    assert len(matches) == 1
    record = matches[0]
    assert record.exc_info is not None
    assert str(record.exc_info[1]) == _DB_ERROR
    # The detail lives in the traceback only, not the formatted message.
    assert _DB_ERROR not in record.getMessage()
    return record


def test_bulk_delete_topics_failure_has_ref_not_db_text(monkeypatch, caplog, client):
    db = MagicMock()
    query = MagicMock()
    db.table.return_value = query
    for method in ("select", "in_", "delete"):
        getattr(query, method).return_value = query
    query.execute.side_effect = [
        SimpleNamespace(data=[{"id": _ID, "title": "Travel"}]),
        Exception(_DB_ERROR),
    ]
    monkeypatch.setattr(admin, "supabase_admin", db)

    with caplog.at_level(logging.ERROR, logger=admin.logger.name):
        response = client.post("/admin/topics/bulk-delete", json={"topic_ids": [_ID]}, headers=_AUTH)

    assert response.status_code == 200
    body = response.json()
    assert body["processed_count"] == 1
    assert body["deleted_ids"] == []
    assert body["failed_ids"] == [_ID]
    [error] = body["errors"]
    assert error["code"] == "delete_failed"
    assert error["message"] == "Không xóa được topics, vui lòng thử lại."
    assert error["ref"]
    for internal in _INTERNAL:
        assert internal not in response.text
    _logged_ref(caplog, admin.logger.name, error["ref"])


def test_regrade_session_failure_has_ref_not_exception_text(monkeypatch, caplog, client):
    rows = {
        "sessions": [{"id": _ID, "part": 1, "mode": "practice", "user_id": _ID,
                      "status": "completed", "regrade_count": 0}],
        "questions": [{"id": _ID, "question_text": "Do you like travelling?"}],
        "responses": [{"id": _RESP_ID, "session_id": _ID, "question_id": _ID,
                       "grading_status": "failed", "overall_band": None}],
    }

    def table(name):
        query = MagicMock()
        for method in ("select", "eq", "limit", "update"):
            getattr(query, method).return_value = query
        query.execute.return_value = SimpleNamespace(data=rows.get(name, []))
        return query

    db = MagicMock()
    db.table.side_effect = table
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "_run_regrade_response", AsyncMock(side_effect=Exception(_DB_ERROR)))
    monkeypatch.setattr(admin, "_regrade_incomplete_response_ids", MagicMock(return_value=[]))
    monkeypatch.setattr(admin, "_regrade_compute_session_bands", MagicMock(return_value={
        "overall_band": None, "band_fc": None, "band_lr": None, "band_gra": None, "band_p": None,
    }))
    monkeypatch.setattr(admin, "sync_class_item_score", MagicMock())

    with caplog.at_level(logging.ERROR, logger=admin.logger.name):
        response = client.post(f"/admin/sessions/{_ID}/regrade", headers=_AUTH)

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["partial_failure"] is True
    assert body["failed"] == 1
    [detail] = body["failed_details"]
    prefix = f"{_RESP_ID}: Chấm lại thất bại, vui lòng thử lại. (ref="
    assert detail.startswith(prefix) and detail.endswith(")")
    ref = detail[len(prefix):-1]
    assert ref
    for internal in _INTERNAL:
        assert internal not in response.text
    record = _logged_ref(caplog, admin.logger.name, ref)
    assert _RESP_ID in record.getMessage()
    admin.sync_class_item_score.assert_not_called()


def test_prose_bundle_parse_failure_has_ref_not_exception_text(monkeypatch, caplog, client):
    monkeypatch.setattr(
        reading_prose_import, "build_parsed_reading_test_from_prose",
        MagicMock(side_effect=Exception(_DB_ERROR)),
    )

    with caplog.at_level(logging.ERROR, logger=admin_reading.logger.name):
        response = client.post(
            "/admin/reading/content/import-bundle",
            files={"test_file": ("test.md", b"# Test", "text/markdown"),
                   "solution_file": ("solution.md", b"# Solution", "text/markdown")},
            headers=_AUTH,
        )

    assert response.status_code == 200
    body = response.json()
    assert body["parsed_data"] is None
    assert body["committed_id"] is None
    [error] = body["validation_errors"]
    assert error["field"] == "bundle"
    assert error["message"] == (
        "Không đọc được bộ đề, kiểm tra định dạng file test và solution rồi thử lại."
    )
    assert error["ref"]
    for internal in _INTERNAL:
        assert internal not in response.text
    _logged_ref(caplog, admin_reading.logger.name, error["ref"])
