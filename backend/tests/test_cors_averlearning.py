"""Sprint 20.10 D1 — CORS bulletproofing.

Andy's prod dogfood (2026-05-29) hit "No 'Access-Control-Allow-Origin' header"
from https://www.averlearning.com on `GET /api/reading/test/{test_id}/attempts/
in-progress`. The explicit origin list already includes both apex + www
(commit 4c9fc1e9, 2026-04-08) so the most plausible single-point-of-failure
is the explicit list itself drifting (a new staging subdomain ships, the
prod env gets a stale config, etc.). 20.10 D1 adds an `allow_origin_regex`
fallback for `^https://(?:[a-z0-9-]+\\.)?averlearning\\.com$` that survives
that class of drift.

This suite asserts the CORS preflight (OPTIONS) and an actual GET return the
`Access-Control-Allow-Origin` header for every origin we care about, and
rejects origins we don't.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


def _preflight(origin: str) -> tuple[int, dict[str, str]]:
    """CORS preflight (OPTIONS) for a typical authenticated request: the
    headers must include Origin + the requested method/headers for the
    middleware to treat this as a CORS preflight."""
    r = _client().options(
        "/api/reading/test/T1/attempts/in-progress",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    return r.status_code, dict(r.headers)


# ── Explicit-list origins (primary CORS path) ─────────────────────────


def test_cors_preflight_allows_apex_origin():
    status, headers = _preflight("https://averlearning.com")
    assert status == 200, f"preflight from apex returned {status}"
    assert headers.get("access-control-allow-origin") == "https://averlearning.com"


def test_cors_preflight_allows_www_origin():
    """The prod surface Andy was hitting. Must allow."""
    status, headers = _preflight("https://www.averlearning.com")
    assert status == 200
    assert headers.get("access-control-allow-origin") == "https://www.averlearning.com"


def test_cors_preflight_allows_localhost_dev_origin():
    """Regression — local dev origins still work."""
    status, headers = _preflight("http://localhost:5500")
    assert status == 200
    assert headers.get("access-control-allow-origin") == "http://localhost:5500"


# ── Regex-fallback origins (Sprint 20.10 D1 safety net) ───────────────


def test_cors_preflight_allows_staging_subdomain_via_regex():
    """Any *.averlearning.com over HTTPS is accepted via the regex fallback,
    so future subdomain rollouts (staging, app, admin) don't require code
    changes — the regex catches them and the request goes through."""
    status, headers = _preflight("https://staging.averlearning.com")
    assert status == 200, f"regex did not allow staging subdomain: status={status}"
    assert headers.get("access-control-allow-origin") == "https://staging.averlearning.com"


def test_cors_preflight_allows_app_subdomain_via_regex():
    status, headers = _preflight("https://app.averlearning.com")
    assert status == 200
    assert headers.get("access-control-allow-origin") == "https://app.averlearning.com"


# ── Rejection cases (the safety net does NOT widen us to the open web) ─


def test_cors_preflight_rejects_evil_origin():
    """Random origins must not get the allow-origin header — the regex
    must be anchored, not substring-match."""
    status, headers = _preflight("https://evil.com")
    # The CORS middleware responds 200 either way (preflight short-circuit),
    # but the allow-origin header must be ABSENT for disallowed origins.
    assert "access-control-allow-origin" not in headers, (
        f"non-allowlisted origin leaked an allow-origin header: {headers}"
    )


def test_cors_preflight_rejects_typosquatted_lookalike():
    """`averlearning.com.evil.com` must not match — the regex is anchored
    at the host boundary."""
    status, headers = _preflight("https://averlearning.com.evil.com")
    assert "access-control-allow-origin" not in headers


def test_cors_preflight_rejects_http_for_averlearning():
    """The regex pins HTTPS only — an http://averlearning.com (downgrade
    attack vector) is not accepted."""
    status, headers = _preflight("http://averlearning.com")
    assert "access-control-allow-origin" not in headers


def test_cors_actual_get_carries_allow_origin_for_www():
    """Not just preflight — an actual GET (with an Origin header) must
    surface the allow-origin header in its response so the browser is
    happy with the response, not just the preflight."""
    # The request will be rejected for auth (401 from require_auth), but
    # CORSMiddleware should still attach the allow-origin header.
    r = _client().get(
        "/api/reading/test/T1/attempts/in-progress",
        headers={"Origin": "https://www.averlearning.com"},
    )
    assert r.headers.get("access-control-allow-origin") == "https://www.averlearning.com", (
        f"actual GET did not carry allow-origin; headers={dict(r.headers)}"
    )
