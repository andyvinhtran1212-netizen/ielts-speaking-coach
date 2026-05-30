"""Helpers for conservative public-content HTTP caching.

Perf-3 keeps this opt-in: routes must call ``cacheable_json`` explicitly so
personalized endpoints never receive public cache headers by accident.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path
from typing import Any

from fastapi import Request, Response
from fastapi.responses import JSONResponse


CACHE_CONTROL = "public, max-age=60, s-maxage=60, stale-while-revalidate=300"


def content_last_modified(*roots: Path) -> str:
    """Return an HTTP-date timestamp for the newest file under ``roots``."""
    newest = 0.0
    for root in roots:
        if not root.exists():
            continue
        files = [root] if root.is_file() else list(root.rglob("*"))
        for path in files:
            if path.is_file():
                newest = max(newest, path.stat().st_mtime)
    if newest <= 0:
        newest = datetime.now(timezone.utc).timestamp()
    return format_datetime(datetime.fromtimestamp(newest, tz=timezone.utc), usegmt=True)


def _canonical_json_bytes(data: Any) -> bytes:
    return json.dumps(
        data,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")


def _etag(data: Any) -> str:
    digest = hashlib.sha256(_canonical_json_bytes(data)).hexdigest()[:24]
    return f'"{digest}"'


def _if_none_match_matches(request: Request, etag: str) -> bool:
    raw = request.headers.get("if-none-match")
    if not raw:
        return False
    candidates = {part.strip() for part in raw.split(",")}
    return "*" in candidates or etag in candidates


def cacheable_json(
    data: Any,
    request: Request,
    *,
    last_modified: str,
) -> Response:
    """Return a JSON response with public cache headers and ETag validation."""
    etag = _etag(data)
    headers = {
        "Cache-Control": CACHE_CONTROL,
        "ETag": etag,
        "Last-Modified": last_modified,
    }
    if _if_none_match_matches(request, etag):
        return Response(status_code=304, headers=headers)
    return JSONResponse(content=data, headers=headers)
