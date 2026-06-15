"""Tests for services.writing_prompt_image — the Supabase-Storage
Task 1 prompt-image upload (replaced the Cloudinary integration).

Covers the size/format guards + the happy-path upload/delete against a
fake Supabase client (no network). Backend tests auto-discover.
"""

from __future__ import annotations

import pytest

from services import writing_prompt_image as wpi


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 300            # valid PNG magic + body
JPG = b"\xff\xd8\xff" + b"\x00" * 300                 # valid JPG magic + body
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 300


# ── format sniff ─────────────────────────────────────────────────────

def test_detect_format_png_jpg_webp():
    assert wpi.detect_format(PNG) == "png"
    assert wpi.detect_format(JPG) == "jpg"
    assert wpi.detect_format(WEBP) == "webp"


def test_detect_format_rejects_gif_and_short():
    gif = b"GIF89a" + b"\x00" * 300
    assert wpi.detect_format(gif) is None
    assert wpi.detect_format(b"abc") is None        # < 12 bytes


# ── size / format guards (router maps ValueError → 400) ──────────────

def test_upload_rejects_too_small():
    with pytest.raises(ValueError, match="too small"):
        wpi.upload_prompt_image(b"\x89PNG")          # < MIN_BYTES


def test_upload_rejects_too_large():
    big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (wpi.MAX_BYTES + 1)
    with pytest.raises(ValueError, match="too large"):
        wpi.upload_prompt_image(big)


def test_upload_rejects_unsupported_format():
    pdf = b"%PDF-1.4" + b"\x00" * 300
    with pytest.raises(ValueError, match="Unsupported image format"):
        wpi.upload_prompt_image(pdf)


# ── happy path against a fake Supabase client ────────────────────────

class _FakeBucket:
    def __init__(self):
        self.uploaded = None
        self.removed = None

    def upload(self, path, data, opts):
        self.uploaded = (path, data, opts)

    def get_public_url(self, path):
        return f"https://supabase.test/storage/v1/object/public/writing-images/{path}"

    def remove(self, paths):
        self.removed = paths


class _FakeStorage:
    def __init__(self, bucket):
        self._bucket = bucket

    def from_(self, name):
        self._bucket.name = name
        return self._bucket


class _FakeClient:
    def __init__(self, bucket):
        self.storage = _FakeStorage(bucket)


def _patch_client(monkeypatch):
    bucket = _FakeBucket()
    import database
    monkeypatch.setattr(database, "supabase_admin", _FakeClient(bucket))
    return bucket


def test_upload_happy_path_returns_public_url_and_path(monkeypatch):
    bucket = _patch_client(monkeypatch)
    result = wpi.upload_prompt_image(PNG, filename_hint="chart.png")

    # URL is the public URL; public_id is the storage path under prompts/.
    assert result["url"].startswith("https://supabase.test/")
    assert result["public_id"].startswith("prompts/")
    assert result["public_id"].endswith(".png")
    assert result["width"] is None and result["height"] is None

    # content-type + upsert passed to storage.upload.
    path, data, opts = bucket.uploaded
    assert data == PNG
    assert opts["content-type"] == "image/png"
    assert opts["upsert"] == "true"


def test_upload_jpg_sets_image_jpeg_content_type(monkeypatch):
    bucket = _patch_client(monkeypatch)
    wpi.upload_prompt_image(JPG)
    assert bucket.uploaded[2]["content-type"] == "image/jpeg"


def test_delete_removes_object_and_is_best_effort(monkeypatch):
    bucket = _patch_client(monkeypatch)
    assert wpi.delete_prompt_image("prompts/abc-123.png") is True
    assert bucket.removed == ["prompts/abc-123.png"]
    # empty id → no-op, no raise.
    assert wpi.delete_prompt_image(None) is False
