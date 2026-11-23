"""Public Library media served by the backend (LIBRARY-0061 FR-064).

Task 1 figures and Speaking sample audio live in the PRIVATE ``library-media``
bucket (migration 400). No Storage URL — public or signed — ever reaches a
client: a signed URL cannot be revoked on time because Supabase Smart CDN may
keep serving a cached copy after the token expires. Instead the backend checks
``published`` on every request and returns the bytes itself with
``Cache-Control: no-store``, so an unpublished file is refused (404) on the very
next request to the same URL.

Callers resolve the row and its object path; this module only maps the
(shelf, asset) allow-list, downloads the object and builds the response,
including a single ``Range`` for audio seeking.

Abuse bounds (weekly SA 2026-11-23, S-1). The route is public, so two
in-process guards keep a flood from turning into Storage egress, RAM and cost:

* ``throttle()``: a per-IP sliding window (``IP_MAX_PER_MINUTE``) checked
  before the database lookup, keyed like RequestSafetyMiddleware and the TTS
  throttle. State is per worker, so N workers allow N x the budget; it only
  blunts bursts from one address.
* ``cached_download()``: a small TTL/LRU byte cache keyed by object path, so a
  burst of ``Range`` requests while an audio player seeks downloads the object
  once instead of once per request. It is only consulted AFTER the caller has
  confirmed ``published`` on this request, so unpublishing still answers 404
  on the very next request (FR-064). Responses stay ``no-store``.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from collections import OrderedDict, deque
from pathlib import PurePosixPath
from typing import Optional

from fastapi import Response
from fastapi.responses import JSONResponse

from services.request_safety import request_client_ip

logger = logging.getLogger(__name__)

BUCKET = "library-media"
NO_STORE = "no-store"

# (URL shelf, URL asset) -> (table, path column). Anything else is a 404.
MEDIA_ASSETS: dict[tuple[str, str], tuple[str, str]] = {
    ("writing-sample", "figure"): ("writing_samples", "prompt_image_path"),
    ("speaking-sample", "audio"): ("speaking_samples", "audio_path"),
}

_CONTENT_TYPES = {
    ".png": "image/png",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
}

_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


def media_path(shelf: str, key: str, asset: str) -> str:
    """Public URL path of one media asset (what pages and the API emit)."""
    return f"/api/library/media/{shelf}/{key}/{asset}"


def not_found() -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"detail": "media_not_found"},
        headers={"Cache-Control": NO_STORE},
    )


def content_type_for(object_path: str) -> Optional[str]:
    return _CONTENT_TYPES.get(PurePosixPath(object_path).suffix.lower())


# ── per-IP throttle ─────────────────────────────────────────────────────────
# One page view asks for at most one figure, or one audio file plus a handful
# of Range requests while seeking; 120 a minute leaves room for a class behind
# one NAT address while capping a single flooding client.
IP_MAX_PER_MINUTE = 120
_IP_WINDOW_SECONDS = 60.0
_MAX_TRACKED_CLIENTS = 10_000
_OVERFLOW_KEY = "\0overflow"
_ip_hits: dict[str, deque] = {}
_ip_lock = threading.Lock()


def throttle(request) -> Optional[JSONResponse]:
    """A 429 response when this client spent its per-minute budget, else None
    (and the request is counted)."""
    key = request_client_ip(request)
    if not key:
        return None
    now = time.monotonic()
    cutoff = now - _IP_WINDOW_SECONDS
    with _ip_lock:
        if key not in _ip_hits and len(_ip_hits) >= _MAX_TRACKED_CLIENTS:
            for stale in [k for k, q in _ip_hits.items() if not q or q[-1] <= cutoff]:
                del _ip_hits[stale]
            if len(_ip_hits) >= _MAX_TRACKED_CLIENTS:
                # Spread across too many addresses: share one bucket rather
                # than grow without bound (same posture as RequestSafety).
                key = _OVERFLOW_KEY
        hits = _ip_hits.setdefault(key, deque())
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= IP_MAX_PER_MINUTE:
            retry_after = max(1, int(hits[0] - cutoff) + 1)
            blocked = True
        else:
            hits.append(now)
            blocked = False
    if not blocked:
        return None
    logger.info("[library_media] BLOCK ip budget=%d/min", IP_MAX_PER_MINUTE)
    return JSONResponse(
        status_code=429,
        content={"detail": "media_rate_limited", "retry_after": retry_after},
        headers={"Cache-Control": NO_STORE, "Retry-After": str(retry_after)},
    )


# ── short byte cache ────────────────────────────────────────────────────────
# Objects are at most 10 MiB (bucket limit), so 48 MiB holds a few hot files
# per worker. A replaced object at the same path is served stale for at most
# CACHE_TTL_SECONDS; publish state is never cached.
CACHE_TTL_SECONDS = 60.0
CACHE_MAX_BYTES = 48 * 1024 * 1024
_cache: "OrderedDict[str, tuple[float, bytes]]" = OrderedDict()
_cache_bytes = 0
_cache_lock = threading.Lock()
# Single-flight: one Storage download per object path at a time, so N
# concurrent misses (a player's parallel Range requests) cost one download.
_inflight: dict[str, threading.Lock] = {}


def _cache_get(object_path: str) -> Optional[bytes]:
    global _cache_bytes
    now = time.monotonic()
    with _cache_lock:
        entry = _cache.get(object_path)
        if entry is None:
            return None
        stored_at, data = entry
        if now - stored_at >= CACHE_TTL_SECONDS:
            del _cache[object_path]
            _cache_bytes -= len(data)
            return None
        _cache.move_to_end(object_path)
        return data


def _cache_put(object_path: str, data: bytes) -> None:
    global _cache_bytes
    if len(data) > CACHE_MAX_BYTES:
        return
    with _cache_lock:
        old = _cache.pop(object_path, None)
        if old is not None:
            _cache_bytes -= len(old[1])
        _cache[object_path] = (time.monotonic(), data)
        _cache_bytes += len(data)
        while _cache_bytes > CACHE_MAX_BYTES:
            _, (_, evicted) = _cache.popitem(last=False)
            _cache_bytes -= len(evicted)


def reset_state() -> None:
    """Clear the throttle and the byte cache (tests)."""
    global _cache_bytes
    with _ip_lock:
        _ip_hits.clear()
    with _cache_lock:
        _cache.clear()
        _inflight.clear()
        _cache_bytes = 0


def cached_download(db, object_path: str) -> Optional[bytes]:
    """``download()`` behind the short byte cache. Call only after this
    request confirmed the item is published. Failures are not cached.

    Concurrent misses for one path wait on a per-path lock and re-check the
    cache, so only the first downloads."""
    data = _cache_get(object_path)
    if data is not None:
        return data
    with _cache_lock:
        flight = _inflight.setdefault(object_path, threading.Lock())
    with flight:
        data = _cache_get(object_path)
        if data is not None:
            return data
        try:
            data = download(db, object_path)
            if data is not None:
                _cache_put(object_path, data)
        finally:
            with _cache_lock:
                if _inflight.get(object_path) is flight:
                    del _inflight[object_path]
    return data


def download(db, object_path: str) -> Optional[bytes]:
    """Object bytes, or None when Storage cannot return them (logged)."""
    try:
        data = db.storage.from_(BUCKET).download(object_path)
    except Exception as exc:  # noqa: BLE001 - Storage client raises many types
        logger.warning("[library_media] download failed path=%s err=%s", object_path, type(exc).__name__)
        return None
    if not isinstance(data, (bytes, bytearray)):
        return None
    return bytes(data)


def _parse_range(header: Optional[str], size: int) -> Optional[tuple[int, int]] | str:
    """(start, end) inclusive for one satisfiable range, None for no/ignored
    header, or "unsatisfiable"."""
    if not header:
        return None
    m = _RANGE_RE.match(header.strip())
    if not m:
        return None  # multi-range or malformed: serve the whole file (RFC 9110 allows)
    first, last = m.groups()
    if first == "" and last == "":
        return None
    if first == "":
        length = int(last)
        if length == 0:
            return "unsatisfiable"
        start = max(size - length, 0)
        end = size - 1
    else:
        start = int(first)
        end = int(last) if last else size - 1
        end = min(end, size - 1)
        if start >= size or start > end:
            return "unsatisfiable"
    return start, end


def build_response(data: bytes, content_type: str, range_header: Optional[str]) -> Response:
    size = len(data)
    headers = {
        "Cache-Control": NO_STORE,
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
    }
    parsed = _parse_range(range_header, size)
    if parsed == "unsatisfiable":
        headers["Content-Range"] = f"bytes */{size}"
        return Response(status_code=416, headers=headers)
    if parsed is None:
        return Response(content=data, media_type=content_type, headers=headers)
    start, end = parsed
    headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return Response(content=data[start:end + 1], status_code=206, media_type=content_type, headers=headers)
