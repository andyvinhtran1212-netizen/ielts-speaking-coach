"""Tests for Sprint 13.2 — bulk MP3 upload + dry-run validate endpoint.

Pinned contracts:
  - POST /admin/listening/upload/bulk: 3 valid files → 3 succeeded rows
    INSERTed, results[] mirrors filename order, partial-failure
    semantics (one bad item doesn't roll back the others).
  - Bulk hard-cap 20 files; 21st request → 422.
  - Manifest item count must equal files count → 422 mismatch.
  - Duplicate filename in manifest → 422.
  - File without manifest entry → recorded as failed in results[] with
    code manifest_missing.
  - POST /admin/listening/upload/validate: returns errors/warnings shape
    without touching storage or DB.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException, UploadFile

from routers import listening as listening_router
from tests.test_listening_router import (
    _FakeAdminClient,
    _patch_admin_auth,
    _patch_admin_client,
    _run,
)


# ── Fixtures ─────────────────────────────────────────────────────────────────


def _good_audio(size_kb: int = 60) -> bytes:
    return b"ID3" + b"\x00" * (size_kb * 1024)


def _fake_file(name: str, body: bytes | None = None) -> UploadFile:
    if body is None:
        body = _good_audio()
    f = MagicMock(spec=UploadFile)
    f.filename = name

    async def _read():
        return body

    f.read = _read
    return f


def _manifest_item(filename: str, **overrides) -> dict:
    item = {
        "filename":            filename,
        "title":               f"Title for {filename}",
        "transcript": (
            "Sample transcript for bulk upload covering listening section "
            "with enough words to clear the validator threshold."
        ),
        "accent_tag":          "us_general",
        "cefr_level":          "B2",
        "ielts_section":       1,
        "topic_tags":          ["travel"],
        "is_premium":          False,
        "external_license":    None,
        "external_source_url": None,
    }
    item.update(overrides)
    return item


# ── /upload/bulk happy path + partial failure ────────────────────────────────


def test_bulk_three_files_happy_path(monkeypatch):
    fake = _FakeAdminClient(canned={})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    files = [
        _fake_file("a.mp3"),
        _fake_file("b.mp3"),
        _fake_file("c.mp3"),
    ]
    manifest = {"items": [
        _manifest_item("a.mp3"),
        _manifest_item("b.mp3"),
        _manifest_item("c.mp3"),
    ]}

    out = _run(listening_router.admin_upload_listening_bulk(
        files=files, manifest=json.dumps(manifest), authorization=authz,
    ))

    assert out["total"] == 3
    assert out["succeeded"] == 3
    assert out["failed"] == 0
    assert len(out["results"]) == 3
    assert all(r["ok"] for r in out["results"])
    assert {r["filename"] for r in out["results"]} == {"a.mp3", "b.mp3", "c.mp3"}
    # 3 INSERTs + 3 storage uploads
    assert len(fake.inserts) == 3
    assert len(fake.uploads) == 3


def test_bulk_partial_failure_doesnt_roll_back(monkeypatch):
    fake = _FakeAdminClient(canned={})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    # File "bad.mp3" has an empty body → validator fires audio_empty.
    files = [
        _fake_file("ok-1.mp3"),
        _fake_file("bad.mp3", body=b""),
        _fake_file("ok-2.mp3"),
    ]
    manifest = {"items": [
        _manifest_item("ok-1.mp3"),
        _manifest_item("bad.mp3"),
        _manifest_item("ok-2.mp3"),
    ]}

    out = _run(listening_router.admin_upload_listening_bulk(
        files=files, manifest=json.dumps(manifest), authorization=authz,
    ))
    assert out["succeeded"] == 2
    assert out["failed"] == 1
    bad = next(r for r in out["results"] if r["filename"] == "bad.mp3")
    assert bad["ok"] is False
    codes = [e["code"] for e in bad["errors"]]
    assert "audio_empty" in codes
    # 2 successful INSERTs persisted, no roll-back.
    assert len(fake.inserts) == 2


def test_bulk_cap_at_twenty_files(monkeypatch):
    fake = _FakeAdminClient(canned={})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    files = [_fake_file(f"f{i}.mp3") for i in range(21)]
    manifest = {"items": [_manifest_item(f"f{i}.mp3") for i in range(21)]}

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upload_listening_bulk(
            files=files, manifest=json.dumps(manifest), authorization=authz,
        ))
    assert exc.value.status_code == 422
    assert "20" in str(exc.value.detail)
    assert fake.inserts == []  # nothing INSERTed when the gate fires


def test_bulk_count_mismatch_returns_422(monkeypatch):
    fake = _FakeAdminClient(canned={})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    files = [_fake_file("a.mp3"), _fake_file("b.mp3")]
    manifest = {"items": [_manifest_item("a.mp3")]}  # only one item

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upload_listening_bulk(
            files=files, manifest=json.dumps(manifest), authorization=authz,
        ))
    assert exc.value.status_code == 422
    assert "manifest items" in str(exc.value.detail)


def test_bulk_duplicate_filename_in_manifest_returns_422(monkeypatch):
    fake = _FakeAdminClient(canned={})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    files = [_fake_file("a.mp3"), _fake_file("a.mp3")]
    manifest = {"items": [_manifest_item("a.mp3"), _manifest_item("a.mp3")]}

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upload_listening_bulk(
            files=files, manifest=json.dumps(manifest), authorization=authz,
        ))
    assert exc.value.status_code == 422
    assert "duplicate" in str(exc.value.detail).lower()


def test_bulk_file_without_manifest_entry_records_failure(monkeypatch):
    fake = _FakeAdminClient(canned={})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    files = [_fake_file("a.mp3"), _fake_file("orphan.mp3")]
    # manifest has same count but mismatched filename — the orphan file
    # has no matching item.
    manifest = {"items": [_manifest_item("a.mp3"), _manifest_item("b.mp3")]}

    out = _run(listening_router.admin_upload_listening_bulk(
        files=files, manifest=json.dumps(manifest), authorization=authz,
    ))
    failed = [r for r in out["results"] if not r["ok"]]
    assert len(failed) == 1
    assert failed[0]["filename"] == "orphan.mp3"
    codes = [e["code"] for e in failed[0]["errors"]]
    assert "manifest_missing" in codes


def test_bulk_invalid_manifest_json_returns_422(monkeypatch):
    fake = _FakeAdminClient(canned={})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upload_listening_bulk(
            files=[_fake_file("a.mp3")],
            manifest="not-json-{",
            authorization=authz,
        ))
    assert exc.value.status_code == 422


# ── /upload/validate dry-run ─────────────────────────────────────────────────


def test_validate_dry_run_returns_ok_and_inferred(monkeypatch):
    fake = _FakeAdminClient(canned={})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    out = _run(listening_router.admin_upload_validate(
        audio_file=_fake_file("a.mp3"),
        title="Probe title",
        transcript=(
            "Sample transcript long enough to clear the validator minimum "
            "character threshold without warnings."
        ),
        accent_tag="us_general",
        cefr_level="B2",
        ielts_section=1,
        external_license=None,
        external_source_url=None,
        topic_tags=None,
        is_premium=False,
        authorization=authz,
    ))
    assert out["ok"] is True
    assert "inferred" in out
    assert out["inferred"]["size_bytes"] > 0
    assert out["inferred"]["duration_seconds"] >= 1
    # No actual storage / DB side effects.
    assert fake.inserts == []
    assert fake.uploads == []


def test_validate_dry_run_surfaces_errors_without_writing(monkeypatch):
    fake = _FakeAdminClient(canned={})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    out = _run(listening_router.admin_upload_validate(
        audio_file=_fake_file("tiny.mp3", body=b"x"),
        title="Probe",
        transcript="Short.",
        accent_tag="us_general",
        cefr_level="B2",
        ielts_section=1,
        external_license=None,
        external_source_url=None,
        topic_tags=None,
        is_premium=False,
        authorization=authz,
    ))
    assert out["ok"] is False
    codes = {e["code"] for e in out["errors"]}
    assert "audio_too_small" in codes
    assert "transcript_too_short" in codes
    assert fake.inserts == [] and fake.uploads == []


def test_validate_dry_run_rejects_premium_plus_nc_at_422(monkeypatch):
    fake = _FakeAdminClient(canned={})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upload_validate(
            audio_file=_fake_file("a.mp3"),
            title="...",
            transcript="A sufficiently long transcript for the validator.",
            accent_tag="us_general",
            cefr_level="B2",
            ielts_section=1,
            external_license="CC BY-NC-ND 4.0",
            external_source_url="https://example.com",
            topic_tags=None,
            is_premium=True,
            authorization=authz,
        ))
    assert exc.value.status_code == 422
