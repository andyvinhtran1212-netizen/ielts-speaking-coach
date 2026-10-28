"""PC-J55 — the flag-ON PostgREST transport fails fast on a wedged upstream.

A loopback fake PostgREST (no real network) answers, swallows or delays each
request in a scripted order. "Swallow" reads the request and never replies on
that connection: what a keep-alive socket silently dropped by an upstream hop
looks like to httpx. Before PC-J55 the async pool waited the full 120 s read
timeout; now a read fails after ``ASYNC_POSTGREST_TIMEOUT`` and an idempotent
GET is re-sent exactly once on a fresh connection, while writes never are.
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx
import pytest
from postgrest import AsyncPostgrestClient

import database
from config import settings
from services import db_async
from services.db_async import aexecute
from services.request_context import request_id_scope

_FAST = httpx.Timeout(0.5, connect=0.5, pool=0.5)
_USER = "8d0c1f5e-0000-4000-8000-00000000c0de"


class _FakePostgrest:
    """Scripted HTTP/1.1 keep-alive server: one action per request, in order."""

    def __init__(self, plan):
        self.plan = list(plan)
        self.connections = 0
        self.requests: list[tuple[int, str, str, str]] = []
        self._tasks: set[asyncio.Task] = set()
        self._server = None
        self.port = 0

    async def __aenter__(self):
        self._server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        self.port = self._server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *_exc):
        self._server.close()
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/rest/v1"

    async def _handle(self, reader, writer):
        self._tasks.add(asyncio.current_task())
        self.connections += 1
        conn = self.connections
        try:
            while True:
                head = (await reader.readuntil(b"\r\n\r\n")).decode("latin-1")
                lines = head.split("\r\n")
                method, target, _ = lines[0].split(" ", 2)
                length = 0
                for line in lines[1:]:
                    if line.lower().startswith("content-length:"):
                        length = int(line.split(":", 1)[1])
                if length:
                    await reader.readexactly(length)
                action = self.plan.pop(0) if self.plan else "ok"
                self.requests.append((conn, method, target.split("?", 1)[0], action))
                if action == "swallow":
                    await asyncio.sleep(3600)
                if action.startswith("delay:"):
                    await asyncio.sleep(float(action.split(":", 1)[1]))
                writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                             b"Content-Length: 2\r\n\r\n[]")
                await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionError, asyncio.CancelledError):
            pass
        finally:
            writer.close()
            self._tasks.discard(asyncio.current_task())


@pytest.fixture
def flag_on(monkeypatch):
    monkeypatch.setattr(settings, "USE_ASYNC_DB", True)
    monkeypatch.setattr(database, "ASYNC_POSTGREST_TIMEOUT", _FAST)


def _use_client(monkeypatch, http_client, url):
    pg = AsyncPostgrestClient(url, http_client=http_client)

    async def _get():
        return pg

    monkeypatch.setattr(database, "get_supabase_async", _get)


def _read(db):
    return db.table("users").select("id,role").eq("id", _USER)


# ── Transport contract ───────────────────────────────────────────────────────


def test_async_transport_is_bounded_well_below_caller_timeouts():
    t = database.ASYNC_POSTGREST_TIMEOUT
    assert (t.connect, t.read, t.write, t.pool) == (5.0, 15.0, 15.0, 5.0)
    assert database.ASYNC_POSTGREST_LIMITS.keepalive_expiry == 5.0

    client = database._build_supabase_async_http_client()
    try:
        assert client.timeout == t
        assert client._transport._pool._http2 is False
        assert client._transport._pool._keepalive_expiry == 5.0
        assert database._attach_call_trace in client.event_hooks["request"]
    finally:
        asyncio.run(client.aclose())


def test_sync_transport_keeps_its_timeout():
    # Flag-off parity: the sync singleton (and production) is untouched.
    client = database._build_supabase_http_client()
    try:
        assert client.timeout == httpx.Timeout(120.0)
    finally:
        client.close()


# ── Reproduction ─────────────────────────────────────────────────────────────


def test_pre_fix_transport_hangs_on_a_swallowed_keepalive_request():
    """The pre-PC-J55 async transport (HTTP/1.1, one 120 s timeout) is still
    waiting on a swallowed keep-alive request long after a healthy read; only
    the 120 s read timeout would end it, after any caller had given up."""

    async def run():
        async with _FakePostgrest(["ok", "swallow"]) as srv:
            old = httpx.AsyncClient(http1=True, http2=False, follow_redirects=True,
                                    timeout=httpx.Timeout(120.0))
            try:
                pg = AsyncPostgrestClient(srv.url, http_client=old)
                await _read(pg).execute()
                with pytest.raises(asyncio.TimeoutError):
                    await asyncio.wait_for(_read(pg).execute(), timeout=2.0)
            finally:
                await old.aclose()
            return srv

    srv = asyncio.run(run())
    assert [(c, a) for c, _m, _p, a in srv.requests] == [(1, "ok"), (1, "swallow")]


def test_swallowed_get_fails_fast_and_retries_once_on_a_new_connection(
        monkeypatch, flag_on, caplog):
    caplog.set_level(logging.WARNING, logger="services.db_async")
    before = db_async.snapshot()

    async def run():
        async with _FakePostgrest(["ok", "swallow", "ok"]) as srv:
            http_client = database._build_supabase_async_http_client()
            _use_client(monkeypatch, http_client, srv.url)
            try:
                with request_id_scope("l0129-test-rid"):
                    await aexecute(_read)  # warms a keep-alive connection
                    start = time.perf_counter()
                    res = await aexecute(_read)
                    elapsed = time.perf_counter() - start
            finally:
                await http_client.aclose()
            return srv, res, elapsed

    srv, res, elapsed = asyncio.run(run())
    assert res.data == []
    assert elapsed < 5.0, f"must fail fast and recover, took {elapsed:.1f}s"
    assert [(c, m, a) for c, m, _p, a in srv.requests] == [
        (1, "GET", "ok"), (1, "GET", "swallow"), (2, "GET", "ok")]
    after = db_async.snapshot()
    assert after["retries"] - before["retries"] == 1
    assert after["transport_errors"] - before["transport_errors"] == 1
    assert after["in_flight"] == 0

    text = caplog.text
    assert "[async-db] retry" in text and "[async-db] failed" in text
    assert "l0129-test-rid" in text and "'table': 'users'" in text
    assert "ReadTimeout" in text
    assert _USER not in text, "filters carry user ids; never logged"


def test_get_failing_twice_raises_after_exactly_two_attempts(monkeypatch, flag_on):
    async def run():
        async with _FakePostgrest(["swallow", "swallow", "ok"]) as srv:
            http_client = database._build_supabase_async_http_client()
            _use_client(monkeypatch, http_client, srv.url)
            try:
                start = time.perf_counter()
                with pytest.raises(httpx.ReadTimeout):
                    await aexecute(_read)
                elapsed = time.perf_counter() - start
            finally:
                await http_client.aclose()
            return srv, elapsed

    srv, elapsed = asyncio.run(run())
    assert len(srv.requests) == 2
    assert elapsed < 5.0


@pytest.mark.parametrize("method,build", [
    ("POST", lambda db: db.table("user_vocabulary").insert({"user_id": _USER})),
    ("PATCH", lambda db: db.table("users").update({"last_seen_at": "now"}).eq("id", _USER)),
    ("POST", lambda db: db.rpc("fn_probe", {"p_user": _USER})),
])
def test_writes_are_never_retried(monkeypatch, flag_on, method, build):
    before = db_async.snapshot()

    async def run():
        async with _FakePostgrest(["swallow", "ok"]) as srv:
            http_client = database._build_supabase_async_http_client()
            _use_client(monkeypatch, http_client, srv.url)
            try:
                with pytest.raises(httpx.ReadTimeout):
                    await aexecute(build)
            finally:
                await http_client.aclose()
            return srv

    srv = asyncio.run(run())
    assert [(m, a) for _c, m, _p, a in srv.requests] == [(method, "swallow")]
    assert db_async.snapshot()["retries"] == before["retries"]


def test_slow_call_log_splits_pool_wait_from_upstream_time(monkeypatch, flag_on, caplog):
    caplog.set_level(logging.WARNING, logger="services.db_async")
    monkeypatch.setattr(database, "ASYNC_POSTGREST_TIMEOUT", httpx.Timeout(5.0))
    monkeypatch.setattr(database, "ASYNC_POSTGREST_LIMITS", httpx.Limits(max_connections=1))
    monkeypatch.setattr(db_async, "SLOW_CALL_MS", 300.0)

    async def run():
        async with _FakePostgrest(["delay:0.6", "ok"]) as srv:
            http_client = database._build_supabase_async_http_client()
            _use_client(monkeypatch, http_client, srv.url)
            try:
                first = asyncio.create_task(aexecute(_read))
                await asyncio.sleep(0.1)  # the first call holds the only connection
                await aexecute(_read)
                await first
            finally:
                await http_client.aclose()

    asyncio.run(run())
    slow = [r.args[1] for r in caplog.records if r.args and r.args[0] == "slow"]
    assert len(slow) == 2
    held, waited = slow
    assert held["upstream_ms"] >= 500 and held["pool_wait_ms"] < 200
    assert waited["pool_wait_ms"] >= 300 and waited["upstream_ms"] < 300


def test_flag_off_path_is_untouched_by_the_guard(monkeypatch):
    # FR-001: the sync path neither retries nor records; errors propagate as today.
    monkeypatch.setattr(settings, "USE_ASYNC_DB", False)
    before = db_async.snapshot()
    calls = []

    class _Builder:
        def execute(self):
            calls.append(1)
            raise httpx.ReadTimeout("boom")

    with pytest.raises(httpx.ReadTimeout):
        asyncio.run(aexecute(lambda _c: _Builder(), sync_client=object()))
    assert calls == [1]
    assert db_async.snapshot() == before


def test_async_pool_snapshot_reports_the_live_pool(monkeypatch):
    async def run():
        async with _FakePostgrest(["ok"]) as srv:
            http_client = database._build_supabase_async_http_client()
            monkeypatch.setattr(database, "_supabase_async_postgrest_http_client", http_client)
            try:
                await _read(AsyncPostgrestClient(srv.url, http_client=http_client)).execute()
                return database.async_pool_snapshot()
            finally:
                await http_client.aclose()

    snap = asyncio.run(run())
    assert snap == {"connections": 1, "idle": 1, "active": 0,
                    "waiting_for_connection": 0, "max_connections": 100}
    monkeypatch.setattr(database, "_supabase_async_postgrest_http_client", None)
    assert database.async_pool_snapshot() is None
