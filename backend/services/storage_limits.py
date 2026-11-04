"""Storage upload contract (STORAGELIMITS-0038, migrations 343 and 362).

Policies describe the bytes written to Storage, after any format sniffing or
Speaking MIME normalisation. Do not use the client header to replace a sniff.
Migration 343 locks buckets by canonical id; a configured name maps to that id.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
import sys
from typing import Any

from fastapi import HTTPException

from config import settings


BUCKET_LIMITS: dict[str, tuple[int, tuple[str, ...]]] = {
    "audio-responses": (50 * 1024 * 1024, (
        "audio/*", "video/webm", "video/mp4", "application/octet-stream",
    )),
    "listening-audio": (50 * 1024 * 1024, (
        "audio/*", "image/png", "image/jpeg", "image/webp", "image/svg+xml", "application/json",
    )),
    "listening-images": (10 * 1024 * 1024, ("image/png", "image/jpeg", "image/webp")),
    "reading-images": (5 * 1024 * 1024, ("image/png", "image/jpeg", "image/webp")),
    "writing-images": (5 * 1024 * 1024, ("image/png", "image/jpeg", "image/webp")),
    "vocab-audio": (5 * 1024 * 1024, ("audio/mpeg",)),
}

_CONFIGURED_BUCKETS = (
    ("WRITING_IMAGES_BUCKET", "writing-images"), ("LISTENING_AUDIO_BUCKET", "listening-audio"),
    ("LISTENING_IMAGES_BUCKET", "listening-images"), ("READING_IMAGES_BUCKET", "reading-images"),
)


def _policy(bucket: str) -> tuple[str, int, tuple[str, ...]] | None:
    """Return (canonical id, max bytes, allowed types) for an id or configured name."""
    if bucket not in BUCKET_LIMITS:
        configured = {getattr(settings, name, None): bucket_id for name, bucket_id in _CONFIGURED_BUCKETS}
        # tts_audio passes its own constant; only read it once that module is
        # loaded, so an except path never triggers its database import.
        tts_audio = sys.modules.get("services.tts_audio")
        if tts_audio is not None:
            configured[getattr(tts_audio, "VOCAB_AUDIO_BUCKET", None)] = "vocab-audio"
        if bucket not in configured:
            return None
        bucket = configured[bucket]
    return (bucket, *BUCKET_LIMITS[bucket])


def _require_policy(bucket: str) -> tuple[str, int, tuple[str, ...]]:
    policy = _policy(bucket)
    if policy is None:
        raise ValueError(f"No storage upload policy for bucket {bucket!r}")
    return policy


class StorageUploadError(HTTPException):
    """HTTP refusal whose fields are also usable by importers and CLI jobs."""

    def __init__(self, bucket: str, status: int, detail: dict):
        super().__init__(status, detail)
        self.bucket = bucket
        self.error_code = detail["error_code"]
        self.max_bytes = detail["max_bytes"] if "max_bytes" in detail else _require_policy(bucket)[1]

    def __str__(self) -> str:
        return f"{self.bucket}: {self.status_code} {self.detail} (max_bytes={self.max_bytes})"


def _mime(content_type: str | None) -> str:
    return (content_type or "").split(";", 1)[0].strip().lower()


def _allowed(bucket: str, content_type: str | None) -> bool:
    mime = _mime(content_type)
    if "*" in mime:  # a client wildcard is a pattern, not the type of the bytes
        return False
    return any(mime == allowed or (
        allowed.endswith("/*") and mime.startswith(allowed[:-1])
        and bool(mime[len(allowed) - 1:])
    ) for allowed in _require_policy(bucket)[2])


def upload_error(
    bucket: str, status: int, *, size: int | None = None, max_bytes: int | None = None,
    message: str | None = None, allowed: Sequence[str] | None = None,
) -> HTTPException:
    """Build the same public error for preflight and Storage-side refusals.

    ``allowed`` narrows the 415 list for a route that accepts less than its bucket.
    """
    bucket_id, limit, bucket_allowed = _require_policy(bucket)
    limit = limit if max_bytes is None else max_bytes
    allowed = bucket_allowed if allowed is None else allowed
    if status == 413:
        default_message = f"File quá lớn (tối đa {limit // (1024 * 1024)} MB)."
        if bucket_id == "audio-responses" and size is not None:
            default_message = f"File quá lớn ({size / (1024*1024):.1f} MB). Giới hạn là 50 MB."
        return StorageUploadError(bucket, 413, {
            "error_code": "file_too_large", "max_bytes": limit, "message": message or default_message,
        })
    if status != 415:
        raise ValueError("Upload refusal must be 413 or 415")
    default_message = "Định dạng file không được hỗ trợ."
    if bucket_id.endswith("-images"):
        default_message = "Chỉ nhận ảnh PNG, JPG hoặc WebP."
    elif bucket_id == "audio-responses":
        default_message = "Định dạng ghi âm không được hỗ trợ."
    return StorageUploadError(bucket, 415, {
        "error_code": "unsupported_media_type", "allowed": list(allowed), "message": message or default_message,
    })


def check_upload(bucket: str, size: int, content_type: str | None) -> None:
    """Reject before Storage is called; an object exactly at the cap is valid."""
    if size > _require_policy(bucket)[1]:
        raise upload_error(bucket, 413, size=size)
    if not _allowed(bucket, content_type):
        raise upload_error(bucket, 415)


def _refuse_over_cap(data: bytes, max_bytes: int, too_large: Callable[[int], HTTPException]) -> bytes:
    if len(data) > max_bytes:
        raise too_large(len(data))
    return data


def read_upload_capped(upload: Any, max_bytes: int, too_large: Callable[[int], HTTPException]) -> bytes:
    """Read an UploadFile without holding more than ``max_bytes + 1`` bytes.

    Starlette's spooled ``size`` refuses before any read; the bounded read still
    applies when it is absent. ``too_large`` receives the observed size.
    """
    size = getattr(upload, "size", None)
    if isinstance(size, int) and size > max_bytes:
        raise too_large(size)
    return _refuse_over_cap(upload.file.read(max_bytes + 1), max_bytes, too_large)


async def aread_upload_capped(upload: Any, max_bytes: int, too_large: Callable[[int], HTTPException]) -> bytes:
    """Async form of read_upload_capped using ``await UploadFile.read``."""
    size = getattr(upload, "size", None)
    if isinstance(size, int) and size > max_bytes:
        raise too_large(size)
    return _refuse_over_cap(await upload.read(max_bytes + 1), max_bytes, too_large)


def normalise_audio_content_type(content_type: str | None, extension: str) -> str:
    """Keep all existing Speaking inputs, using the route's _guess_ext result.

    Strip parameters before Storage, whose MIME matcher need not understand
    recorder suffixes such as ``;codecs=opus``.
    """
    if _allowed("audio-responses", content_type):
        return _mime(content_type)
    return {
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".webm": "audio/webm",
        ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".flac": "audio/flac",
    }.get(extension, "audio/webm")


def map_storage_error(bucket: str, exc: Exception) -> HTTPException | None:
    """Recognise SDK/HTTP size and MIME refusals; leave unrelated errors alone.

    storage3.StorageApiError exposes status/code/message; HTTP clients expose
    response.status_code. Some older SDKs only include the error in str(exc).
    """
    if isinstance(exc, StorageUploadError):
        return exc
    if _policy(bucket) is None:  # unknown bucket: let the original error surface
        return None
    payload = exc.args[0] if exc.args and isinstance(exc.args[0], dict) else {}
    statuses = (
        payload.get("statusCode"), payload.get("status"),
        getattr(exc, "status", None), getattr(exc, "status_code", None),
        getattr(getattr(exc, "response", None), "status_code", None),
    )
    code = str(getattr(exc, "code", None) or payload.get("code") or payload.get("error", "")).lower()
    message = f"{getattr(exc, 'message', '')} {exc}".lower()
    if "413" in {str(status) for status in statuses} or code in {
        "entitytoolarge", "payloadtoolarge", "filetoolarge",
    } or any(term in message for term in (
        "payload too large", "entity too large", "maximum allowed size",
        "file size limit", "exceeded the maximum", "file too large",
    )):
        return upload_error(bucket, 413)
    if "415" in {str(status) for status in statuses} or code in {
        "invalidmimetype", "unsupportedmediatype",
    } or (("mime" in message or "media type" in message or "content-type" in message)
          and any(term in message for term in ("not supported", "unsupported", "not allowed", "invalid"))):
        return upload_error(bucket, 415)
    return None


def raise_storage_error(bucket: str, exc: Exception) -> None:
    """Call first in an upload exception handler, before its generic fallback."""
    mapped = map_storage_error(bucket, exc)
    if mapped is not None:
        raise mapped from exc


def upload_with_error_mapping(bucket: str, upload: Callable, *args: Any, **kwargs: Any) -> Any:
    """CLI compatibility: map Storage refusals without adding preflight limits."""
    try:
        return upload(*args, **kwargs)
    except Exception as exc:
        raise_storage_error(bucket, exc)
        raise
