"""C-4.2 — CORS is tightened from "*" to the methods/headers the app uses, with
credentials kept. F11 — origins are an exact allowlist (the *.averlearning.com
regex is gone), resolved per deployment (services/cors_policy.py). Exercises the
REAL middleware on main.app via preflight (OPTIONS) requests; pytest imports
main as the development tier, so its allowlist is the localhost dev origins.
Production/staging lists are exercised in test_cors_averlearning.py.
"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

import main

client = TestClient(main.app)


def _preflight(origin, method="POST", request_headers="authorization"):
    return client.options(
        "/sessions/x/responses",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": request_headers,
        },
    )


# ── Origin: exact allowlist allowed, everything else rejected ─────────────────

def test_allowlisted_origins_allowed():
    for origin in ("http://localhost:3000",
                   "http://127.0.0.1:3000",
                   "http://localhost:5500",
                   "http://127.0.0.1:5500"):
        r = _preflight(origin)
        assert r.headers.get("access-control-allow-origin") == origin, origin
        # credentials kept
        assert r.headers.get("access-control-allow-credentials") == "true"


def test_foreign_origin_rejected():
    r = _preflight("https://evil.example.com")
    assert r.headers.get("access-control-allow-origin") is None
    # a look-alike that is NOT a subdomain of averlearning.com must also fail
    r2 = _preflight("https://averlearning.com.evil.com")
    assert r2.headers.get("access-control-allow-origin") is None


def test_unlisted_averlearning_subdomain_rejected():
    """F11 — a credentialed CORS grant to every *.averlearning.com let a
    dangling/taken-over subdomain read the API as the signed-in user."""
    for origin in ("https://app.averlearning.com",
                   "https://bat-ky.averlearning.com"):
        r = _preflight(origin)
        assert r.headers.get("access-control-allow-origin") is None, origin


# ── Methods: app methods allowed, exotic blocked ─────────────────────────────

def test_allowed_methods_pass_exotic_blocked():
    allow = _preflight("https://www.averlearning.com", method="POST")
    methods = allow.headers.get("access-control-allow-methods", "")
    for m in ("GET", "POST", "PATCH", "DELETE", "OPTIONS"):
        assert m in methods, m
    assert "PUT" not in methods and "TRACE" not in methods
    # a PUT preflight is not granted
    put = _preflight("https://www.averlearning.com", method="PUT")
    assert "PUT" not in put.headers.get("access-control-allow-methods", "")


# ── Headers: real custom headers allowed, exotic blocked ─────────────────────

def test_real_headers_allowed():
    for h in ("authorization", "content-type", "x-reading-password",
              "x-reading-anon", "x-request-id"):
        r = _preflight("https://www.averlearning.com", request_headers=h)
        allowed = r.headers.get("access-control-allow-headers", "").lower()
        assert h in allowed, h


def test_exotic_header_blocked():
    r = _preflight("https://www.averlearning.com", request_headers="x-evil")
    allowed = r.headers.get("access-control-allow-headers", "").lower()
    assert "x-evil" not in allowed
