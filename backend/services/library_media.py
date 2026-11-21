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
"""

from __future__ import annotations

import logging
import re
from pathlib import PurePosixPath
from typing import Optional

from fastapi import Response
from fastapi.responses import JSONResponse

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
