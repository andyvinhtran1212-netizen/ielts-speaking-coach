"""PC-J92 — handled HTTPException >= 500 must reach error_logs (PC-J75 F3).

Before: only the unhandled-exception handler inserted error_logs, so a 503 a
route raised on purpose (e.g. `activation_unavailable` while migration 334 was
missing) never showed on /admin error logs. Now `http_exception_handler`
schedules the same fire-and-forget insert for every 5xx, capped per
(error_code, route template) per process, and never changes the response.
"""
from __future__ import annotations

import asyncio
import json
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

import main
from services.errors import safe_error

# Captured at import, before conftest's autouse fixture swaps in a no-op.
_REAL_INSERT = main._insert_error_log_safely

USER_ID = "00000000-0000-0000-0000-0000000000f9"
ACCESS_CODE = "secretcode-pcj92"
BEARER = "Bearer fake.jwt.pcj92"


@pytest.fixture(autouse=True)
def _fresh_limiter(monkeypatch):
    # The context-managed TestClient below runs the app lifespan; keep it from
    # starting the reapers / refresher (live Supabase) — only the request matters.
    monkeypatch.setattr(main.app.router, "on_startup", [])
    monkeypatch.setattr(main.app.router, "on_shutdown", [])
    main._handled_5xx_log_windows.clear()
    yield
    main._handled_5xx_log_windows.clear()


@pytest.fixture
def payloads(monkeypatch):
    rows: list[dict] = []
    monkeypatch.setattr(main, "_insert_error_log_safely", rows.append)
    return rows


class _FailingActivateCheck:
    """Supabase stand-in whose activate rate-limit RPC fails → 503."""

    def __init__(self):
        self.tables: list[str] = []

    def rpc(self, name, params):
        execute = MagicMock(side_effect=RuntimeError("could not connect to db-host:5432"))
        return MagicMock(execute=execute)

    def table(self, name):
        self.tables.append(name)
        raise AssertionError(f"activation reached table {name!r}")


def _activate(*, body=None):
    from routers import auth
    user = AsyncMock(return_value={"id": USER_ID, "email": "l@x", "user_metadata": {}})
    with patch.object(auth, "get_supabase_user", new=user), \
            patch.object(auth, "supabase_admin", _FailingActivateCheck()):
        # Context-managed client: one event loop for the request, and teardown
        # waits for the handler's background insert to finish.
        with TestClient(main.app, raise_server_exceptions=False) as client:
            return client.post(
                "/auth/activate",
                json={"access_code": ACCESS_CODE} if body is None else body,
                headers={"Authorization": BEARER},
            )


def _req(path="/things/{thing_id}", concrete="/things/42", method="GET", query=b""):
    return Request({
        "type": "http", "method": method, "path": concrete, "query_string": query,
        "headers": [], "state": {},
        "route": type("Route", (), {"path": path})(),
    })


def _handle(exc, request=None):
    async def run():
        resp = await main.http_exception_handler(request or _req(), exc)
        pending = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
        await asyncio.gather(*pending, return_exceptions=True)
        return resp
    return asyncio.run(run())


# ── the reported case: 503 activation_unavailable ───────────────────────────

def test_activation_unavailable_503_inserts_exactly_one_error_log(live_activate_rate_limit, payloads):
    r = _activate()

    assert r.status_code == 503, r.text
    assert r.json()["detail"]["error_code"] == "activation_unavailable"
    assert len(payloads) == 1
    row = payloads[0]
    assert row["level"] == "error" and row["source"] == "backend"
    assert row["message"] == "HTTP 503 activation_unavailable"
    assert row["url"] == "/auth/activate"
    assert row["request_id"] == r.headers["X-Request-ID"]
    assert row["extra"] == {"method": "POST", "status_code": 503,
                            "error_code": "activation_unavailable", "handled": True}
    assert set(row) == {"level", "source", "message", "url", "request_id", "extra"}
    raw = json.dumps(row)
    for secret in (ACCESS_CODE, BEARER, "fake.jwt", USER_ID, "db-host", "could not connect"):
        assert secret not in raw, f"{secret!r} leaked into error_logs"


