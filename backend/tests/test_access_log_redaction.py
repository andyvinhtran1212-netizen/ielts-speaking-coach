"""PC-J398: app-configured access logs retain diagnostics without URL tokens."""

import io
import logging

import pytest
from uvicorn.logging import AccessFormatter

import main  # noqa: F401 — installs the application's logging configuration


@pytest.fixture(params=[
    logging.Formatter("%(levelname)s %(message)s"),
    AccessFormatter('%(client_addr)s - "%(request_line)s" %(status_code)s', use_colors=False),
], ids=["stdlib", "uvicorn"])
def access_output(monkeypatch, request):
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(request.param)
    logger = logging.getLogger("uvicorn.access")
    monkeypatch.setattr(logger, "handlers", [handler])
    monkeypatch.setattr(logger, "propagate", False)

    def emit(target, method="GET", status=200):
        record = logging.LogRecord(
            "uvicorn.access", logging.INFO, __file__, 0,
            '%s - "%s %s HTTP/%s" %d',
            ("127.0.0.1:12345", method, target, "1.1", status), None,
        )
        logger.handle(record)
        return stream.getvalue()

    return emit


@pytest.mark.parametrize("prefix,action,method,status", [
    ("", "boot", "GET", 200),
    ("/api/reading", "boot", "GET", 200),
    ("/api/reading", "attempts", "POST", 201),
])
def test_app_access_log_redacts_share_path_and_query(access_output, prefix, action, method, status):
    output = access_output(
        f"{prefix}/test/share/path-marker-398/{action}?x=1&token=query-marker-398",
        method, status,
    )

    assert "path-marker-398" not in output
    assert "query-marker-398" not in output
    assert f"{method} {prefix}/test/share/<redacted>/{action}?x=1&token=<redacted> HTTP/1.1" in output
    assert str(status) in output


def test_app_access_log_preserves_ordinary_target(access_output):
    target = "/api/reading/tests?x=1&topic=travel%20plans&sort=asc&tag=a&tag=b"
    output = access_output(target, status=404)

    assert f"GET {target} HTTP/1.1" in output
    assert "404" in output
    assert "127.0.0.1:12345" in output


@pytest.mark.parametrize("name", [
    "token", "access_token", "refresh_token", "share", "code", "key",
    "signature", "sig", "otp", "TOKEN", "Access_Token", "ReFrEsH_ToKeN",
    "%74oken", "access%5Ftoken", "%4fTP",
])
def test_query_credentials_on_any_path(access_output, name):
    output = access_output(f"/health?x=1&{name}=query-marker-398&x=2")

    assert "query-marker-398" not in output
    assert f"/health?x=1&{name}=<redacted>&x=2" in output


def test_repeated_empty_and_encoded_query_values(access_output):
    output = access_output(
        "/health?token=first-marker-398&token=second%26marker%3D398&OTP="
        "&x=kept%26value%3D1&flag&&token"
    )

    assert "first-marker-398" not in output
    assert "second%26marker%3D398" not in output
    assert (
        "/health?token=<redacted>&token=<redacted>&OTP=<redacted>"
        "&x=kept%26value%3D1&flag&&token"
    ) in output


@pytest.mark.parametrize("target,expected", [
    ("/test/share/path-marker-398", "/test/share/<redacted>"),
    ("/test/share/path-marker-398/boot", "/test/share/<redacted>/boot"),
    ("/test/share/path%20marker%2B398/boot", "/test/share/<redacted>/boot"),
    ("/test/share/", "/test/share/"),
    ("/test/shared/public/boot", "/test/shared/public/boot"),
    ("/health?token_count=2&monkey=banana&shareable=yes", "/health?token_count=2&monkey=banana&shareable=yes"),
])
def test_path_boundaries_and_exact_query_names(access_output, target, expected):
    output = access_output(target)

    assert f"GET {expected} HTTP/1.1" in output


def test_redaction_failure_keeps_safe_diagnostics(access_output, monkeypatch):
    from services import log_redaction

    def fail(_target):
        raise ValueError("exception-marker-398")

    monkeypatch.setattr(log_redaction, "_redact_target", fail)
    output = access_output("/test/share/path-marker-398/boot?token=query-marker-398", status=503)

    assert "marker-398" not in output
    assert "GET <redacted> HTTP/1.1" in output
    assert "503" in output


@pytest.mark.parametrize("args", [
    (), ("bad-marker-398",),
    ("127.0.0.1", "GET", object(), "1.1", 200),
    ("127.0.0.1", "GET", "/health?token=bad-marker-398", "1.1", object()),
])
def test_malformed_records_are_safe_for_both_formatters(args):
    from services.log_redaction import AccessLogRedactionFilter

    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 0,
        "unexpected message with bad-marker-398", args, None,
    )
    record.exc_text = "bad-marker-398"
    record.stack_info = "bad-marker-398"

    assert AccessLogRedactionFilter().filter(record) is True
    for formatter in (logging.Formatter("%(message)s"), AccessFormatter("%(request_line)s %(status_code)s")):
        assert "bad-marker-398" not in formatter.format(record)
