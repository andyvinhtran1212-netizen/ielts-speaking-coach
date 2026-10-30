"""Storage upload contract (STORAGELIMITS-0038, migration 343).

Policies describe the bytes written to Storage, after any format sniffing or
Speaking MIME normalisation. Do not use the client header to replace a sniff.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import HTTPException


BUCKET_LIMITS: dict[str, tuple[int, tuple[str, ...]]] = {
    "audio-responses": (50 * 1024 * 1024, (
        "audio/*", "video/webm", "video/mp4", "application/octet-stream",
    )),
    "listening-audio": (128 * 1024 * 1024, (
        "audio/*", "image/png", "image/jpeg", "image/webp", "image/svg+xml", "application/json",
    )),
    "listening-images": (10 * 1024 * 1024, ("image/png", "image/jpeg", "image/webp")),
    "reading-images": (5 * 1024 * 1024, ("image/png", "image/jpeg", "image/webp")),
    "writing-images": (5 * 1024 * 1024, ("image/png", "image/jpeg", "image/webp")),
    "vocab-audio": (5 * 1024 * 1024, ("audio/mpeg",)),
}


class StorageUploadError(HTTPException):
    """HTTP refusal whose fields are also usable by importers and CLI jobs."""

    def __init__(self, bucket: str, status: int, detail: dict):
        super().__init__(status, detail)
        self.bucket = bucket
        self.error_code = detail["error_code"]
        self.max_bytes = detail.get("max_bytes", BUCKET_LIMITS[bucket][0])

    def __str__(self) -> str:
        return f"{self.bucket}: {self.status_code} {self.detail} (max_bytes={self.max_bytes})"


def _mime(content_type: str | None) -> str:
    return (content_type or "").split(";", 1)[0].strip().lower()


def _allowed(bucket: str, content_type: str | None) -> bool:
    mime = _mime(content_type)
    return any(mime == allowed or (
        allowed.endswith("/*") and mime.startswith(allowed[:-1])
        and bool(mime[len(allowed) - 1:])
    ) for allowed in BUCKET_LIMITS[bucket][1])


def upload_error(
    bucket: str, status: int, *, size: int | None = None, max_bytes: int | None = None,
    message: str | None = None,
) -> HTTPException:
    """Build the same public error for preflight and Storage-side refusals."""
    limit, allowed = BUCKET_LIMITS[bucket]
    limit = limit if max_bytes is None else max_bytes
    if status == 413:
        default_message = f"File quá lớn (tối đa {limit // (1024 * 1024)} MB)."
        if bucket == "audio-responses" and size is not None:
            default_message = f"File quá lớn ({size / (1024*1024):.1f} MB). Giới hạn là 50 MB."
        return StorageUploadError(bucket, 413, {
            "error_code": "file_too_large", "max_bytes": limit, "message": message or default_message,
        })
    if status != 415:
        raise ValueError("Upload refusal must be 413 or 415")
    default_message = "Định dạng file không được hỗ trợ."
    if bucket.endswith("-images"):
        default_message = "Chỉ nhận ảnh PNG, JPG hoặc WebP."
    elif bucket == "audio-responses":
        default_message = "Định dạng ghi âm không được hỗ trợ."
    return StorageUploadError(bucket, 415, {
        "error_code": "unsupported_media_type", "allowed": list(allowed), "message": message or default_message,
    })


def check_upload(bucket: str, size: int, content_type: str | None) -> None:
    """Reject before Storage is called; an object exactly at the cap is valid."""
    if size > BUCKET_LIMITS[bucket][0]:
        raise upload_error(bucket, 413, size=size)
    if not _allowed(bucket, content_type):
        raise upload_error(bucket, 415)


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
