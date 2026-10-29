import logging
import sys
import threading
import time
from contextvars import ContextVar
import httpx
from supabase import create_client, Client
from config import settings

# P0-1 (C-1.1) async-DB scaffold. AsyncClient / create_async_client are only
# imported for the optional async path; the sync `supabase_admin` singleton
# remains the default (USE_ASYNC_DB off) path. Its PostgREST transport is tuned
# below, without changing the public client/query contract.
try:  # pragma: no cover - import guard for older supabase-py
    from supabase import create_async_client, AsyncClient  # type: ignore
except Exception:  # pragma: no cover
    create_async_client = None  # type: ignore
    AsyncClient = None  # type: ignore

import supabase as _supabase_pkg
try:
    import postgrest as _postgrest_pkg
except ImportError:
    pass
try:
    import storage3 as _storage3_pkg
except ImportError:
    pass

_url = settings.SUPABASE_URL
_key = settings.SUPABASE_SERVICE_KEY


def _build_supabase_http_client() -> httpx.Client:
    """Build the shared sync transport used by service-role PostgREST calls.

    PostgREST's default client enables HTTP/2 and keeps one busy connection
    alive indefinitely. Supabase sends a graceful GOAWAY after 19,999 streams;
    httpcore then raises ``ConnectionTerminated`` on the in-flight request. A
    live mock-exam room polls often enough to hit that ceiling, turning normal
    sitting/status reads into intermittent 500s. HTTP/1.1 keeps connection
    pooling without the per-connection stream counter.

    Keep this as an explicit factory so the transport contract is testable
    without making a network request.
    """
    return httpx.Client(
        http1=True,
        http2=False,
        follow_redirects=True,
        timeout=httpx.Timeout(120.0),
    )


# PC-J55: the async pool carries every per-request auth check once
# USE_ASYNC_DB is on, so one wedged connection must not hold a request for
# 120 s — longer than any caller waits, which hides the failure from the
# server log. A PostgREST auth read takes ~0.1–0.3 s cross-region; 15 s read
# leaves a wide margin. connect/pool fail fast so a dead upstream or a full
# pool surfaces as an error, not a silent queue. Limits are httpx's defaults,
# made explicit so /health/async-db can report capacity against them.
ASYNC_POSTGREST_TIMEOUT = httpx.Timeout(15.0, connect=5.0, pool=5.0)
ASYNC_POSTGREST_LIMITS = httpx.Limits(
    max_connections=100, max_keepalive_connections=20, keepalive_expiry=5.0,
)

# Per-call timing for services.db_async.aexecute: the facade sets a dict here
# around each attempt, and the httpcore trace hook stamps when the request got
# a connection, so a slow call splits into pool wait / connect / server time.
async_call_trace: ContextVar[dict | None] = ContextVar("async_call_trace", default=None)

_TRACE_STAMPS = {
    "connection.connect_tcp.started": "connect_at",
    "http11.send_request_headers.started": "sent_at",
}


async def _stamp_httpcore_event(name: str, _info: dict) -> None:
    rec = async_call_trace.get()
    key = _TRACE_STAMPS.get(name)
    if rec is not None and key is not None:
        rec.setdefault(key, time.perf_counter())


async def _attach_call_trace(request: httpx.Request) -> None:
    if async_call_trace.get() is not None:
        request.extensions["trace"] = _stamp_httpcore_event


def _build_supabase_async_http_client() -> httpx.AsyncClient:
    """Async twin of :func:`_build_supabase_http_client` for the opt-in
    ``USE_ASYNC_DB`` client. postgrest's ``AsyncPostgrestClient`` also defaults
    to HTTP/2, and the async client carries every per-request auth check once
    the flag is on, so it would reach the 19,999-stream GOAWAY ceiling first."""
    return httpx.AsyncClient(
        http1=True,
        http2=False,
        follow_redirects=True,
        timeout=ASYNC_POSTGREST_TIMEOUT,
        limits=ASYNC_POSTGREST_LIMITS,
        event_hooks={"request": [_attach_call_trace]},
    )


supabase_admin: Client = create_client(_url, _key)
_supabase_postgrest_http_client: httpx.Client | None = None


def init_supabase_http_client() -> httpx.Client:
    """Create/recreate the PostgREST pool for the current ASGI lifespan.

    TestClient and embedded servers may run more than one startup/shutdown
    cycle in the same interpreter. Reusing the module after shutdown must not
    leave ``supabase_admin`` bound to a permanently closed httpx session.
    """
    global _supabase_postgrest_http_client
    current = _supabase_postgrest_http_client
    if current is not None and not current.is_closed:
        return current

    current = _build_supabase_http_client()
    _supabase_postgrest_http_client = current
    # Scope the override to PostgREST. Supplying it through SyncClientOptions
    # would also replace the Auth/Storage/Functions transports and silently
    # erase their shorter, service-specific timeouts (Storage 20s, Functions
    # 5s).
    supabase_admin._postgrest = supabase_admin._init_postgrest_client(
        rest_url=str(supabase_admin.rest_url),
        headers=supabase_admin.options.headers,
        schema=supabase_admin.options.schema,
        timeout=supabase_admin.options.postgrest_client_timeout,
        http_client=current,
    )
    return current


