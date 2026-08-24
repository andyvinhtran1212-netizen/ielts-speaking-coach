import logging
import sys
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


async def init_supabase_async():
    """Create the shared async client once. Safe to call repeatedly (idempotent)."""
    global _supabase_async
    if _supabase_async is None:
        if create_async_client is None:  # pragma: no cover - old supabase-py
            raise RuntimeError(
                "USE_ASYNC_DB is on but supabase-py has no create_async_client"
            )
        _supabase_async = await create_async_client(_url, _key)
    return _supabase_async


async def get_supabase_async():
    """Return the shared async client, initialising it on first use."""
    if _supabase_async is None:
        return await init_supabase_async()
    return _supabase_async


def async_client_initialised() -> bool:
    return _supabase_async is not None
