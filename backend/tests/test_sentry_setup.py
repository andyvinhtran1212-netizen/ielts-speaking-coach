"""Sentry wiring (PC-J597): off without a DSN, scrubbed events with one.

The end-to-end capture runs in a subprocess: ``sentry_sdk.init`` patches
Starlette for the whole interpreter, which must not leak into other tests.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest
import sentry_sdk

from services import sentry_setup
from services.sentry_setup import before_send, init_sentry, resolve_environment, scrub_text

BACKEND = Path(__file__).resolve().parents[1]
USER_ID = "11111111-2222-4333-8444-555555555555"
DSN = "https://publickey@o1.ingest.us.sentry.io/1"


# ── off without a DSN ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("dsn", [None, "", "   "])
def test_no_dsn_is_a_silent_no_op(dsn, monkeypatch, caplog):
    calls = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: calls.append(kw))
    with caplog.at_level(logging.DEBUG, logger="services.sentry_setup"):
        assert init_sentry(dsn, {"RAILWAY_ENVIRONMENT_NAME": "staging"}) is False
    assert calls == []
    assert caplog.records == []


def test_main_import_leaves_sentry_inactive_without_dsn():
    import main  # noqa: F401 — conftest forces SENTRY_DSN=""

    assert sentry_sdk.get_client().is_active() is False


def test_invalid_dsn_logs_one_warning_without_the_value(caplog):
    with caplog.at_level(logging.DEBUG, logger="services.sentry_setup"):
        assert init_sentry("not-a-dsn-secretvalue", {}) is False
    assert [r.levelno for r in caplog.records] == [logging.WARNING]
    assert "secretvalue" not in caplog.text
    assert sentry_sdk.get_client().is_active() is False


def test_init_options(monkeypatch):
    calls = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: calls.append(kw))
    env = {"RAILWAY_ENVIRONMENT_NAME": "staging", "RAILWAY_GIT_COMMIT_SHA": "abc123"}
    assert init_sentry(f"  {DSN} ", env) is True
    [options] = calls
    assert options["dsn"] == DSN
    assert options["environment"] == "staging"
    assert options["release"] == "abc123"
    assert options["send_default_pii"] is False
    assert options["include_local_variables"] is False
    assert options["max_request_body_size"] == "never"
    assert 0 < options["traces_sample_rate"] <= 0.05
    assert "profiles_sample_rate" not in options and "profiles_sampler" not in options
    assert options["auto_enabling_integrations"] is False
    assert options["before_send"] is before_send
    assert options["before_send_transaction"] is before_send
    # The SDK's own background-thread transport, never a custom blocking one.
    assert "transport" not in options


@pytest.mark.parametrize("env, expected", [
    ({"AVER_ENVIRONMENT": "staging-qa", "RAILWAY_ENVIRONMENT_NAME": "production"}, "staging-qa"),
    ({"AVER_ENVIRONMENT": "  ", "RAILWAY_ENVIRONMENT_NAME": "staging"}, "staging"),
    # Railway production sets no ENVIRONMENT (see services/cors_policy.py).
    ({"RAILWAY_ENVIRONMENT_NAME": "production"}, "production"),
    ({"ENVIRONMENT": "staging"}, "staging"),
    ({}, "development"),
])
def test_resolve_environment(env, expected):
    assert resolve_environment(env) == expected


# ── before_send scrubbing ─────────────────────────────────────────────────────

def _event() -> dict:
    return {
        "level": "error",
        "user": {"id": USER_ID, "email": "learner@example.com", "ip_address": "1.2.3.4"},
        "request": {
            "method": "POST",
            "url": "https://api.example/api/reading/test/share/SHARETOKEN123/boot?token=QTOKEN#frag",
            "query_string": "token=QTOKEN&email=learner%40example.com",
            "data": {"password": "hunter2", "essay": "my essay"},
            "cookies": {"sb-access-token": "COOKIEVAL"},
            "env": {"REMOTE_ADDR": "1.2.3.4"},
            "headers": {
                "Authorization": "Bearer AUTHTOKEN",
                "Cookie": "sb=COOKIEVAL",
                "X-Api-Key": "APIKEYVAL",
                "X-Reading-Password": "READINGPW",
                "X-Reading-Anon": "ANONVAL",
                "X-Forwarded-For": "1.2.3.4",
                "Referer": "https://app.example/login?code=OAUTHCODE",
                "User-Agent": "Mozilla/5.0",
                "Content-Type": "application/json",
                "X-Request-ID": "req-1",
            },
        },
        "exception": {"values": [{
            "type": "RuntimeError",
            "value": f"user {USER_ID} learner@example.com failed: "
                     "https://x.supabase.co/rest/v1/users?email=eq.learner%40example.com "
                     "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJl",
        }]},
        "breadcrumbs": {"values": [{
            "type": "http", "category": "httplib",
            "data": {"url": "https://x.supabase.co/storage/v1/object/sign/a.webm",
                     "http.query": "token=SIGNEDTOKEN", "http.fragment": "f"},
        }]},
        "spans": [{"description": "GET https://x.supabase.co/rest/v1/t?id=eq.5",
                   "data": {"url.query": "id=eq.5"}}],
    }


def test_before_send_removes_request_body_cookies_query_and_user():
    event = before_send(_event(), {})
    request = event["request"]
    for key in ("data", "cookies", "query_string", "env"):
        assert key not in request
    assert "user" not in event
    assert request["url"] == "https://api.example/api/reading/test/share/[redacted]/boot"


def test_before_send_keeps_only_allowlisted_headers():
    headers = before_send(_event(), {})["request"]["headers"]
    assert set(headers) == {"User-Agent", "Content-Type", "X-Request-ID"}


def test_before_send_scrubs_strings_everywhere():
    event = before_send(_event(), {})
    blob = json.dumps(event)
    for secret in ("hunter2", "my essay", "COOKIEVAL", "AUTHTOKEN", "APIKEYVAL", "READINGPW",
                   "ANONVAL", "OAUTHCODE", "SHARETOKEN123", "QTOKEN", "SIGNEDTOKEN",
                   "learner@example.com", "learner%40example.com", USER_ID, "eyJhbGci", "1.2.3.4"):
        assert secret not in blob, secret
    value = event["exception"]["values"][0]["value"]
    assert "[email]" in value and "[jwt]" in value
    assert "https://x.supabase.co/rest/v1/users " in value
    assert event["spans"][0] == {"description": "GET https://x.supabase.co/rest/v1/t", "data": {}}
    assert event["breadcrumbs"]["values"][0]["data"] == {
        "url": "https://x.supabase.co/storage/v1/object/sign/a.webm"}


def test_uuid_pseudonym_is_stable_and_not_raw():
    first = scrub_text(f"session {USER_ID}")
    assert USER_ID not in first and first.startswith("session uuid:")
    assert scrub_text(f"other {USER_ID.upper()}").split()[1] == first.split()[1]
    assert scrub_text("other 99999999-2222-4333-8444-555555555555") != f"other {first.split()[1]}"


def test_bearer_and_serialized_validation_errors_are_removed():
    assert scrub_text("header Bearer abc.def-ghi") == "header Bearer [redacted]"
    serialized = "1 validation error\n  Field required [type=missing, input_value={'pw': 'hunter2'}]"
    assert "hunter2" not in scrub_text(serialized)


def test_before_send_drops_events_marked_sentry_skip():
    record = logging.LogRecord("main", logging.ERROR, __file__, 1, "x", None, None)
    record.sentry_skip = True
    assert before_send(_event(), {"log_record": record}) is None
    plain = logging.LogRecord("main", logging.ERROR, __file__, 1, "x", None, None)
    assert before_send(_event(), {"log_record": plain}) is not None


def test_before_send_drops_the_event_if_scrubbing_fails(monkeypatch):
    def boom(value):
        raise ValueError("scrubber bug")

    monkeypatch.setattr(sentry_setup, "_scrub", boom)
    assert before_send(_event(), {}) is None


# ── end to end: a FastAPI 500 through the real SDK, captured in-process ───────

_CAPTURE_SCRIPT = textwrap.dedent(r'''
    import json, logging, sys
    import sentry_sdk
    from sentry_sdk.transport import Transport
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse
    from fastapi.testclient import TestClient
    from pydantic import BaseModel

    from services import sentry_setup

    captured = []

    class Capture(Transport):
        def capture_envelope(self, envelope):
            captured.extend(item.payload.json for item in envelope.items if item.type == "event")

    real_init = sentry_sdk.init
    sentry_sdk.init = lambda **kw: real_init(transport=Capture, **kw)
    assert sentry_setup.init_sentry(sys.argv[1], {"RAILWAY_ENVIRONMENT_NAME": "staging"})

    app = FastAPI()
    log = logging.getLogger("main")

    @app.exception_handler(Exception)
    async def unhandled(request, exc):
        log.error("[error] Unhandled exception: %s", exc, extra={"sentry_skip": True})
        return JSONResponse(status_code=500, content={"detail": "x"})

    class Strict(BaseModel):
        n: int

    @app.post("/api/reading/test/share/{share_token}/boot")
    async def boom(share_token: str):
        raise RuntimeError("failed for learner@example.com 11111111-2222-4333-8444-555555555555")

    @app.post("/validation")
    async def validation():
        Strict(n="hunter2-not-an-int")

    client = TestClient(app, raise_server_exceptions=False)
    headers = {"Authorization": "Bearer AUTHTOKEN", "Cookie": "sb=COOKIEVAL",
               "X-Reading-Password": "READINGPW", "User-Agent": "ua"}
    statuses = [
        client.post("/api/reading/test/share/SHARETOKEN123/boot?token=QTOKEN",
                    json={"password": "hunter2"}, headers=headers).status_code,
        client.post("/validation", json={"password": "hunter2"}, headers=headers).status_code,
    ]
    sentry_sdk.flush()
    print(json.dumps({"statuses": statuses, "events": captured}))
''')


def test_fastapi_error_reaches_sentry_scrubbed(tmp_path):
    env = {**os.environ, "PYTHONPATH": str(BACKEND)}
    result = subprocess.run(
        [sys.executable, "-c", _CAPTURE_SCRIPT, DSN],
        cwd=tmp_path, env=env, capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    out = json.loads(result.stdout.strip().splitlines()[-1])
    assert out["statuses"] == [500, 500]
    events = out["events"]
    # One event per exception: the handler's log line is skipped, not duplicated.
    assert [e["exception"]["values"][-1]["type"] for e in events] == ["RuntimeError", "ValidationError"]
    for event in events:
        assert event["environment"] == "staging"
        assert "data" not in event["request"] and "query_string" not in event["request"]
        assert set(event["request"]["headers"]) <= sentry_setup.ALLOWED_REQUEST_HEADERS
        for frame in event["exception"]["values"][-1]["stacktrace"]["frames"]:
            assert "vars" not in frame
    blob = json.dumps([{k: v for k, v in e.items() if k != "exception"} for e in events]
                      + [[x.get("value") for x in e["exception"]["values"]] for e in events])
    for secret in ("hunter2", "AUTHTOKEN", "COOKIEVAL", "READINGPW", "SHARETOKEN123", "QTOKEN",
                   "learner@example.com", USER_ID):
        assert secret not in blob, secret
