"""Opt-in switch for FastAPI's interactive docs and HTTP schema endpoints.

``/openapi.json``, ``/docs``, ``/docs/oauth2-redirect`` and ``/redoc`` publish
the full route and model inventory. They stay closed unless
``ENABLE_API_DOCS`` holds an explicit truthy value, so staging and production
need no environment change to keep them closed. Set ``ENABLE_API_DOCS=1`` only
for local development.

Closing the HTTP endpoints does not affect ``app.openapi()``: CI and the
contract tests generate the schema in process (``.github/workflows/typecheck.yml``).
"""

from __future__ import annotations

_TRUTHY = frozenset({"1", "true", "yes", "on"})

_CLOSED_KWARGS = {
    "openapi_url": None,
    "docs_url": None,
    "redoc_url": None,
    "swagger_ui_oauth2_redirect_url": None,
}


def api_docs_enabled(flag: str | None) -> bool:
    """Only an explicit truthy value opens the docs; anything else stays closed."""
    return (flag or "").strip().lower() in _TRUTHY


def api_docs_kwargs(flag: str | None) -> dict:
    """``FastAPI(...)`` keyword arguments for the docs/schema endpoints.

    Opted in → ``{}`` (FastAPI's default URLs). Otherwise every URL is ``None``,
    so FastAPI registers none of the routes and requests for them return 404.
    """
    return {} if api_docs_enabled(flag) else dict(_CLOSED_KWARGS)
