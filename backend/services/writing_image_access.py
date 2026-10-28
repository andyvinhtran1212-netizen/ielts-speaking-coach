"""Private Task 1 writing prompt images (bucket ``writing-images``).

Persist object paths, never expiring or public URLs. Rows written before the
bucket went private still hold a public URL on our Storage origin; that URL is
used solely to recover the object path and is never returned or fetched.
URLs on any other host (legacy project, external) are not in this bucket and
pass through unchanged.

Sign only after the caller has authorized the reader (owning learner,
instructor, admin, or an authenticated prompt-bank viewer). A signing failure
yields ``None`` plus ``prompt_image_lookup_failed`` — never the stored URL.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Iterable, Optional
from urllib.parse import unquote, urlsplit

from config import settings

VIEW_TTL = 3600   # rendered as <img src>; long enough for a timed Task 1 sitting
FETCH_TTL = 300   # server-side fetch by the grader / analysis, used immediately
logger = logging.getLogger(__name__)

# Reuse a signed URL until half its TTL has elapsed so polling surfaces (the
# mock-exam runner refreshes every 8 s) keep a stable <img src> instead of
# re-downloading the chart on every poll. Per process; bounded.
_CACHE_MAX = 2048
_cache: dict[tuple[str, int], tuple[str, float]] = {}
_cache_lock = threading.Lock()


def _bucket() -> str:
    return settings.WRITING_IMAGES_BUCKET


def _safe_path(value: object) -> Optional[str]:
    if not isinstance(value, str) or not value or len(value) > 1024:
        return None
    # Bucket-relative keys only; reject URL syntax, encoded separators and dot
    # segments rather than letting a second decoder reinterpret them.
    if any(ord(c) < 32 or ord(c) == 127 or c in "\\%?#:" for c in value):
        return None
    if any(part in {"", ".", ".."} for part in value.split("/")):
        return None
    return value


def image_path(ref: object) -> Optional[str]:
    """Object path for a stored ref in our bucket, or None (empty/foreign)."""
    if not isinstance(ref, str) or not ref:
        return None
    if "://" not in ref:
        return _safe_path(ref)
    if any(ord(c) < 32 for c in ref):
        return None
    try:
        url = urlsplit(ref)
        origin = urlsplit(str(settings.SUPABASE_URL))
        if (url.scheme != "https" or url.netloc != origin.netloc
                or url.username or url.password or url.fragment):
            return None
        for access in ("public", "sign", "authenticated"):
            prefix = f"/storage/v1/object/{access}/{_bucket()}/"
            if url.path.startswith(prefix):
                return _safe_path(unquote(url.path[len(prefix):]))
    except ValueError:
        pass
    return None


def _external_url(ref: object) -> Optional[str]:
    """A non-bucket http(s) URL that is safe to pass through unchanged."""
    if not isinstance(ref, str) or any(ord(c) < 32 for c in ref):
        return None
    try:
        url = urlsplit(ref)
        origin = urlsplit(str(settings.SUPABASE_URL))
    except ValueError:
        return None
    if url.scheme not in ("http", "https") or not url.netloc:
        return None
    if url.netloc == origin.netloc and url.path.startswith("/storage/v1/object/"):
        return None  # our Storage origin but not a resolvable object → never echo
    return ref


def canonical_image_ref(ref: object) -> Optional[str]:
    """What to persist: the object path for our bucket, else the input URL.

    Accepts the upload response URL, a signed URL echoed back by an editor, a
    legacy public URL or a bare path. Empty input → None.
    """
    if not isinstance(ref, str) or not ref.strip():
        return None
    ref = ref.strip()
    return image_path(ref) or ref


def sign_image_paths(paths: Iterable[str], ttl: int = VIEW_TTL) -> dict[str, str]:
    """Batch-sign object paths; returns only the paths that signed."""
    from database import supabase_admin

    signed: dict[str, str] = {}
    now = time.monotonic()
    pending = []
    with _cache_lock:
        for path in dict.fromkeys(p for p in paths if p):
            hit = _cache.get((path, ttl))
            if hit and hit[1] - now > ttl / 2:
                signed[path] = hit[0]
            else:
                pending.append(path)
    if not pending:
        return signed
    fresh = _sign_uncached(supabase_admin.storage.from_(_bucket()), pending, ttl)
    with _cache_lock:
        if len(_cache) + len(fresh) > _CACHE_MAX:
            _cache.clear()
        for path, url in fresh.items():
            _cache[(path, ttl)] = (url, now + ttl)
    signed.update(fresh)
    return signed


def _sign_uncached(bucket, unique: list[str], ttl: int) -> dict[str, str]:
    signed: dict[str, str] = {}
    for offset in range(0, len(unique), 100):
        batch = unique[offset:offset + 100]
        try:
            for item in bucket.create_signed_urls(batch, ttl):
                path = item.get("path")
                url = item.get("signedUrl") or item.get("signedURL")
                if path in batch and isinstance(url, str) and url and not item.get("error"):
                    signed[path] = url
        except (TypeError, ValueError) as exc:
            # storage3 cannot deserialize a batch containing one missing object;
            # recover the good objects individually, bounded to this batch.
            logger.warning("[writing-image] Batch decoding failed (%s, %d paths)",
                           type(exc).__name__, len(batch))
            for path in batch:
                try:
                    item = bucket.create_signed_url(path, ttl)
                    url = (item or {}).get("signedUrl") or (item or {}).get("signedURL")
                    if isinstance(url, str) and url:
                        signed[path] = url
                except Exception as item_exc:
                    logger.warning("[writing-image] Individual signing unavailable (%s)",
                                   type(item_exc).__name__)
        except Exception as exc:
            # Storage errors can include object names or tokens; log the type.
            logger.warning("[writing-image] Signing unavailable (%s, %d paths)",
                           type(exc).__name__, len(batch))
    return signed


def attach_signed_image_urls(
    rows: Iterable[Optional[dict]],
    fields: tuple[str, ...] = ("prompt_image_url",),
    ttl: int = VIEW_TTL,
) -> bool:
    """Replace each stored ref in ``rows[field]`` with a viewable URL, in place.

    Bucket refs become short-lived signed URLs; foreign URLs pass through; an
    unresolvable or unsigned ref becomes None and the row gets
    ``prompt_image_lookup_failed: True``. Returns False when any ref failed.
    """
    rows = [r for r in rows if isinstance(r, dict)]
    paths = [image_path(r.get(f)) for r in rows for f in fields]
    signed = sign_image_paths([p for p in paths if p], ttl) if any(paths) else {}
    complete = True
    for row in rows:
        failed = False
        for field in fields:
            ref = row.get(field)
            if not ref:
                continue
            path = image_path(ref)
            url = signed.get(path) if path else _external_url(ref)
            row[field] = url
            failed = failed or not url
        if failed:
            row["prompt_image_lookup_failed"] = True
            complete = False
    return complete


def fetchable_image_url(ref: object) -> Optional[str]:
    """URL a server-side fetcher (grader, chart analysis) may GET right now."""
    path = image_path(ref)
    if path:
        return sign_image_paths([path], FETCH_TTL).get(path)
    return _external_url(ref)
