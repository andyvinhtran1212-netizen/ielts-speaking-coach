"""Best-effort signed invalidation of Next's public-content cache."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time

import httpx

from config import settings

logger = logging.getLogger(__name__)

VOCABULARY_CACHE_TAG = "public:vocabulary"
_TIMEOUT_SECONDS = 3.0


def _signed_envelope(tags: list[str], timestamp: int | None = None) -> tuple[bytes, str]:
    body = json.dumps(
        {"tags": tags, "timestamp": timestamp if timestamp is not None else int(time.time())},
        separators=(",", ":"),
    ).encode("utf-8")
    signature = hmac.new(
        settings.AVER_CACHE_REVALIDATION_SECRET.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()
    return body, f"sha256={signature}"


def invalidate_public_cache(tags: list[str]) -> bool:
    """Notify Next after canonical data changed; never fail the admin write."""
    url = settings.NEXT_CACHE_REVALIDATION_URL.strip()
    secret = settings.AVER_CACHE_REVALIDATION_SECRET
    if not url or not secret:
        logger.debug("[next-cache] invalidation not configured")
        return False

    body, signature = _signed_envelope(tags)
    try:
        response = httpx.post(
            url,
            content=body,
            headers={
                "content-type": "application/json",
                "x-aver-signature": signature,
            },
            timeout=_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        logger.info("[next-cache] invalidated tags=%s", ",".join(tags))
        return True
    except Exception as exc:  # noqa: BLE001 — cache freshness must not undo DB writes
        status = getattr(getattr(exc, "response", None), "status_code", None)
        logger.warning("[next-cache] invalidation failed status=%s type=%s", status, type(exc).__name__)
        return False


def invalidate_vocabulary_cache() -> bool:
    return invalidate_public_cache([VOCABULARY_CACHE_TAG])

