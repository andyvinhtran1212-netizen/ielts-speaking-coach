"""Server-Timing instrumentation for request-stage observability.

The middleware in ``main.py`` owns the per-request context. This module keeps
the rest of the app lightweight: auth can record its HTTP verification time,
and PostgREST ``execute()`` calls are wrapped once at startup to accumulate DB
time without changing every router by hand.
"""

from __future__ import annotations

from contextvars import ContextVar
from time import perf_counter
from typing import Any, Callable


_timings: ContextVar[dict[str, float] | None] = ContextVar("server_timing", default=None)


def start_request() -> object:
    """Start a timing bucket for the current request and return the reset token."""
    return _timings.set({"auth": 0.0, "db": 0.0, "external": 0.0})


def reset_request(token: object) -> None:
    _timings.reset(token)


def record_stage(stage: str, duration_ms: float) -> None:
    bucket = _timings.get()
    if bucket is None:
        return
    bucket[stage] = bucket.get(stage, 0.0) + max(duration_ms, 0.0)


def snapshot() -> dict[str, float]:
    bucket = _timings.get()
    return dict(bucket or {})


def format_header(total_ms: float) -> str:
    stages = snapshot()
    auth_ms = stages.get("auth", 0.0)
    db_ms = stages.get("db", 0.0)
    external_ms = stages.get("external", 0.0)
    app_ms = max(total_ms - auth_ms - db_ms - external_ms, 0.0)
    parts = [
        ("total", total_ms),
        ("auth", auth_ms),
        ("db", db_ms),
        ("app", app_ms),
    ]
    if external_ms > 0:
        parts.append(("external", external_ms))
    return ", ".join(f"{name};dur={duration:.2f}" for name, duration in parts)


def _wrap_execute(cls: type[Any]) -> None:
    original: Callable[..., Any] | None = getattr(cls, "execute", None)
    if original is None or getattr(original, "_av_server_timing_wrapped", False):
        return

    def wrapped(self: Any, *args: Any, **kwargs: Any) -> Any:
        start = perf_counter()
        try:
            return original(self, *args, **kwargs)
        finally:
            record_stage("db", (perf_counter() - start) * 1000)

    wrapped._av_server_timing_wrapped = True  # type: ignore[attr-defined]
    setattr(cls, "execute", wrapped)


def install_supabase_timing() -> None:
    """Patch postgrest sync builders once so Supabase ``execute`` time is counted.

    The app uses the synchronous Supabase/PostgREST client throughout. Patching
    builder classes is less invasive than wrapping every ``supabase_admin`` call
    site and automatically covers routers/services added later.
    """
    try:
        import postgrest._sync.request_builder as rb
    except Exception:
        return

    for name in (
        "SyncExplainRequestBuilder",
        "SyncFilterRequestBuilder",
        "SyncMaybeSingleRequestBuilder",
        "SyncQueryRequestBuilder",
        "SyncRPCFilterRequestBuilder",
        "SyncSelectRequestBuilder",
        "SyncSingleRequestBuilder",
    ):
        cls = getattr(rb, name, None)
        if isinstance(cls, type):
            _wrap_execute(cls)


def _wrap_async_execute(cls: type[Any]) -> None:
    original: Callable[..., Any] | None = getattr(cls, "execute", None)
    if original is None or getattr(original, "_av_server_timing_wrapped", False):
        return

    async def wrapped(self: Any, *args: Any, **kwargs: Any) -> Any:
        start = perf_counter()
        try:
            return await original(self, *args, **kwargs)
        finally:
            record_stage("db", (perf_counter() - start) * 1000)

    wrapped._av_server_timing_wrapped = True  # type: ignore[attr-defined]
    setattr(cls, "execute", wrapped)


def install_supabase_async_timing() -> None:
    """Patch postgrest ASYNC builders so the async client's ``execute`` time is
    also counted toward Server-Timing ``db`` — the async parallel of
    ``install_supabase_timing``. Called from startup ONLY when USE_ASYNC_DB is
    on, so it never touches the default sync path.
    """
    try:
        import postgrest._async.request_builder as rb
    except Exception:
        return

    for name in (
        "AsyncExplainRequestBuilder",
        "AsyncFilterRequestBuilder",
        "AsyncMaybeSingleRequestBuilder",
        "AsyncQueryRequestBuilder",
        "AsyncRPCFilterRequestBuilder",
        "AsyncSelectRequestBuilder",
        "AsyncSingleRequestBuilder",
    ):
        cls = getattr(rb, name, None)
        if isinstance(cls, type):
            _wrap_async_execute(cls)
