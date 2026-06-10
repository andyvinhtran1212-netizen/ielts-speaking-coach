import logging
import sys
from supabase import create_client, Client
from config import settings

# P0-1 (C-1.1) async-DB scaffold. AsyncClient / create_async_client are only
# imported for the optional async path; the sync `supabase_admin` singleton
# below is UNTOUCHED and remains the default (USE_ASYNC_DB off) fallback.
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

supabase_admin: Client = create_client(_url, _key)


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
