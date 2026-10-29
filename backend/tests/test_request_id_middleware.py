"""PC-J63: bounded request IDs and one privacy-safe slow/5xx warning."""

import logging
from uuid import UUID

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

import main
from services.request_context import current_request_id


@pytest.fixture
def app(monkeypatch):
    # A fresh app exercises the real middleware/handler without DB or lifespan
    # work, and keeps synthetic routes out of the shared production app.
    app = FastAPI()
    app.middleware("http")(main.request_id_middleware)
    app.add_exception_handler(Exception, main.unhandled_exception_handler)
    monkeypatch.setattr(main, "perf_counter", lambda: 0.0)

    @app.get("/requests/{item}")
    async def inspect(request: Request, item: str):
        return {
            "state_id": request.state.request_id,
            "context_id": current_request_id(),
        }

    @app.get("/failures/{status}")
    async def failure(status: int):
        return JSONResponse({"detail": "failure"}, status_code=status)

    @app.get("/exceptions/{item}")
    async def exception(item: str):
        raise RuntimeError("synthetic failure")

    return app


def _assert_uuid4(value):
    parsed = UUID(value)
    assert parsed.version == 4
    assert str(parsed) == value


def _warnings(caplog):
    return [record for record in caplog.records if record.name == "request"]


def _elapsed(monkeypatch, seconds):
    ticks = iter((0.0, seconds))
    monkeypatch.setattr(main, "perf_counter", lambda: next(ticks))


@pytest.mark.parametrize("request_id", ["A", "Trace-09._:abc-Z", "a" * 128])
def test_valid_id_is_identical_in_header_state_and_context(app, request_id):
    response = TestClient(app).get(
        "/requests/example", headers={"X-Request-ID": request_id},
    )

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == request_id
    assert response.json() == {"state_id": request_id, "context_id": request_id}
    assert current_request_id() is None


@pytest.mark.parametrize("request_id", [
    "", "a" * 129, "has space", "has/slash", "caf\xe9", "has\ttab",
    "has\rreturn", "has\nnewline", "has\x00null", "has\x7fdelete",
])
def test_invalid_id_is_replaced_everywhere_without_truncation(app, request_id):
    response = TestClient(app).get(
        "/requests/example", headers=[(b"x-request-id", request_id.encode("latin-1"))],
    )

    assert response.status_code == 200
    normalized = response.headers["X-Request-ID"]
    _assert_uuid4(normalized)
    assert normalized != request_id
    assert response.json() == {"state_id": normalized, "context_id": normalized}
    assert current_request_id() is None


def test_missing_id_generates_a_fresh_uuid4_for_each_request(app):
    with TestClient(app) as client:
        ids = [client.get("/requests/example").headers["X-Request-ID"] for _ in range(2)]

    for request_id in ids:
        _assert_uuid4(request_id)
    assert len(set(ids)) == 2


@pytest.mark.parametrize("seconds,expected_count", [(0.999, 0), (1.0, 1), (1.25, 1)])
def test_slow_threshold_and_log_privacy(app, monkeypatch, caplog, seconds, expected_count):
    _elapsed(monkeypatch, seconds)
    with caplog.at_level(logging.WARNING, logger="request"):
        response = TestClient(app).get(
            "/requests/private-item?token=secret-query&email=private-email",
            headers={"X-Request-ID": "slow-request", "Authorization": "Bearer secret-header"},
        )

    assert response.status_code == 200
    records = _warnings(caplog)
    assert len(records) == expected_count
    if records:
        assert records[0].levelno == logging.WARNING
        assert records[0].getMessage() == (
            "request_id=slow-request method=GET path=/requests/{item} "
            f"status=200 duration_ms={seconds * 1000:.1f}"
        )


@pytest.mark.parametrize("status", [500, 503, 599])
@pytest.mark.parametrize("seconds", [0.01, 1.5])
def test_fast_and_slow_5xx_log_exactly_once(app, monkeypatch, caplog, status, seconds):
    _elapsed(monkeypatch, seconds)
    with caplog.at_level(logging.WARNING, logger="request"):
        response = TestClient(app).get(
            f"/failures/{status}", headers={"X-Request-ID": "failed-request"},
        )

    assert response.status_code == status
    records = _warnings(caplog)
    assert len(records) == 1
    assert records[0].levelno == logging.WARNING
    assert records[0].getMessage() == (
        "request_id=failed-request method=GET path=/failures/{status} "
        f"status={status} duration_ms={seconds * 1000:.1f}"
    )


@pytest.mark.parametrize("path,status", [("/requests/example", 200), ("/failures/400", 400)])
def test_fast_non_5xx_does_not_log(app, caplog, path, status):
    with caplog.at_level(logging.DEBUG, logger="request"):
        response = TestClient(app).get(path)

    assert response.status_code == status
    assert _warnings(caplog) == []


def test_slow_unmatched_route_logs_only_path_without_query(app, monkeypatch, caplog):
    _elapsed(monkeypatch, 1.0)
    with caplog.at_level(logging.WARNING, logger="request"):
        response = TestClient(app).get(
            "/unmatched?token=secret-query", headers={"X-Request-ID": "unmatched-request"},
        )

    assert response.status_code == 404
    assert [record.getMessage() for record in _warnings(caplog)] == [
        "request_id=unmatched-request method=GET path=/unmatched status=404 duration_ms=1000.0"
    ]


def test_exception_logs_500_and_reraises(app, caplog):
    with caplog.at_level(logging.WARNING, logger="request"):
        with pytest.raises(RuntimeError, match="^synthetic failure$"):
            TestClient(app).get(
                "/exceptions/example", headers={"X-Request-ID": "exception-request"},
            )

    assert [record.getMessage() for record in _warnings(caplog)] == [
        "request_id=exception-request method=GET path=/exceptions/{item} "
        "status=500 duration_ms=0.0"
    ]
    assert current_request_id() is None


def test_error_log_payload_and_500_response_share_normalized_id(app, monkeypatch, caplog):
    payloads = []
    monkeypatch.setattr(main, "_insert_error_log_safely", payloads.append)
    with caplog.at_level(logging.WARNING, logger="request"):
        # Lifespan context keeps the event loop alive for the handler's
        # fire-and-forget insertion; teardown waits for the worker to finish.
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get(
                "/exceptions/example", headers={"X-Request-ID": "invalid " + "a" * 129},
            )

    assert response.status_code == 500
    normalized = response.headers["X-Request-ID"]
    _assert_uuid4(normalized)
    assert response.json()["request_id"] == normalized
    assert response.json()["detail"]["ref"] == normalized
    assert len(payloads) == 1
    assert payloads[0]["request_id"] == normalized
    assert [record.getMessage() for record in _warnings(caplog)] == [
        f"request_id={normalized} method=GET path=/exceptions/{{item}} "
        "status=500 duration_ms=0.0"
    ]
