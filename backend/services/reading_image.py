"""services/reading_image.py — Sprint 20.14f-α.

Manual image upload for IELTS Reading diagram / flow-chart questions
(`diagram_label_completion`, `flow_chart_completion`). Standards §2A.13
accepts both ASCII art and a real image — this service is the image
path. AI generation is Sprint 20.14f-β (deferred per Andy's confirmed
split).

Mirrors the listening map-image upload pattern (Sprint 13.5.9.3,
`backend/routers/listening.py::admin_upload_map_image`):

  • Magic-byte format sniff (PNG / JPG / WebP only). No Pillow / Magic
    dependency in the project — byte signatures are cheap + reliable.
  • Size floor 100 B (rejects empty / corrupted), ceiling 5 MB
    (matches the listening hard cap; reading diagrams are typically
    <500 KB so 5 MB is generous).
  • Storage: private Supabase bucket `reading-images`
    (config.READING_IMAGES_BUCKET) under
    `tests/<test_uuid>/diagrams/<question_id>-manual-<timestamp>.<ext>`.
  • Returns the metadata bundle the admin endpoint merges into the
    question's `payload.template`. Renderer reads
    `payload.image_url` (signed URL) emitted by the student fetch;
    `template.image_storage_path` is the on-row source of truth.

The student fetch (`routers/reading_student.py::_fetch_test`) mints a
2-hour signed URL per request — the signed URL is NEVER persisted.

Public API:
    SUPPORTED_FORMATS                              # ("png", "jpg", "webp")
    MIN_BYTES                                      # 100
    MAX_BYTES                                      # 5_242_880
    InvalidImageError                              # raised on size / format / variant
    detect_format(bytes) -> Optional[str]
    upload_diagram_image(...)                      -> dict  (payload metadata bundle)
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional


logger = logging.getLogger(__name__)


# ── Format sniff (magic-byte) ────────────────────────────────────────


# Source: PNG RFC 2083 §3.1; JPEG SOI marker; RIFF/WEBP container.
# Length-12 prefix is enough to disambiguate vs GIF/BMP/SVG/PDF, which
# all fail this check + get rejected as unsupported.
_IMAGE_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff",      "jpg"),
)

SUPPORTED_FORMATS: tuple[str, ...] = ("png", "jpg", "webp")
MIN_BYTES: int = 100
MAX_BYTES: int = 5 * 1024 * 1024


def detect_format(data: bytes) -> Optional[str]:
    """Return ``"png"`` / ``"jpg"`` / ``"webp"`` based on the magic-byte
    prefix, or ``None`` for any other format. Mirrors the listening
    sniff (`backend/routers/listening.py::_detect_image_format`) so the
    two upload paths share their accept-set.
    """
    if not data or len(data) < 12:
        return None
    for sig, fmt in _IMAGE_SIGNATURES:
        if data.startswith(sig):
            return fmt
    # WebP: RIFF + 4 length bytes + "WEBP". Match the RIFF marker + the
    # WEBP marker at offset 8; length bytes between them are variable.
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


# ── Error type (mapped to HTTP 4xx by the router) ────────────────────


class InvalidImageError(Exception):
    """Raised when the uploaded bytes fail validation (size or format).

    The router catches this and maps to an appropriate 4xx. The
    `http_status` attribute lets the router pick a precise code without
    re-classifying the message.
    """

    def __init__(self, message: str, http_status: int = 400):
        super().__init__(message)
        self.http_status = http_status


# ── Upload ───────────────────────────────────────────────────────────


def upload_diagram_image(
    *,
    contents: bytes,
    question_id: str,
    test_id: str,
    supabase: Any,
    uploaded_by: Optional[str] = None,
    bucket: Optional[str] = None,
) -> dict[str, Any]:
    """Persist ``contents`` as a diagram image for ``question_id`` and
    return the metadata bundle the admin endpoint merges into the
    question's ``payload.template``.

    Args:
        contents:      Raw bytes from `UploadFile.read()` (PNG/JPG/WebP).
        question_id:   `reading_questions.id` (UUID string).
        test_id:       Parent `reading_tests.id` (UUID string). Used in
                       the storage path so deletes-on-test-cascade
                       remove the diagram cleanly.
        supabase:      A configured Supabase client (admin role). Has
                       `.storage.from_(bucket).upload(...)`.
        uploaded_by:   The admin user id (stamped onto the payload as
                       `template.image_uploaded_by` for audit).
        bucket:        Bucket name override. Defaults to
                       `config.settings.READING_IMAGES_BUCKET`.

    Returns:
        ``{
          "image_storage_path": "tests/<test_uuid>/diagrams/<q_uuid>-…",
          "image_size_bytes":   <int>,
          "image_format":       "png" | "jpg" | "webp",
          "image_source":       "manual_upload",
          "image_uploaded_at":  "<iso8601>",
          "image_uploaded_by":  <uploader id or None>,
        }``

    Raises:
        InvalidImageError: size or format guard fails.

    The function does NOT touch the database; the caller (admin
    endpoint) is responsible for merging this dict into the question's
    `payload.template` so the on-row source-of-truth stays atomic with
    other payload edits.
    """
    if len(contents) < MIN_BYTES:
        raise InvalidImageError(
            f"Image file too small ({len(contents)} bytes) — likely "
            "empty or corrupted.",
            http_status=400,
        )
    if len(contents) > MAX_BYTES:
        raise InvalidImageError(
            f"Image file too large ({len(contents) / 1024 / 1024:.2f} MB) "
            f"— the manual upload limit is {MAX_BYTES // (1024 * 1024)} MB.",
            http_status=413,
        )

    fmt = detect_format(contents)
    if fmt is None:
        raise InvalidImageError(
            "Unsupported image format. Accepted: PNG, JPG, WebP.",
            http_status=415,
        )

    # Storage path — lives alongside the listening floor-plan layout
    # under `tests/<test_uuid>/diagrams/`. Including the per-upload
    # timestamp means re-uploading the same question's image lands on a
    # fresh path (the old object is cleaned up by the DELETE endpoint
    # or the test-cascade delete; we don't overwrite in place because
    # the signed URL for the previous path stays valid for ~2h and
    # leaving the bytes in place lets a stale browser cache resolve
    # before the new image rolls out).
    timestamp = int(time.time())
    storage_path = (
        f"tests/{test_id}/diagrams/{question_id}-manual-{timestamp}.{fmt}"
    )

    # Lazy import — keeps the unit-test path free of config.py noise.
    from config import settings
    resolved_bucket = bucket or settings.READING_IMAGES_BUCKET

    content_type = "image/jpeg" if fmt == "jpg" else f"image/{fmt}"
    try:
        supabase.storage.from_(resolved_bucket).upload(
            storage_path,
            contents,
            {"content-type": content_type, "upsert": "true"},
        )
    except Exception as exc:                                                  # pragma: no cover
        logger.error("[reading_image] storage upload failed: %s", exc)
        # Re-raise so the router surfaces a 500 — the bucket is a
        # deploy precondition (one-time Supabase dashboard step); any
        # failure here is operational, not user-correctable.
        raise

    now_iso = datetime.now(timezone.utc).isoformat()
    return {
        "image_storage_path": storage_path,
        "image_size_bytes":   len(contents),
        "image_format":       fmt,
        "image_source":       "manual_upload",
        "image_uploaded_at":  now_iso,
        "image_uploaded_by":  uploaded_by,
    }
