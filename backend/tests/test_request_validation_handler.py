"""PC-J188: global 422 errors expose diagnostics without rejected values."""

import asyncio
import json
from unittest.mock import MagicMock

import pytest
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from starlette.requests import Request

import main
from routers import error_logs


MARKER = "SECRET-MARKER-422"


@pytest.fixture
def client(monkeypatch):
    # Invalid anonymous reports must stop before persistence or 5xx logging.
    db = MagicMock()
    db.table.side_effect = AssertionError("invalid report reached the database")
    log_insert = MagicMock()
    monkeypatch.setattr(error_logs, "supabase_admin", db)
    monkeypatch.setattr(main, "_insert_error_log_safely", log_insert)
    yield TestClient(main.app, raise_server_exceptions=False)
    db.table.assert_not_called()
    log_insert.assert_not_called()


@pytest.mark.parametrize(("body", "field", "error_type"), [
    ({"message": MARKER * 130}, "message", "string_too_long"),
    ({"message": {"nested": MARKER}}, "message", "string_type"),
    ({"request_id": MARKER}, "message", "missing"),
    ({"message": "x", "unknown": {"nested": MARKER}}, "unknown", "extra_forbidden"),
    ({"message": "x", "request_id": MARKER + "!"}, "request_id", "string_pattern_mismatch"),
])
def test_rejected_body_is_not_reflected(client, body, field, error_type):
    response = client.post("/api/error-logs", json=body)

    assert response.status_code == 422
    assert MARKER not in response.text
    error, = response.json()["detail"]
    assert set(error) == {"loc", "msg", "type"}
    assert error["loc"] == ["body", field]
    assert error["type"] == error_type
    assert isinstance(error["msg"], str) and error["msg"]


@pytest.mark.parametrize("number", ["1e309", "NaN", "Infinity", "-Infinity"])
def test_non_finite_input_remains_a_serializable_422(client, number):
    response = client.post(
        "/api/error-logs",
        content='{"message":' + number + '}',
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 422
    error, = response.json()["detail"]
    assert error == {
        "loc": ["body", "message"],
        "msg": "Input should be a valid string",
        "type": "string_type",
    }


def test_multiple_errors_preserve_order_and_diagnostics(client):
    response = client.post("/api/error-logs", json={
        "message": {"nested": MARKER}, "request_id": MARKER * 10,
    })

    assert response.status_code == 422
    assert MARKER not in response.text
    errors = response.json()["detail"]
    assert [error["loc"] for error in errors] == [
        ["body", "message"], ["body", "request_id"],
    ]
    assert [error["type"] for error in errors] == ["string_type", "string_too_long"]
    assert all(set(error) == {"loc", "msg", "type"} for error in errors)


def test_context_url_and_unknown_metadata_are_removed_before_encoding():
    # Context can hold arbitrary validator exceptions and server details.
    # Exclude these objects before jsonable_encoder tries to traverse them.
    exc = RequestValidationError([{
        "loc": ("query", "limit"), "msg": "Invalid limit", "type": "value_error",
        "input": {"nested": MARKER, "unencodable": object()},
        "ctx": {"error": ValueError(MARKER), "internal_host": MARKER},
        "url": "https://internal.invalid/" + MARKER,
        "future_metadata": MARKER,
    }])
    request = Request({"type": "http", "method": "GET", "path": "/"})

    response = asyncio.run(main.request_validation_handler(request, exc))

    assert response.status_code == 422
    assert MARKER.encode() not in response.body
    assert json.loads(response.body) == {"detail": [{
        "loc": ["query", "limit"], "msg": "Invalid limit", "type": "value_error",
    }]}
