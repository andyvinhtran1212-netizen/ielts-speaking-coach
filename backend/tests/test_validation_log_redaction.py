"""PC-J396: validation input stays out of process logs and error_logs."""
from __future__ import annotations

import json
import logging
import time
import uuid

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError, ResponseValidationError
from fastapi.testclient import TestClient
from pydantic import BaseModel, ValidationError

import main
from services import errors

MARKER = "pcj396-" + uuid.uuid4().hex  # synthetic input, never a credential


class _Typed(BaseModel):
    value: int


def _validation_error():
    try:
        _Typed(value=MARKER)
    except ValidationError as exc:
        return exc
    raise AssertionError("invalid input accepted")


def _fastapi_error(cls):
    return cls([{
        "loc": ("body", "value"), "type": "int_parsing",
        "msg": "invalid integer", "input": {"nested": MARKER},
    }])


def _clean(text):
    assert MARKER not in text
    assert "input_value=" not in text
    assert "'input':" not in text
    assert "errors.pydantic.dev" not in text


def _installed_filter():
    filters = [f for f in logging.getLogger("uvicorn.error").filters
               if type(f).__name__ == "ValidationLogFilter"]
    assert len(filters) == 1, "uvicorn.error needs the validation redaction filter"
    return filters[0]


@pytest.mark.parametrize("signature", [
    "[input_value={'nested': 'value'}, input_type=dict]",
    "{'input': {'nested': 'value'}}",
    "https://errors.pydantic.dev/2/v/value_error",
])
def test_serialized_signatures_omit_the_entire_message(signature):
    # Custom messages can repeat input outside the standard input field.
    _clean(errors.redact_validation_text(f"validator rejected {MARKER}: {signature}"))


@pytest.mark.parametrize("kind", ["pydantic", "request", "response", "wrapped", "group"])
def test_uvicorn_filter_replaces_live_and_cached_tracebacks(kind):
    exc = _validation_error()
    if kind == "request":
        exc = _fastapi_error(RequestValidationError)
    elif kind == "response":
        exc = _fastapi_error(ResponseValidationError)
    elif kind == "wrapped":
        wrapper = RuntimeError(f"wrapped {exc}")
        wrapper.__cause__ = exc
        exc = wrapper
    elif kind == "group":
        exc = ExceptionGroup("task failures", [exc, ValueError(MARKER)])
    try:
        raise exc
    except Exception as caught:
        record = logging.LogRecord("uvicorn.error", logging.ERROR, __file__, 1,
                                   "Exception in ASGI application: %s", (caught,),
                                   (type(caught), caught, caught.__traceback__))
    formatter = logging.Formatter("%(levelname)s %(message)s")
    assert MARKER in formatter.format(record)  # populate the formatter's exc_text cache

    assert _installed_filter().filter(record) is True

    assert record.exc_info is None
    assert record.args == ()
    _clean(record.getMessage())
    _clean(record.exc_text or "")
    rendered = formatter.format(record)
    _clean(rendered)
    assert "test_uvicorn_filter_replaces_live_and_cached_tracebacks" in rendered
    assert "int_parsing" in rendered
    if kind in {"pydantic", "wrapped", "group"}:
        assert "in _validation_error" in rendered


@pytest.mark.parametrize("surface", ["msg", "exc_text", "stack_info"])
def test_uvicorn_filter_handles_serialized_validation_without_exc_info(surface):
    record = logging.LogRecord("uvicorn.error", logging.ERROR, __file__, 1,
                               "Exception in ASGI application", (), None)
    setattr(record, surface, f"late: {_validation_error()}")
    assert _installed_filter().filter(record) is True
    _clean(logging.Formatter("%(message)s").format(record))
    _clean(record.getMessage())


def test_uvicorn_filter_preserves_unrelated_exception_and_formatting():
    exc = RuntimeError("ordinary-" + MARKER)
    record = logging.LogRecord("uvicorn.error", logging.ERROR, __file__, 1,
                               "server failure %s", (42,), (RuntimeError, exc, None))
    formatter = logging.Formatter("%(levelname)s %(message)s")
    before = formatter.format(record)
    assert _installed_filter().filter(record) is True
    assert formatter.format(record) == before
    assert record.exc_info[1] is exc


