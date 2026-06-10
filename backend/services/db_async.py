"""Async DB facade — P0-1 (C-1.1) scaffold.

`aexecute(build)` is the single seam routers will migrate to. It runs a
PostgREST query through either the async client (await) or the sync singleton
(direct), gated by ``settings.USE_ASYNC_DB``:

    rows = await aexecute(
        lambda db: db.table("sessions").select("*").eq("id", sid)
    )

``build`` is a callable ``client -> builder`` that constructs (but does NOT
execute) the query against whichever client the facade picked. The facade then
calls ``.execute()`` on it.

Contract: the return value is the same PostgREST ``APIResponse`` either way, so
a migrated call-site is byte-identical in BOTH flag states.

Why ``build(client)`` and not a prebuilt query: the query builder is bound to a
specific client at ``.table()`` time, so the facade must hand the call-site the
right client. The OFF branch calls the sync singleton DIRECTLY (current
behavior, blocking) — it deliberately does NOT wrap supabase_admin in
to_thread/threadpool, because httpx.Client + the builder are not thread-safe
and concurrent threads sharing the singleton would race.
"""

from __future__ import annotations

from typing import Any, Callable

from config import settings
import database


async def aexecute(build: Callable[[Any], Any]) -> Any:
    """Execute ``build(client).execute()`` via the flag-selected client."""
    if settings.USE_ASYNC_DB:
        client = await database.get_supabase_async()
        return await build(client).execute()
    # USE_ASYNC_DB off — today's exact behavior: direct sync execute on the
    # event-loop thread (blocking, but functionally identical). NOT threaded.
    return build(database.supabase_admin).execute()
