"""services/quiz_bank_cache.py — process-local, versioned content cache for the
quiz player (PC-J434).

Every learner who opens the same bank used to re-read and re-parse the whole
question set (a 300-question course bank is ~250 KB of PostgREST JSON). That
content is identical for every learner; only the per-learner part (assignment,
mastery, timed session) must be read on each request.

WHY THIS IS NOT THE "LONG-TERM CACHE" `bank_has_writing` FORBIDS. The importers
run in another process and cannot invalidate anything here. So an entry is
only served when the caller has just read the bank's CURRENT version from the
database on this same request and it equals the version the entry was loaded
under. A re-import changes that version (see `quiz_service._content_version`).
Writers that the version cannot see (offline scripts that UPDATE a question
row in place) are bounded by `ttl_seconds`: past it the entry is reloaded even
when the version still matches.

Thread safety: after PC-J428 the bank route runs in `asyncio.to_thread`
workers, so many threads read/write this concurrently. `_lock` guards the
entry map; a per-key "flight" lock makes a cold or stale key load once while
the other threads for that key wait and then reuse the result. A failed load
caches nothing; each waiter then tries the load itself and raises its own
error.

Immutability: an entry stores compact JSON bytes, never the live objects.
Every `get` decodes a fresh object graph, so no caller can mutate (strip,
seal, attach URLs to) what the next request receives. Values must therefore be
JSON-native, which PostgREST rows are.

The entries hold answer keys. Nothing here logs or exposes a value; the INFO
line on load/reload carries only the key, reason, timing and size.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Hashable

logger = logging.getLogger(__name__)


class _Entry:
    __slots__ = ("version", "loaded_at", "blob", "extra")

    def __init__(self, version, loaded_at: float, blob: bytes, extra):
        self.version = version
        self.loaded_at = loaded_at
        self.blob = blob
        self.extra = extra


class VersionedContentCache:
    """`get(key, version, loader)` → `(fresh copy of value, extra)`.

    `loader()` returns `(value, extra)`: `value` is JSON-native and copied on
    every read; `extra` must be immutable (a bool, a tuple...) and is returned
    as is. `version=None` means the caller could not establish the current
    version: the loader runs and nothing is read from or written to the cache.
    """

    def __init__(self, name: str, *, ttl_seconds: float, max_entries: int,
                 clock: Callable[[], float] = time.monotonic):
        self.name = name
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._clock = clock
        self._lock = threading.Lock()
        self._entries: "OrderedDict[Hashable, _Entry]" = OrderedDict()
        # One lock per key ever loaded. Keys are bank/topic ids (a few hundred
        # at most), so the map is not evicted with the entries: a thread may
        # still be waiting on a lock whose entry was just evicted.
        self._flights: dict[Hashable, threading.Lock] = {}

    def _lookup(self, key, version) -> tuple[_Entry | None, str]:
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None, "cold"
            if entry.version != version:
                return None, "version"
            if self._clock() - entry.loaded_at >= self.ttl_seconds:
                return None, "ttl"
            self._entries.move_to_end(key)
            return entry, "hit"

    def get(self, key: Hashable, version, loader: Callable[[], tuple[Any, Any]]):
        if version is None:
            return loader()
        entry, _ = self._lookup(key, version)
        if entry is None:
            with self._lock:
                flight = self._flights.setdefault(key, threading.Lock())
            with flight:
                # Another thread may have loaded this version while we waited.
                entry, reason = self._lookup(key, version)
                if entry is None:
                    entry = self._load(key, version, loader, reason)
        return json.loads(entry.blob), entry.extra

    def _load(self, key, version, loader, reason: str) -> _Entry:
        started = time.perf_counter()
        value, extra = loader()
        blob = json.dumps(value, ensure_ascii=False,
                          separators=(",", ":")).encode("utf-8")
        entry = _Entry(version, self._clock(), blob, extra)
        with self._lock:
            self._entries[key] = entry
            self._entries.move_to_end(key)
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)
        logger.info("[quiz-bank-cache] %s load key=%s reason=%s ms=%.1f bytes=%d",
                    self.name, key, reason,
                    (time.perf_counter() - started) * 1000, len(blob))
        return entry

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