@pytest.fixture
def middleware_app(monkeypatch):
    rows = []
    monkeypatch.setattr(main, "_insert_error_log_safely", rows.append)
    # Copy the deployed stack, including its BaseHTTPMiddleware wrappers, rather
    # than invoking the exception handler on a synthetic Request directly.
    app = FastAPI(middleware=list(main.app.user_middleware))
    app.add_exception_handler(Exception, main.unhandled_exception_handler)

    @app.get("/raise/{mode}")
    async def fail(mode: str):
        if mode == "copied":
            text = str(_validation_error())
            raise RuntimeError(f"late: {text}")
        if mode == "fastapi":
            text = str(_fastapi_error(ResponseValidationError))
            raise RuntimeError(f"late: {text}")
        if mode == "deep":
            exc = _validation_error()
            for _ in range(7):
                wrapper = RuntimeError("outer")
                wrapper.__cause__ = exc
                exc = wrapper
            raise exc
        if mode == "plain":
            raise RuntimeError("ordinary-" + MARKER)
        try:
            raise _validation_error()
        except ValidationError as exc:
            if mode == "none":
                raise RuntimeError(f"build failed: {exc}") from None
            raise RuntimeError(f"build failed: {exc}")

    return app, rows


@pytest.mark.parametrize("mode", ["implicit", "none", "copied", "fastapi", "deep"])
def test_middleware_wrappers_do_not_log_or_persist_serialized_input(middleware_app, caplog, mode):
    app, rows = middleware_app
    caplog.set_level(logging.ERROR, logger="main")
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get(f"/raise/{mode}")
        deadline = time.monotonic() + 5
        while not rows and time.monotonic() < deadline:
            time.sleep(0.01)
    assert response.status_code == 500
    assert response.json()["detail"]["error_code"] == "internal_error"
    assert response.json()["detail"]["message"] == errors.GENERIC_MESSAGE
    _clean(response.text)
    log = "\n".join(r.getMessage() for r in caplog.records if r.name == "main")
    assert "Unhandled exception" in log
    _clean(log)
    row, = rows
    _clean(json.dumps(row))
    assert "RuntimeError" in row["message"]
    assert "Traceback (most recent call last):" in row["stack"]
    assert "in fail" in row["stack"]


def test_middleware_plain_exception_keeps_diagnostics(middleware_app, caplog):
    app, rows = middleware_app
    caplog.set_level(logging.ERROR, logger="main")
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/raise/plain")
        deadline = time.monotonic() + 5
        while not rows and time.monotonic() < deadline:
            time.sleep(0.01)
    assert response.status_code == 500
    row, = rows
    assert row["message"] == "ordinary-" + MARKER
    assert MARKER in row["stack"]
    assert MARKER in caplog.text


@pytest.mark.parametrize("detail", [
    lambda: f"build failed: {_validation_error()}",
    lambda: f"build failed: {_fastapi_error(ResponseValidationError)}",
    lambda: f'build "failed": {_fastapi_error(ResponseValidationError)}',
    lambda: {"failure": str(_validation_error()), "nested": MARKER},
    lambda: {"failure": f'"{_fastapi_error(ResponseValidationError)}"'},
])
def test_safe_detail_redacts_serialized_validation_before_logging(caplog, detail):
    caplog.set_level(logging.ERROR, logger="services.errors")
    result = errors.safe_detail(500, detail(), ref="test-ref")
    assert result == {"error_code": "internal_error", "message": errors.GENERIC_MESSAGE,
                      "ref": "test-ref"}
    _clean(caplog.text)
    assert "ref=test-ref" in caplog.text and "status=500" in caplog.text


def test_safe_detail_keeps_existing_non_validation_behavior(caplog):
    caplog.set_level(logging.ERROR, logger="services.errors")
    detail = {"error_code": "known", "message": "retry"}
    assert errors.safe_detail(503, detail) is detail
    assert errors.safe_detail(422, MARKER) == MARKER
    assert not caplog.records
    result = errors.safe_detail(500, "ordinary-" + MARKER, ref="test-ref")
    assert result["message"] == errors.GENERIC_MESSAGE
    assert repr("ordinary-" + MARKER) in caplog.text
