"""CORS: a 500 on a PREFLIGHT must not read as "method not allowed".

PROD 2026-07-26. A student's console filled with

    Access to fetch at '…/api/reading/test/attempts/<id>/answers' from origin
    'https://www.averlearning.com' has been blocked by CORS policy: Method
    PATCH is not allowed by Access-Control-Allow-Methods in preflight response

Every Listening/Reading answer save is a PATCH, so the browser blocked all of
them BEFORE they left the machine: nothing reached the server, nothing was
logged, and two full sections were graded 0. Writing survived only because it
is a POST — that asymmetry is what identified the cause.

The unhandled-exception handler attaches CORS headers by hand (an unhandled 500
unwinds OUTSIDE CORSMiddleware), and it attached Allow-Origin WITHOUT
Allow-Methods. A preflight answered that way is read by the browser as "that
method is not allowed" — the exact message above. These tests pin the headers
and the max-age, because both are invisible until an exam is already lost.
"""

from __future__ import annotations

import re
from pathlib import Path

import main as app_main

ALLOWED = "https://www.averlearning.com"


def test_an_allowed_origin_gets_the_methods_too():
    """The bug: Allow-Origin present, Allow-Methods absent."""
    h = app_main._cors_headers_for_origin(ALLOWED)
    assert h["Access-Control-Allow-Origin"] == ALLOWED
    assert "PATCH" in h["Access-Control-Allow-Methods"], (
        "a 500 on a preflight would read as 'PATCH not allowed'")
    assert "Access-Control-Allow-Headers" in h


def test_the_error_path_matches_the_middleware_exactly():
    """Two sources of truth drift; that drift is what shipped. Both now read the
    same constants, and this fails the moment someone edits only one."""
    h = app_main._cors_headers_for_origin(ALLOWED)
    assert h["Access-Control-Allow-Methods"] == ", ".join(app_main._CORS_METHODS)
    assert h["Access-Control-Allow-Headers"] == ", ".join(app_main._CORS_HEADERS)


def test_every_method_the_app_actually_uses_is_allowed():
    """PATCH is the one that mattered: it carries every Listening/Reading answer.
    POST is what let Writing survive the same incident."""
    for m in ("GET", "POST", "PATCH", "DELETE", "OPTIONS"):
        assert m in app_main._CORS_METHODS


def test_a_foreign_origin_is_never_reflected():
    """Widening the header set must not widen WHO gets it."""
    for bad in ("https://evil.com", "https://averlearning.com.evil.com", None, ""):
        assert app_main._cors_headers_for_origin(bad) == {}


def test_the_apex_and_subdomains_still_match():
    for good in ("https://averlearning.com", "https://www.averlearning.com",
                 "https://staging.averlearning.com"):
        assert app_main._cors_headers_for_origin(good), good


def test_the_preflight_cache_is_capped_at_what_chrome_honours():
    """86400 was chosen on a false premise — the code claimed it was "the maximum
    Chromium honours" when Chromium caps Access-Control-Max-Age at 7200 SECONDS.
    So the extra 22 hours bought nothing on the browser nearly every student
    uses, while letting a bad preflight stick to a Firefox user's browser for a
    full day with no way for them to recover. A student who loses their preflight
    loses every PATCH — i.e. every answer they type.
    """
    src = (Path(__file__).resolve().parents[1] / "main.py").read_text(encoding="utf-8")
    m = re.search(r"max_age=(\d+)", src)
    assert m, "max_age not found"
    assert int(m.group(1)) <= 7200, (
        f"max_age={m.group(1)} exceeds what Chromium honours (7200s) and widens "
        "the blast radius of a bad preflight"
    )


def test_the_false_claim_about_chromium_is_gone():
    """The wrong comment is why the wrong number looked justified."""
    src = (Path(__file__).resolve().parents[1] / "main.py").read_text(encoding="utf-8")
    assert "86400\n    # is the maximum Chromium honours" not in src
    assert "maximum Chromium honours" not in src


