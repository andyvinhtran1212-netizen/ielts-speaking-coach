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

``sync_client`` (PC-J05): a call-site whose module imported ``supabase_admin``
passes that module global, so the OFF branch runs on exactly the client it
used before migration (and test doubles patched onto that module still apply).

PC-J55: with the flag on, each call is timed (slow or failed calls are logged
with the request id, table and pool-wait/connect/upstream split; never the
query string) and an idempotent GET/HEAD whose socket died is sent once more.
Writes and RPCs are never re-sent. The flag-off branch is unchanged.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from typing import Any, Callable

import httpx

from config import settings
import database
from services.loop_monitor import _percentile
from services.request_context import current_request_id

logger = logging.getLogger(__name__)

# PC-J55 — flag-ON transport guard and call timing.
# Only idempotent reads are re-sent, once: a write that timed out may already
# have committed upstream, so it surfaces as an error instead.
_RETRY_METHODS = frozenset({"GET", "HEAD"})
# PC-J84: rpc(get=True)/rpc(head=True) also go out as GET/HEAD, but a function
# can have effects outside the read-only transaction, so RPCs are never re-sent.
_RPC_PATH = "/rpc/"
# PC-J84: only a dead socket is worth a fresh connection. PoolTimeout (a
# saturated pool) and the other TransportErrors would just wait again.
_RETRY_ERRORS = (
    httpx.ReadTimeout,
    httpx.ReadError,
    httpx.RemoteProtocolError,
    httpx.WriteError,
    httpx.ConnectError,
)
# A call at or over this is logged with its request id and timing breakdown.
SLOW_CALL_MS = 1000.0
_WINDOW = 512

_durations_ms: deque = deque(maxlen=_WINDOW)
_in_flight: dict[int, float] = {}
_counts = {"calls": 0, "transport_errors": 0, "retries": 0, "slow_calls": 0}


def _path(builder: Any) -> str:
    req = getattr(builder, "request", None)
    return str(getattr(getattr(req, "path", None), "path", "") or "")


def _target(builder: Any) -> tuple[str, str]:
    """``(method, table)`` of a postgrest builder. Never the query string:
    filters carry user ids."""
    req = getattr(builder, "request", None)
    method = str(getattr(req, "http_method", "") or "?").upper()
    path = _path(builder)
    table = path.split("/rest/v1/", 1)[1] if "/rest/v1/" in path else path.rsplit("/", 1)[-1]
    return method, table or "?"


def _ms(start: float | None, end: float | None) -> float | None:
    if start is None or end is None:
        return None
    return round((end - start) * 1000, 1)


def _record(method: str, table: str, attempt: int, start: float, end: float,
            stamps: dict, error: BaseException | None) -> None:
    total = (end - start) * 1000
    _counts["calls"] += 1
    _durations_ms.append(total)
    failed = isinstance(error, httpx.TransportError)
    if failed:
        _counts["transport_errors"] += 1
    if total < SLOW_CALL_MS and not failed:
        return
    if not failed:
        _counts["slow_calls"] += 1
    connect_at, sent_at = stamps.get("connect_at"), stamps.get("sent_at")
    # PoolTimeout: the call never got a connection, so all of it was pool wait.
    pool_wait = (round(total, 1) if isinstance(error, httpx.PoolTimeout)
                 else _ms(start, connect_at if connect_at is not None else sent_at))
    logger.warning("[async-db] %s %s", "failed" if failed else "slow", {
        "request_id": current_request_id(),
        "method": method,
        "table": table,
        "attempt": attempt,
        "total_ms": round(total, 1),
        # until the request had a connection: new socket or pooled keep-alive
        "pool_wait_ms": pool_wait,
        "connect_ms": _ms(connect_at, sent_at),
        "upstream_ms": _ms(sent_at, end),
        "error": type(error).__name__ if failed else None,
    })


async def _execute_timed(builder: Any, method: str, table: str, attempt: int) -> Any:
    stamps: dict = {}
    token = database.async_call_trace.set(stamps)
    start = time.perf_counter()
    _in_flight[id(stamps)] = start
    error: BaseException | None = None
    try:
        return await builder.execute()
    except BaseException as exc:
        error = exc
        raise
    finally:
        _in_flight.pop(id(stamps), None)
        database.async_call_trace.reset(token)
        _record(method, table, attempt, start, time.perf_counter(), stamps, error)


def snapshot() -> dict:
    """Rolling flag-ON call stats for /health/async-db (milliseconds)."""
    now = time.perf_counter()
    vals = sorted(_durations_ms)
    oldest = max((now - s for s in list(_in_flight.values())), default=0.0)
    return {
        **_counts,
        "in_flight": len(_in_flight),
        "oldest_in_flight_ms": round(oldest * 1000, 1),
        "window": len(vals),
        "ms_p50": round(_percentile(vals, 0.50), 1),
        "ms_p95": round(_percentile(vals, 0.95), 1),
        "ms_max": round(vals[-1], 1) if vals else 0.0,
        "slow_call_ms": SLOW_CALL_MS,
    }


async def aexecute(build: Callable[[Any], Any], *, sync_client: Any = None) -> Any:
    """Execute ``build(client).execute()`` via the flag-selected client."""
    if settings.USE_ASYNC_DB:
        client = await database.get_supabase_async()
        builder = build(client)
        method, table = _target(builder)
        try:
            return await _execute_timed(builder, method, table, 1)
        except httpx.TransportError as exc:
            if (method not in _RETRY_METHODS or _RPC_PATH in _path(builder)
                    or not isinstance(exc, _RETRY_ERRORS)):
                raise
            # The failed connection is discarded by the pool, so the retry
            # gets a fresh one; a second failure propagates to the caller's
            # existing error contract (gate 503, guard 503, ...).
            _counts["retries"] += 1
            logger.warning("[async-db] retry %s", {
                "request_id": current_request_id(), "method": method,
                "table": table, "error": type(exc).__name__,
            })
            return await _execute_timed(build(client), method, table, 2)
    # USE_ASYNC_DB off — today's exact behavior: direct sync execute on the
    # event-loop thread (blocking, but functionally identical). NOT threaded.
    client = database.supabase_admin if sync_client is None else sync_client
    return build(client).execute()
