"""C-4.2 — CORS is tightened from "*" to the methods/headers the app uses, while
the intentional subdomain regex + credentials stay (commit 4c9fc1e9). Exercises
the REAL middleware on main.app via preflight (OPTIONS) requests.
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


# ── Origin: regex subdomains still allowed, foreign origins rejected ──────────

def test_apex_and_subdomains_allowed():
    for origin in ("https://averlearning.com",
                   "https://www.averlearning.com",
                   "https://app.averlearning.com",
                   "https://staging.averlearning.com"):
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
