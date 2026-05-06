"""Tests for services.cloudinary_service (Phase 2.3c-1).

Two layers:
  • Pre-network validation — empty / oversize bytes raise BEFORE
    we ever call into the SDK, so callers get a fast 400.
  • SDK contract — patching `cloudinary.uploader.upload` /
    `.destroy` gives us a clean record of the args we pass and
    pins the response shape we expose to callers.

We patch credentials onto `services.cloudinary_service.settings`
so `_configure_once` doesn't refuse to run during the test —
without that, every call would raise `CloudinaryConfigError`
before reaching the mocked SDK.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from services import cloudinary_service as cs
from services.cloudinary_service import (
    MAX_FILE_SIZE_BYTES,
    PROMPT_IMAGES_FOLDER,
    delete_prompt_image,
    upload_prompt_image,
)


@pytest.fixture(autouse=True)
def _reset_configured_flag():
    """Each test starts with `_configured = False` so the lazy
    config path runs against THIS test's patched settings rather
    than whatever the previous test left behind."""
    cs._configured = False
    yield
    cs._configured = False


@pytest.fixture
def _stub_credentials(monkeypatch):
    """Pretend the Railway env vars are set so `_configure_once`
    succeeds without trying to reach Cloudinary."""
    monkeypatch.setattr(cs.settings, "CLOUDINARY_CLOUD_NAME", "test-cloud")
    monkeypatch.setattr(cs.settings, "CLOUDINARY_API_KEY",    "test-key")
    monkeypatch.setattr(cs.settings, "CLOUDINARY_API_SECRET", "test-secret")
    # `cloudinary.config(...)` is a no-op stub during tests — the
    # SDK functions we actually exercise are mocked at call sites.
    with patch.object(cs.cloudinary, "config") as mock_config:
        yield mock_config


# ── Pre-network validation ───────────────────────────────────────────


def test_upload_rejects_empty_bytes(_stub_credentials):
    """An empty body is a misclick (browser sent an unselected file)
    — fail fast with ValueError before hitting Cloudinary."""
    with pytest.raises(ValueError, match="(?i)empty"):
        upload_prompt_image(b"", filename_hint="x.png")


def test_upload_rejects_oversize(_stub_credentials):
    """Files past MAX_FILE_SIZE_BYTES raise ValueError BEFORE the
    network call — saves bandwidth + matches the admin-UI 400."""
    big = b"\x00" * (MAX_FILE_SIZE_BYTES + 1)
    with pytest.raises(ValueError, match="too large"):
        upload_prompt_image(big)


# ── SDK contract ─────────────────────────────────────────────────────


def test_upload_calls_sdk_with_folder_and_transformations(_stub_credentials):
    """The SDK call carries the canonical folder + transformation
    list. Pinning these prevents a regression that quietly drops
    quality:auto:good or the 1200px width cap, which would silently
    blow up storage and bandwidth costs."""
    fake_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100

    with patch.object(cs.cloudinary.uploader, "upload") as mock_upload:
        mock_upload.return_value = {
            "secure_url": "https://res.cloudinary.com/x/image/upload/test.png",
            "public_id":  "aver/writing/prompt_images/abc123",
            "width":      1024,
            "height":     768,
        }

        result = upload_prompt_image(fake_bytes, filename_hint="chart.png")

    assert result == {
        "url":       "https://res.cloudinary.com/x/image/upload/test.png",
        "public_id": "aver/writing/prompt_images/abc123",
        "width":     1024,
        "height":    768,
    }

    kwargs = mock_upload.call_args.kwargs
    assert kwargs["folder"]          == PROMPT_IMAGES_FOLDER
    assert kwargs["resource_type"]   == "image"
    assert "jpg"  in kwargs["allowed_formats"]
    assert "webp" in kwargs["allowed_formats"]
    # transformation chain: the three ops must all be present so a
    # regression that drops one (e.g. removing the 1200px cap)
    # fails this assertion explicitly.
    txs = kwargs["transformation"]
    assert any(t.get("quality")      == "auto:good" for t in txs)
    assert any(t.get("fetch_format") == "auto"      for t in txs)
    assert any(t.get("width") == 1200 and t.get("crop") == "limit" for t in txs)


def test_delete_returns_true_on_ok(_stub_credentials):
    """Cloudinary returns `{"result": "ok"}` on success — we expose
    that as a plain True so callers can branch cheaply."""
    with patch.object(cs.cloudinary.uploader, "destroy",
                       return_value={"result": "ok"}):
        assert delete_prompt_image("aver/writing/prompt_images/xyz") is True


def test_delete_returns_false_on_api_error(_stub_credentials):
    """Cloudinary outage / network failure: log + return False so
    soft-delete flows continue without a 500."""
    with patch.object(cs.cloudinary.uploader, "destroy",
                       side_effect=Exception("Cloudinary 503")):
        assert delete_prompt_image("aver/writing/prompt_images/xyz") is False


def test_delete_with_empty_public_id_short_circuits():
    """Empty / None public_id never makes a network call — saves a
    pointless API hit when an admin deletes a text-only prompt."""
    with patch.object(cs.cloudinary.uploader, "destroy") as mock_destroy:
        assert delete_prompt_image("")   is False
        assert delete_prompt_image(None) is False
        mock_destroy.assert_not_called()