# ── The preflight must SUCCEED, not merely carry the right headers ────
#
# Codex review PR #861 (correct, P1): adding Allow-Methods to a 500 only changed
# which console message the student got. The Fetch spec requires a preflight to
# have an OK status, so a 500 still blocks the real request — every PATCH, i.e.
# every answer they type. These drive the real ASGI app with a middleware that
# raises, which is the production shape: three custom middlewares are registered
# AFTER CORSMiddleware and therefore wrap OUTSIDE it, so an OPTIONS preflight
# passes through them before CORS can short-circuit it.

import pytest
from fastapi.testclient import TestClient

PREFLIGHT = {
    "Origin": ALLOWED,
    "Access-Control-Request-Method": "PATCH",
    "Access-Control-Request-Headers": "authorization,content-type",
}


@pytest.fixture()
def client_with_a_broken_outer_middleware(monkeypatch):
    """Reproduce the failure: something outside CORSMiddleware raises."""
    from starlette.middleware.base import BaseHTTPMiddleware

    class _Boom(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            raise RuntimeError("an outer middleware blew up")

    # NOT app.add_middleware(): Starlette refuses that once any earlier test in
    # the session has started the app ("Cannot add middleware after an
    # application has started"). Splice the layer in and rebuild the stack
    # directly — user_middleware[0] is the OUTERMOST layer, which is exactly
    # where the production middlewares that can break a preflight sit.
    from starlette.middleware import Middleware

    app = app_main.app
    saved = list(app.user_middleware)
    app.user_middleware.insert(0, Middleware(_Boom))
    app.middleware_stack = app.build_middleware_stack()
    try:
        yield TestClient(app, raise_server_exceptions=False)
    finally:
        app.user_middleware = saved
        app.middleware_stack = app.build_middleware_stack()


def test_a_broken_preflight_still_answers_200(client_with_a_broken_outer_middleware):
    """The whole point. 500 here means the browser blocks the PATCH."""
    r = client_with_a_broken_outer_middleware.options(
        "/api/reading/test/attempts/abc/answers", headers=PREFLIGHT)
    assert r.status_code == 200, (
        "a failed preflight blocks every answer save client-side, where nothing "
        "can see it")
    assert "PATCH" in r.headers.get("access-control-allow-methods", "")
    assert r.headers.get("access-control-allow-origin") == ALLOWED


def test_the_real_request_still_fails_loudly(client_with_a_broken_outer_middleware):
    """Rescuing the preflight must NOT paper over the fault. The actual request
    still hits the broken component — and a 500 there is logged, visible to the
    client and diagnosable, which an invisible CORS block never was."""
    r = client_with_a_broken_outer_middleware.patch(
        "/api/reading/test/attempts/abc/answers",
        json={"q_num": 1, "user_answer": "x"},
        headers={"Origin": ALLOWED},
    )
    assert r.status_code == 500
    assert r.headers.get("access-control-allow-origin") == ALLOWED, (
        "without ACAO the browser masks the real status as a CORS error")


def test_only_a_real_preflight_is_rescued(client_with_a_broken_outer_middleware):
    """A bare OPTIONS with no Access-Control-Request-Method is NOT a preflight —
    turning every failed OPTIONS into a 200 would hide real faults."""
    r = client_with_a_broken_outer_middleware.options(
        "/api/reading/test/attempts/abc/answers", headers={"Origin": ALLOWED})
    assert r.status_code == 500


def test_a_foreign_origin_is_not_rescued(client_with_a_broken_outer_middleware):
    """The rescue rides on the allowlist, exactly like the headers do."""
    r = client_with_a_broken_outer_middleware.options(
        "/api/reading/test/attempts/abc/answers",
        headers={**PREFLIGHT, "Origin": "https://evil.com"})
    assert r.status_code == 500


def test_the_permission_memo_is_skipped_for_preflights():
    """Second layer: the outer middleware that CAN raise now does nothing for a
    preflight, so the commonest path to this failure is closed at the source."""
    import inspect
    src = inspect.getsource(app_main.access_perm_memo_middleware)
    assert 'request.method == "OPTIONS"' in src
    assert "access-control-request-method" in src
