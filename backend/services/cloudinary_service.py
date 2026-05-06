"""services/cloudinary_service.py — Phase 2.3c-1 image upload helper.

Wraps the official `cloudinary` Python SDK so the rest of the app
talks to a small, well-documented surface (`upload_prompt_image` +
`delete_prompt_image`) instead of the SDK's many entry points.

Configuration is pulled from `config.settings` (pydantic_settings)
rather than `os.getenv` directly — that's the project-wide pattern
used by every other service (gemini, anthropic, supabase, …) and
keeps the Railway-vs-local-vs-test surface uniform.

Failure-mode contract:
  • Missing credentials → `CloudinaryConfigError` on the first call.
    The module imports without raising, so /health doesn't 500 on a
    fresh deploy that hasn't set the Railway env yet.
  • Oversize file → `ValueError` BEFORE the network call (saves
    Cloudinary bandwidth + gives the admin UI a clean 400).
  • Cloudinary API error → re-raised; the router maps it to 500.
  • Delete on missing public_id or with API error → returns False
    (best-effort, never raises) so DELETE flows can clean up
    optimistically.
"""

from __future__ import annotations

import logging
from typing import Optional

import cloudinary
import cloudinary.uploader

from config import settings

logger = logging.getLogger(__name__)


# All prompt images live under one folder so Cloudinary's Media
# Library + bulk-delete UI can find them at a glance.
PROMPT_IMAGES_FOLDER = "aver/writing/prompt_images"

# Formats accepted by Cloudinary's `allowed_formats`.  jpg/jpeg are
# both listed because the SDK matches the file extension verbatim.
ALLOWED_FORMATS: list[str] = ["jpg", "jpeg", "png", "webp", "gif"]

# Hard server-side cap on uploaded bytes. Andy's IELTS chart sources
# top out around 1.5MB; 5MB gives plenty of headroom for high-DPI
# scans without inviting users to PDF-print giant raw images.
MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

# Transformation pipeline applied at upload time. Cloudinary stores
# the transformed asset, so subsequent <img src=...> requests get
# the optimised file with no per-request transformation cost.
#   • quality:auto:good      → lossy compression with a quality floor
#   • fetch_format:auto      → webp for browsers that support it
#   • width:1200, crop:limit → cap the long edge; never upscales
_DEFAULT_TRANSFORMATION = [
    {"quality":      "auto:good"},
    {"fetch_format": "auto"},
    {"width": 1200, "crop": "limit"},
]


class CloudinaryConfigError(RuntimeError):
    """Raised on the first call when CLOUDINARY_* env vars are missing.
    Distinct from a Cloudinary API failure so the router can map
    config errors to a 503 rather than a generic 500."""


_configured = False


def _configure_once() -> None:
    """Lazy one-shot configuration — runs the first time anyone calls
    `upload_prompt_image` or `delete_prompt_image`. Lazy because we
    don't want module import to crash a fresh Railway deploy that
    hasn't set the env vars yet (the rest of the app must keep
    working; only image uploads should fail)."""
    global _configured
    if _configured:
        return

    cloud_name = settings.CLOUDINARY_CLOUD_NAME
    api_key    = settings.CLOUDINARY_API_KEY
    api_secret = settings.CLOUDINARY_API_SECRET
    if not (cloud_name and api_key and api_secret):
        missing = [
            name for name, val in [
                ("CLOUDINARY_CLOUD_NAME", cloud_name),
                ("CLOUDINARY_API_KEY",    api_key),
                ("CLOUDINARY_API_SECRET", api_secret),
            ] if not val
        ]
        raise CloudinaryConfigError(
            "Cloudinary credentials missing: " + ", ".join(missing)
            + ". Set them in the Railway service env."
        )

    cloudinary.config(
        cloud_name=cloud_name,
        api_key=api_key,
        api_secret=api_secret,
        secure=True,
    )
    _configured = True


def upload_prompt_image(
    file_bytes: bytes,
    *,
    filename_hint: Optional[str] = None,
) -> dict:
    """Upload raw image bytes to Cloudinary, return URL + public_id.

    Args:
        file_bytes:    raw image bytes
        filename_hint: original filename, currently unused by the SDK
                       but accepted so the caller can pass it without
                       branching (useful for future logging / audit)

    Returns:
        {
            "url":       <https Cloudinary secure_url>,
            "public_id": <Cloudinary public_id, store this for delete>,
            "width":     <int|None>,
            "height":    <int|None>,
        }

    Raises:
        ValueError              — file too large
        CloudinaryConfigError   — missing env credentials
        Exception               — Cloudinary API failure
    """
    if file_bytes is None or len(file_bytes) == 0:
        raise ValueError("Empty file.")
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        max_mb = MAX_FILE_SIZE_BYTES // 1024 // 1024
        raise ValueError(
            f"File too large ({len(file_bytes)} bytes). Max {max_mb}MB."
        )

    _configure_once()

    try:
        result = cloudinary.uploader.upload(
            file_bytes,
            folder=PROMPT_IMAGES_FOLDER,
            allowed_formats=ALLOWED_FORMATS,
            resource_type="image",
            transformation=_DEFAULT_TRANSFORMATION,
        )
    except Exception as exc:
        logger.error(
            "cloudinary upload failed (filename_hint=%s, size=%d bytes): %s",
            filename_hint, len(file_bytes), exc,
        )
        raise

    logger.info(
        "cloudinary upload ok: public_id=%s width=%s height=%s size=%d",
        result.get("public_id"), result.get("width"),
        result.get("height"), len(file_bytes),
    )
    return {
        "url":       result["secure_url"],
        "public_id": result["public_id"],
        "width":     result.get("width"),
        "height":    result.get("height"),
    }


def delete_prompt_image(public_id: Optional[str]) -> bool:
    """Best-effort delete by public_id.

    Returns True on Cloudinary `result == "ok"`; False otherwise
    (missing public_id, API error, or `not found` from Cloudinary).
    Never raises — callers that delete on prompt soft-delete /
    image replace shouldn't have their main flow blocked by an
    asset cleanup failure.
    """
    if not public_id:
        return False

    try:
        _configure_once()
    except CloudinaryConfigError as exc:
        logger.warning(
            "cloudinary delete skipped (no credentials): public_id=%s err=%s",
            public_id, exc,
        )
        return False

    try:
        result = cloudinary.uploader.destroy(public_id)
    except Exception as exc:
        logger.warning(
            "cloudinary delete API error: public_id=%s err=%s",
            public_id, exc,
        )
        return False

    ok = (result or {}).get("result") == "ok"
    logger.info(
        "cloudinary delete public_id=%s result=%s ok=%s",
        public_id, result, ok,
    )
    return ok
