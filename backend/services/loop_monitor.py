"""Event-loop lag monitor — P0-1 (C-1.1) observability.

There is no APM yet. This task is the direct signal for the async-DB work: it
sleeps a fixed interval and measures how much LATER than the interval it
actually woke. That extra delay is time the event loop spent blocked by
synchronous work — e.g. a blocking ``supabase_admin.execute()`` running on the
loop thread inside an ``async def`` route. Sync DB → lag spikes under
concurrency; async DB should flatten it.

Exposed via ``GET /health/async-db`` and a periodic structured log so a
baseline can be read off prod (flag OFF) before deciding whether migrating all
~696 call-sites is worth it.
"""

from __future__ import annotations

import asyncio
import logging
from collections import deque

logger = logging.getLogger("loop_monitor")

_INTERVAL_S = 0.5            # sampling cadence
_WINDOW = 240               # rolling window (~2 min at 0.5s)
_LOG_EVERY = 120            # emit a structured log every N samples (~60s)

_samples_ms: "deque[float]" = deque(maxlen=_WINDOW)
_task: "asyncio.Task | None" = None


async def _run() -> None:
    loop = asyncio.get_running_loop()
    n = 0
    while True:
        t0 = loop.time()
        await asyncio.sleep(_INTERVAL_S)
        # Drift = actual elapsed minus intended sleep. Clamp at 0 (scheduling
        # can only be late, not early); small residual is normal scheduler jitter.
        drift_ms = max((loop.time() - t0 - _INTERVAL_S) * 1000.0, 0.0)
        _samples_ms.append(drift_ms)
        n += 1
        if n % _LOG_EVERY == 0:
            logger.info("[loop-lag] %s", snapshot())


def start() -> None:
    """Start the monitor task once (idempotent). Call from the startup hook."""
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_run())


def _percentile(sorted_vals: "list[float]", p: float) -> float:
    if not sorted_vals:
        return 0.0
    k = (len(sorted_vals) - 1) * p
    lo = int(k)
    hi = min(lo + 1, len(sorted_vals) - 1)
    if lo == hi:
        return sorted_vals[lo]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def snapshot() -> dict:
    """Current rolling event-loop-lag stats (all milliseconds)."""
    vals = sorted(_samples_ms)
    return {
        "samples": len(vals),
        "interval_s": _INTERVAL_S,
        "lag_ms_last": round(_samples_ms[-1], 2) if _samples_ms else 0.0,
        "lag_ms_max": round(vals[-1], 2) if vals else 0.0,
        "lag_ms_p50": round(_percentile(vals, 0.50), 2),
        "lag_ms_p95": round(_percentile(vals, 0.95), 2),
        "running": _task is not None and not _task.done(),
    }
