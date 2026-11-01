"""PC-J157 — /auth/check-active never puts the DB exception text in its detail.

main.py replaces every 5xx detail with the sanitized envelope, but the route
itself must not depend on that: on an app without the handler (a router test,
or a handler change) the raw exception text would reach the client. The error
is logged instead.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.testclient import TestClient

import main
import routers.auth as auth_module
from services.errors import GENERIC_MESSAGE

_MARKER = "relation users secret-marker 42P01"


async def _fake_user(_authorization):
    return {"id": "u-1", "email": "u1@example.test"}


async def _failing_aexecute(*_a, **_k):
    raise Exception(_MARKER)


def _patch(monkeypatch):
    monkeypatch.setattr(auth_module, "get_supabase_user", _fake_user)
    monkeypatch.setattr(auth_module, "aexecute", _failing_aexecute)


def test_check_active_detail_has_no_exception_text_without_handler(monkeypatch, caplog):
    _patch(monkeypatch)
    app = FastAPI()  # the real router, no sanitizing exception handler
    app.include_router(auth_module.router)

    with caplog.at_level(logging.WARNING, logger=auth_module.logger.name):
        resp = TestClient(app).get("/auth/check-active",
                                   headers={"Authorization": "Bearer t"})

    assert resp.status_code == 503
    body = resp.text
    for leak in ("secret-marker", "42P01", "Exception(", _MARKER):
        assert leak not in body
    assert resp.json() == {
        "detail": "Lỗi khi kiểm tra trạng thái tài khoản. Vui lòng thử lại."}
    assert any(_MARKER in r.getMessage() and "u-1" in r.getMessage()
               for r in caplog.records), "the lookup error is logged"


def test_check_active_real_app_keeps_sanitized_envelope(monkeypatch):
    _patch(monkeypatch)
    resp = TestClient(main.app).get("/auth/check-active",
                                    headers={"Authorization": "Bearer t"})

    assert resp.status_code == 503
    body = resp.json()
    body["detail"].pop("ref")  # a fresh error reference per response
    assert body == {"detail": {"error_code": "internal_error",
                               "message": GENERIC_MESSAGE}}
    assert "secret-marker" not in resp.text
