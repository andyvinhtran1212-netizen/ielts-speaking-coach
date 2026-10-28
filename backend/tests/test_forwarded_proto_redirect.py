"""SEC-20261028-01 — trailing-slash redirects must not downgrade to http://.

Behind Railway the app receives plain HTTP with ``X-Forwarded-Proto: https``.
Before the fix the 307 for ``/api/student/permissions/`` carried
``Location: http://…`` and a following client re-sent its bearer token in
cleartext.
"""
from __future__ import annotations

import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.forwarded_proto import ForwardedProtoMiddleware

PATH = "/api/student/permissions/"
HOST = "ielts-speaking-coach-staging.up.railway.app"


def _main_client() -> TestClient:
    from main import app
    # The edge-to-app hop is plain http; only the header says https.
    return TestClient(app, base_url=f"http://{HOST}", raise_server_exceptions=False)


def test_main_app_slash_redirect_keeps_https_from_forwarded_proto():
    resp = _main_client().get(
        PATH,
        headers={"X-Forwarded-Proto": "https", "Authorization": "Bearer not-a-real-token"},
        follow_redirects=False,
    )
    assert resp.status_code == 307
    assert resp.headers["location"] == f"https://{HOST}/api/student/permissions"


def test_main_app_https_base_url_redirect_stays_https():
    from main import app
    resp = TestClient(app, base_url="https://x", raise_server_exceptions=False).get(
        PATH, headers={"X-Forwarded-Proto": "https"}, follow_redirects=False,
    )
    assert resp.status_code == 307
    assert resp.headers["location"].startswith("https://")


def test_main_app_without_forwarded_proto_is_unchanged():
    # Local development (no proxy) keeps the scheme the socket actually used.
    resp = _main_client().get(PATH, follow_redirects=False)
    assert resp.status_code == 307
    assert resp.headers["location"] == f"http://{HOST}/api/student/permissions"


def test_forwarded_proto_middleware_is_outermost():
    from main import app
    assert app.user_middleware[0].cls is ForwardedProtoMiddleware


def _scope_seen(scope: dict) -> dict:
    seen = {}

    async def inner(s, receive, send):
        seen.update(s)

    asyncio.run(ForwardedProtoMiddleware(inner)(scope, None, None))
    return seen


def _http_scope(scheme: str, proto: bytes | None, kind: str = "http") -> dict:
    headers = [(b"host", b"x")]
    if proto is not None:
        headers.append((b"x-forwarded-proto", proto))
    return {"type": kind, "scheme": scheme, "headers": headers,
            "client": ("10.0.0.1", 1234)}


def test_upgrades_http_and_ws_only_when_edge_reports_https():
    assert _scope_seen(_http_scope("http", b"https"))["scheme"] == "https"
    assert _scope_seen(_http_scope("http", b"HTTPS"))["scheme"] == "https"
    assert _scope_seen(_http_scope("http", b"https, http"))["scheme"] == "https"
    assert _scope_seen(_http_scope("ws", b"https", "websocket"))["scheme"] == "wss"
    assert _scope_seen(_http_scope("http", b"http"))["scheme"] == "http"
    assert _scope_seen(_http_scope("http", None))["scheme"] == "http"


def test_never_downgrades_and_leaves_client_address_alone():
    seen = _scope_seen(_http_scope("https", b"http"))
    assert seen["scheme"] == "https"
    seen = _scope_seen(_http_scope("http", b"https") | {
        "headers": [(b"x-forwarded-proto", b"https"), (b"x-forwarded-for", b"203.0.113.9")],
    })
    assert seen["client"] == ("10.0.0.1", 1234)


def test_lifespan_scope_passes_through_untouched():
    scope = {"type": "lifespan"}
    assert _scope_seen(scope) == scope


def test_standalone_app_redirect_uses_https():
    app = FastAPI()

    @app.get("/items")
    def items():
        return []

    app.add_middleware(ForwardedProtoMiddleware)
    resp = TestClient(app, base_url="http://edge").get(
        "/items/", headers={"X-Forwarded-Proto": "https"}, follow_redirects=False)
    assert resp.status_code == 307
    assert resp.headers["location"] == "https://edge/items"
