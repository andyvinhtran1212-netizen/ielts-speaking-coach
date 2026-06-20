"""PR-B — an unhandled 500 must carry CORS headers (for an allowed Origin) so the
REAL status surfaces in the browser instead of masquerading as a generic CORS
error. That masking is exactly what cost 4 hypotheses on the compose-500 (#538).

Anti-regression: 5xx-has-CORS (allowed origin) + 5xx-no-CORS (disallowed origin,
never reflect an arbitrary one).
"""

from __future__ import annotations

from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import main
from main import _cors_headers_for_origin, unhandled_exception_handler

ALLOWED = "https://www.averlearning.com"     # explicit allowlist
SUBDOMAIN = "https://staging.averlearning.com"  # matches the regex only
EVIL = "https://evil.example.com"


# ── helper: allowed-only, no arbitrary reflection ─────────────────────


def test_helper_echoes_only_allowed_origins():
    assert _cors_headers_for_origin(ALLOWED)["Access-Control-Allow-Origin"] == ALLOWED
    assert _cors_headers_for_origin(SUBDOMAIN)["Access-Control-Allow-Origin"] == SUBDOMAIN  # regex
    assert _cors_headers_for_origin(EVIL) == {}        # NOT reflected (security)
    assert _cors_headers_for_origin(None) == {}
    h = _cors_headers_for_origin(ALLOWED)
    assert h["Access-Control-Allow-Credentials"] == "true"
    assert h["Vary"] == "Origin"


# ── end-to-end: a 500 response carries CORS for an allowed origin ─────


def _throwing_app():
    # Fresh app with ONLY the real handler (no CORSMiddleware), so the handler's
    # manual ACAO is the sole source — exactly the unwound-past-CORS situation.
    a = FastAPI()
    a.add_exception_handler(Exception, unhandled_exception_handler)

    @a.get("/boom")
    def boom():
        raise RuntimeError("kaboom")

    return a


@patch.object(main, "_insert_error_log_safely", lambda payload: None)  # no bg DB write
def test_5xx_carries_cors_for_allowed_origin():
    client = TestClient(_throwing_app(), raise_server_exceptions=False)
    r = client.get("/boom", headers={"Origin": ALLOWED})
    assert r.status_code == 500                                    # REAL status surfaces
    assert r.headers.get("access-control-allow-origin") == ALLOWED
    assert r.headers.get("access-control-allow-credentials") == "true"
    assert "internal_error" in r.text                             # generic body, no traceback
    assert "kaboom" not in r.text and "RuntimeError" not in r.text


@patch.object(main, "_insert_error_log_safely", lambda payload: None)
def test_5xx_no_cors_for_disallowed_origin():
    client = TestClient(_throwing_app(), raise_server_exceptions=False)
    r = client.get("/boom", headers={"Origin": EVIL})
    assert r.status_code == 500
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}
