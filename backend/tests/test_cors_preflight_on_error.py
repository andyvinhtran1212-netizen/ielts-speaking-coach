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