init_supabase_http_client()


def close_supabase_http_client() -> None:
    """Release the shared sync connection pool during application shutdown."""
    if (_supabase_postgrest_http_client is not None
            and not _supabase_postgrest_http_client.is_closed):
        _supabase_postgrest_http_client.close()


# ── P0-1 async client (lazy, opt-in) ─────────────────────────────────────────
# create_async_client is a COROUTINE, so the client is built from the startup
# hook (or lazily on first facade use) — never at import time. One shared
# AsyncClient is safe for concurrent use on the single event loop (unlike the
# sync httpx.Client singleton across threads, which is why we never to_thread
# supabase_admin). Only created when USE_ASYNC_DB is on; stays None otherwise,
# so the scaffold adds nothing to the default sync path.
_supabase_async = None  # type: ignore[var-annotated]
_supabase_async_postgrest_http_client: httpx.AsyncClient | None = None


async def init_supabase_async():
    """Create the shared async client once. Safe to call repeatedly (idempotent)."""
    global _supabase_async, _supabase_async_postgrest_http_client
    if _supabase_async is None:
        if create_async_client is None:  # pragma: no cover - old supabase-py
            raise RuntimeError(
                "USE_ASYNC_DB is on but supabase-py has no create_async_client"
            )
        client = await create_async_client(_url, _key)
        # Same PostgREST-only HTTP/1.1 override as the sync singleton above;
        # Auth/Storage/Functions keep their own transports and timeouts.
        transport = _build_supabase_async_http_client()
        client._postgrest = client._init_postgrest_client(
            rest_url=str(client.rest_url),
            headers=client.options.headers,
            schema=client.options.schema,
            timeout=client.options.postgrest_client_timeout,
            http_client=transport,
        )
        _supabase_async_postgrest_http_client = transport
        _supabase_async = client
    return _supabase_async


async def get_supabase_async():
    """Return the shared async client, initialising it on first use."""
    if _supabase_async is None:
        return await init_supabase_async()
    return _supabase_async


def async_client_initialised() -> bool:
    return _supabase_async is not None


def async_pool_snapshot() -> dict | None:
    """Connection counts of the async PostgREST pool for /health/async-db, or
    ``None`` when the async client was never built (flag off). Reads httpcore
    internals, so any shape drift degrades to ``{"unavailable": True}``."""
    transport = _supabase_async_postgrest_http_client
    if transport is None or transport.is_closed:
        return None
    try:
        pool = transport._transport._pool
        conns = list(pool.connections)
        waiting = sum(1 for r in list(pool._requests) if r.connection is None)
        idle = sum(1 for c in conns if c.is_idle())
    except Exception:
        return {"unavailable": True}
    return {
        "connections": len(conns),
        "idle": idle,
        "active": len(conns) - idle,
        "waiting_for_connection": waiting,
        "max_connections": ASYNC_POSTGREST_LIMITS.max_connections,
    }


async def close_supabase_async() -> None:
    """Release the async client's PostgREST pool at shutdown. The next startup
    (TestClient lifespans can restart in one interpreter) builds a fresh one."""
    global _supabase_async, _supabase_async_postgrest_http_client
    transport = _supabase_async_postgrest_http_client
    _supabase_async = None
    _supabase_async_postgrest_http_client = None
    if transport is not None and not transport.is_closed:
        await transport.aclose()


# ── Per-thread service-role clients (PC-J05 D1b) ─────────────────────────────
# The shared sync singleton must never be used from two threads at once (see
# services/db_async.py). Aggregators that fan independent sections out with
# ``asyncio.to_thread`` call ``thread_supabase_admin()`` INSIDE the worker
# thread instead: each executor thread lazily builds its own service-role
# client and keeps it, so sections never share a client and a thread reuses its
# keep-alive connection on the next request rather than paying a new TLS
# handshake per section.
_thread_clients = threading.local()


def thread_supabase_admin() -> Client:
    """The calling thread's own service-role client (HTTP/1.1 PostgREST)."""
    client = getattr(_thread_clients, "client", None)
    if client is None:
        client = create_client(_url, _key)
        client._postgrest = client._init_postgrest_client(
            rest_url=str(client.rest_url),
            headers=client.options.headers,
            schema=client.options.schema,
            timeout=client.options.postgrest_client_timeout,
            http_client=_build_supabase_http_client(),
        )
        _thread_clients.client = client
    return client
