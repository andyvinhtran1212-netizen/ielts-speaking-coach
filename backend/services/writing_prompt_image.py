"""services/writing_prompt_image.py — Task 1 prompt-image upload.

Stores Task 1 Academic prompt images (chart / graph) in Supabase
Storage, mirroring the reading/listening image-upload pattern
(`services/reading_image.py`, `routers/listening.py::admin_upload_map_image`)
instead of the previous Cloudinary integration. This removes the only
external-service dependency in the writing path and sidesteps the
opaque Cloudinary failure that surfaced as a generic 500.

Design (mirrors reading_image.py):
  • Magic-byte format sniff (PNG / JPG / WebP only). No Pillow / Magic
    dependency — byte signatures are cheap + reliable. (Pillow is NOT a
    declared requirement, so no server-side resize: images are stored
    as-is, bounded by the 5 MB cap.)
  • Size floor 100 B (rejects empty / corrupted), ceiling 5 MB.
  • Storage: PUBLIC Supabase bucket `writing-images`
    (config.WRITING_IMAGES_BUCKET) under `prompts/<uuid>-<ts>.<ext>`.
    The bucket is a one-time deploy precondition (Supabase dashboard →
    Storage → New bucket → name `writing-images` → Public ✓), exactly
    like reading-images / listening-images.

The public URL is persisted straight into `writing_prompts.prompt_image_url`
and rendered directly as `<img src>` by the admin prompts page, the
student assignment modal, and the "Kho đề" tab (#467) — so a PUBLIC
bucket keeps that read contract unchanged (no signed-URL minting on
the read side).

Public API (signatures match the retired cloudinary_service so the
router + its tests are unaffected):
    upload_prompt_image(file_bytes, filename_hint=None) -> dict
        {url, public_id, width, height}   # public_id = storage path
    delete_prompt_image(public_id) -> bool
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Optional


logger = logging.getLogger(__name__)


# ── Format sniff (magic-byte) — shares the reading/listening accept-set ──
_IMAGE_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff",      "jpg"),
)

SUPPORTED_FORMATS: tuple[str, ...] = ("png", "jpg", "webp")
MIN_BYTES: int = 100
MAX_BYTES: int = 5 * 1024 * 1024


def detect_format(data: bytes) -> Optional[str]:
    """Return ``"png"`` / ``"jpg"`` / ``"webp"`` from the magic-byte
    prefix, or ``None`` for any other format (GIF/BMP/SVG/PDF reject)."""
    if not data or len(data) < 12:
        return None
    for sig, fmt in _IMAGE_SIGNATURES:
        if data.startswith(sig):
            return fmt
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def upload_prompt_image(
    file_bytes: bytes,
    filename_hint: Optional[str] = None,   # accepted for signature parity; unused
) -> dict[str, Any]:
    """Upload ``file_bytes`` to the writing-images bucket and return the
    public URL + storage path.

    Returns ``{"url": <public url>, "public_id": <storage path>,
    "width": None, "height": None}``. ``public_id`` carries the storage
    path so ``delete_prompt_image`` can remove the object on prompt
    delete (the column ``writing_prompts.prompt_image_public_id`` stores
    it). ``width``/``height`` are ``None`` — without Pillow we don't
    decode dimensions; the response model declares them Optional.

    Raises:
        ValueError: size or format guard fails (router maps to 400).
        Exception:  storage upload failure is logged + re-raised so the
                    router surfaces a 500 with the real cause in the log
                    (the bucket is a deploy precondition, not
                    user-correctable).
    """
    if len(file_bytes) < MIN_BYTES:
        raise ValueError(
            f"Image file too small ({len(file_bytes)} bytes) — likely "
            "empty or corrupted."
        )
    if len(file_bytes) > MAX_BYTES:
        raise ValueError(
            f"Image file too large ({len(file_bytes) / 1024 / 1024:.2f} MB) "
            f"— the upload limit is {MAX_BYTES // (1024 * 1024)} MB."
        )

    fmt = detect_format(file_bytes)
    if fmt is None:
        raise ValueError("Unsupported image format. Accepted: PNG, JPG, WebP.")

    # Lazy imports keep import-time light + match reading_image's pattern.
    from database import supabase_admin
    from config import settings

    bucket = settings.WRITING_IMAGES_BUCKET
    storage_path = f"prompts/{uuid.uuid4()}-{int(time.time())}.{fmt}"
    content_type = "image/jpeg" if fmt == "jpg" else f"image/{fmt}"

    try:
        supabase_admin.storage.from_(bucket).upload(
            storage_path,
            file_bytes,
            {"content-type": content_type, "upsert": "true"},
        )
    except Exception as exc:
        # Log the REAL error (don't swallow it) so a genuine storage /
        # bucket-missing failure is diagnosable; re-raise → router 500.
        logger.error(
            "[writing_prompt_image] storage upload failed (bucket=%s path=%s): %s",
            bucket, storage_path, exc, exc_info=True,
        )
        raise

    url = supabase_admin.storage.from_(bucket).get_public_url(storage_path)
    return {"url": url, "public_id": storage_path, "width": None, "height": None}


def delete_prompt_image(public_id: Optional[str]) -> bool:
    """Best-effort delete of the stored object. ``public_id`` is the
    storage path returned by ``upload_prompt_image``. Never raises —
    a cleanup failure must not block the prompt soft-delete."""
    if not public_id:
        return False
    try:
        from database import supabase_admin
        from config import settings
        supabase_admin.storage.from_(settings.WRITING_IMAGES_BUCKET).remove([public_id])
        return True
    except Exception as exc:
        logger.warning("[writing_prompt_image] delete failed (path=%s): %s", public_id, exc)
        return False