def test_failing_insert_keeps_the_same_503(live_activate_rate_limit, monkeypatch, caplog):
    baseline = _activate()

    db = MagicMock()
    db.table.return_value.insert.return_value.execute.side_effect = RuntimeError("insert down")
    monkeypatch.setattr(main, "_insert_error_log_safely", _REAL_INSERT)
    monkeypatch.setattr(main, "supabase_admin", db)
    with caplog.at_level(logging.ERROR):
        r = _activate()

    db.table.assert_called_once_with("error_logs")
    assert "[error_logs] Background INSERT failed" in caplog.text
    assert r.status_code == baseline.status_code == 503
    assert r.json()["detail"].keys() == baseline.json()["detail"].keys()
    assert r.json()["detail"]["error_code"] == "activation_unavailable"
    assert r.json()["detail"]["message"] == baseline.json()["detail"]["message"]


@pytest.mark.parametrize("broken", ["_insert_error_log_safely", "_handled_5xx_log_allowed"])
def test_capture_that_raises_never_changes_the_response(live_activate_rate_limit, monkeypatch, broken):
    def boom(*_args, **_kwargs):
        raise RuntimeError("capture exploded")
    monkeypatch.setattr(main, broken, boom)
    r = _activate()
    assert r.status_code == 503
    assert r.json()["detail"]["error_code"] == "activation_unavailable"
    assert "capture exploded" not in r.text


# ── 4xx are unchanged and never logged ──────────────────────────────────────

def test_404_and_422_insert_nothing(payloads):
    from routers import auth
    user = AsyncMock(return_value={"id": USER_ID, "email": "l@x", "user_metadata": {}})
    with patch.object(auth, "get_supabase_user", new=user):
        with TestClient(main.app, raise_server_exceptions=False) as client:
            missing = client.get("/definitely-not-a-route-pcj92")
            invalid = client.post("/auth/activate", json={"wrong": 1},
                                  headers={"Authorization": BEARER})
    assert missing.status_code == 404
    assert invalid.status_code == 422
    assert payloads == []


@pytest.mark.parametrize("status", [400, 401, 403, 404, 409, 422, 429])
def test_handler_4xx_response_unchanged_and_not_logged(payloads, status):
    resp = _handle(HTTPException(status, "Không tìm thấy"))
    assert resp.status_code == status
    assert json.loads(resp.body) == {"detail": "Không tìm thấy"}
    assert payloads == []


def test_sanitized_500_logs_internal_error_without_the_leaked_text(payloads):
    resp = _handle(HTTPException(500, "db failed: password=hunter2"),
                   _req(query=b"token=abc&view=1"))
    assert resp.status_code == 500
    assert json.loads(resp.body)["detail"]["error_code"] == "internal_error"
    assert len(payloads) == 1
    assert payloads[0]["extra"]["error_code"] == "internal_error"
    assert payloads[0]["url"] == "/things/{thing_id}"
    raw = json.dumps(payloads[0])
    assert "hunter2" not in raw and "abc" not in raw and "/things/42" not in raw


# ── storm guard: 10 rows / 60 s per (error_code, route template) ────────────

def test_storm_is_capped_per_error_code_and_path(payloads, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr("time.monotonic", lambda: clock[0])
    exc = lambda: safe_error(None, status_code=503, error_code="activation_unavailable")  # noqa: E731

    for _ in range(main._HANDLED_5XX_LOG_LIMIT + 5):
        assert _handle(exc()).status_code == 503
    assert len(payloads) == main._HANDLED_5XX_LOG_LIMIT == 10

    # Other keys have their own budget.
    _handle(safe_error(None, status_code=503, error_code="ai_overrides_unavailable"))
    _handle(exc(), _req(path="/other", concrete="/other"))
    assert len(payloads) == 12

    # Still capped just before the window ends; a fresh window logs again.
    clock[0] += main._HANDLED_5XX_LOG_WINDOW_S - 0.1
    _handle(exc())
    assert len(payloads) == 12
    clock[0] += 0.1
    _handle(exc())
    assert len(payloads) == 13


def test_storm_over_threshold_via_route_stops_inserting(live_activate_rate_limit, payloads):
    for _ in range(main._HANDLED_5XX_LOG_LIMIT + 2):
        assert _activate().status_code == 503
    assert len(payloads) == main._HANDLED_5XX_LOG_LIMIT


def test_limiter_key_table_stays_bounded(payloads, monkeypatch):
    monkeypatch.setattr(main, "_HANDLED_5XX_LOG_MAX_KEYS", 3)
    for i in range(5):
        _handle(HTTPException(500, "x"), _req(path=f"/p{i}", concrete=f"/p{i}"))
    assert len(main._handled_5xx_log_windows) == 3
    assert len(payloads) == 3
