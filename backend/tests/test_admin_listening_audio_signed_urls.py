"""Tests for Sprint 13.4.3.2 — GET /admin/listening/tests/{id}/audio/signed-urls.

The endpoint mints Supabase Storage signed URLs for a test bundle's
audio assets (full, 4 sections, assembled) in a single round-trip so
the tests-detail page can render <audio> preview players without N+1.
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException

from routers import listening as listening_router


# ── Fake supabase client + storage ──────────────────────────────────────────


class _Resp:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, fake, name):
        self.fake = fake
        self.name = name
        self._eq: list[tuple[str, object]] = []

    def select(self, *_a, **_kw): return self
    def eq(self, c, v): self._eq.append((c, v)); return self
    def limit(self, *_a, **_kw): return self
    def order(self, *_a, **_kw): return self

    def execute(self):
        rows = self.fake.tables.setdefault(self.name, [])
        matched = [r for r in rows if all(r.get(c) == v for c, v in self._eq)]
        return _Resp(matched)


class _StorageBucket:
    def __init__(self, fake, name):
        self.fake = fake
        self.name = name

    def create_signed_url(self, path, ttl):
        self.fake.sign_calls.append((self.name, path, ttl))
        return {"signedURL": f"https://storage.test/{self.name}/{path}?ttl={ttl}"}


class _Storage:
    def __init__(self, fake): self.fake = fake
    def from_(self, name): return _StorageBucket(self.fake, name)


class _Fake:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {
            "listening_tests":    [],
            "listening_content":  [],
        }
        self.sign_calls: list[tuple] = []
        self.storage = _Storage(self)

    def table(self, name): return _Q(self, name)


def _patch(monkeypatch):
    fake = _Fake()
    monkeypatch.setattr(listening_router, "supabase_admin", fake)
    monkeypatch.setattr(listening_router.settings, "LISTENING_AUDIO_BUCKET", "listening-audio")

    async def _admin(_authz):
        return {"id": "admin-1"}
    monkeypatch.setattr(listening_router, "require_admin", _admin)
    return fake, "Bearer fake"


def _run(coro): return asyncio.run(coro)


def _seed_test(fake, **overrides):
    row = {
        "id": str(uuid4()),
        "test_id": "ILR-LIS-001",
        "full_audio_storage_path":      None,
        "full_audio_duration_seconds":  None,
        "full_audio_size_bytes":        None,
        "assembled_audio_storage_path": None,
        "assembled_audio_generated_at": None,
    }
    row.update(overrides)
    fake.tables["listening_tests"].append(row)
    return row


def _seed_sections(fake, test_id, paths):
    for n, p in enumerate(paths, start=1):
        fake.tables["listening_content"].append({
            "id": f"c-{n}", "test_id": test_id, "section_num": n,
            "audio_storage_path": p,
        })


# ── Happy path ──────────────────────────────────────────────────────────────


def test_signed_urls_returns_full_sections_assembled_bundle(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(
        fake,
        full_audio_storage_path="tests/x/full.mp3",
        full_audio_duration_seconds=1800,
        full_audio_size_bytes=24_000_000,
        assembled_audio_storage_path="tests/x/assembled.mp3",
        assembled_audio_generated_at="2026-05-21T05:00:00Z",
    )
    _seed_sections(fake, test["id"], [
        "tests/x/section-1.mp3",
        None,
        "tests/x/section-3.mp3",
        "tests/x/section-4.mp3",
    ])

    out = _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=3600, authorization=authz,
    ))

    # Full block.
    assert out["full"]["signed_url"].startswith("https://storage.test/")
    assert out["full"]["audio_storage_path"] == "tests/x/full.mp3"
    assert out["full"]["duration_seconds"] == 1800
    assert out["full"]["size_bytes"] == 24_000_000
    # Assembled block.
    assert out["assembled"]["signed_url"]
    assert out["assembled"]["generated_at"]
    # 4 sections, each entry has signed_url (or None for missing one).
    sections = out["sections"]
    assert [s["section_num"] for s in sections] == [1, 2, 3, 4]
    assert sections[0]["signed_url"]
    assert sections[1]["signed_url"] is None              # section 2 missing
    assert sections[2]["signed_url"]
    assert sections[3]["signed_url"]
    # expires_in echoed.
    assert out["expires_in"] == 3600


def test_signed_urls_null_when_no_assets_uploaded(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_sections(fake, test["id"], [None, None, None, None])

    out = _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=3600, authorization=authz,
    ))
    assert out["full"]["signed_url"] is None
    assert out["assembled"]["signed_url"] is None
    assert all(s["signed_url"] is None for s in out["sections"])
    # No sign calls should have been made — `_sign(None)` short-circuits.
    assert fake.sign_calls == []


def test_signed_urls_404_when_test_missing(monkeypatch):
    _fake, authz = _patch(monkeypatch)
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_get_test_audio_signed_urls(
            test_id="nope", expires_in=3600, authorization=authz,
        ))
    assert excinfo.value.status_code == 404


def test_signed_urls_propagates_expiry_to_storage_sdk(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake, full_audio_storage_path="tests/x/full.mp3")
    _seed_sections(fake, test["id"], [None, None, None, None])

    _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=7200, authorization=authz,
    ))
    # Sign call recorded the TTL we asked for.
    assert any(ttl == 7200 for (_bucket, _path, ttl) in fake.sign_calls)


def test_signed_urls_uses_correct_bucket(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake, full_audio_storage_path="tests/x/full.mp3")
    _seed_sections(fake, test["id"], [None, None, None, None])

    _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=3600, authorization=authz,
    ))
    assert any(bucket == "listening-audio" for (bucket, _p, _t) in fake.sign_calls)


def test_signed_urls_only_signs_assets_that_exist(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(
        fake,
        full_audio_storage_path="tests/x/full.mp3",
        # assembled NOT present
    )
    _seed_sections(fake, test["id"], [
        "tests/x/section-1.mp3", None, None, None,
    ])
    _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=3600, authorization=authz,
    ))
    # Exactly 2 sign calls: full + section-1. Assembled + sections 2/3/4 skipped.
    assert len(fake.sign_calls) == 2
    paths = sorted(p for (_b, p, _t) in fake.sign_calls)
    assert paths == ["tests/x/full.mp3", "tests/x/section-1.mp3"]


def test_signed_urls_default_expiry_is_one_hour(monkeypatch):
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake, full_audio_storage_path="tests/x/full.mp3")
    _seed_sections(fake, test["id"], [None, None, None, None])

    # Call with the FastAPI Query default (3600).
    out = _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=3600, authorization=authz,
    ))
    assert out["expires_in"] == 3600


def test_signed_urls_returns_4_sections_even_when_db_has_3(monkeypatch):
    # If a section row is somehow missing (data migration glitch), the
    # endpoint must still return 4 entries with section_num 1-4 so the
    # frontend can render 4 drop zones predictably.
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    # Only sections 1, 2, 4 seeded — 3 missing.
    fake.tables["listening_content"].extend([
        {"id": "c-1", "test_id": test["id"], "section_num": 1,
         "audio_storage_path": "tests/x/section-1.mp3"},
        {"id": "c-2", "test_id": test["id"], "section_num": 2,
         "audio_storage_path": "tests/x/section-2.mp3"},
        {"id": "c-4", "test_id": test["id"], "section_num": 4,
         "audio_storage_path": "tests/x/section-4.mp3"},
    ])
    out = _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=3600, authorization=authz,
    ))
    sections = out["sections"]
    assert [s["section_num"] for s in sections] == [1, 2, 3, 4]
    assert sections[2]["signed_url"] is None              # section 3 placeholder


def test_signed_urls_rejects_below_min_expiry(monkeypatch):
    # FastAPI Query(ge=60, le=86400). Calling the function directly
    # bypasses dependency validation, but we still pin the constant via
    # a happy-path call at the boundary.
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake, full_audio_storage_path="tests/x/full.mp3")
    _seed_sections(fake, test["id"], [None, None, None, None])
    out = _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=60, authorization=authz,
    ))
    assert out["expires_in"] == 60


# ── Sprint 13.6.1 — contract pins (frontend-shape regression guard) ─────────
#
# Andy 2026-05-22 dogfood surfaced a bug where the audio-cutter
# frontend read ``res.full_audio_signed_url`` — a *flat* key — while
# this endpoint returns ``{full: {signed_url: ...}, sections: [...]}``.
# The frontend has been fixed (Sprint 13.6.1), but the existing tests
# above didn't expose the shape *negatively* (i.e. they didn't pin
# that the flat key is absent). The four tests below pin the nested
# contract explicitly so a well-meaning future refactor cannot "flatten"
# the response and silently re-break the cutter.


def test_signed_urls_response_is_nested_not_flat(monkeypatch):
    # Pin the *structural* contract: ``full`` is a dict, not a flat
    # field on the root object. The audio-cutter controller depends
    # on this exact shape.
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake, full_audio_storage_path="tests/x/full.mp3")
    _seed_sections(fake, test["id"], [None, None, None, None])
    out = _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=3600, authorization=authz,
    ))
    assert isinstance(out["full"], dict)
    assert isinstance(out["assembled"], dict)
    # Flat aliases must NOT exist — historical bug magnet.
    assert "full_audio_signed_url" not in out
    assert "signed_url" not in out


def test_signed_urls_full_block_field_names_locked(monkeypatch):
    # Pin the exact field names inside ``full``. The frontend reads
    # ``res.full.signed_url`` (canonical) and would break if any
    # field were renamed.
    fake, authz = _patch(monkeypatch)
    test = _seed_test(
        fake,
        full_audio_storage_path="tests/x/full.mp3",
        full_audio_duration_seconds=1800,
        full_audio_size_bytes=24_000_000,
    )
    _seed_sections(fake, test["id"], [None, None, None, None])
    out = _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=3600, authorization=authz,
    ))
    assert set(out["full"].keys()) == {
        "audio_storage_path",
        "signed_url",
        "duration_seconds",
        "size_bytes",
    }


def test_signed_urls_assembled_block_field_names_locked(monkeypatch):
    # Same idea for ``assembled`` — the tests-detail page reads
    # ``res.assembled.signed_url`` + ``res.assembled.generated_at``.
    fake, authz = _patch(monkeypatch)
    test = _seed_test(
        fake,
        assembled_audio_storage_path="tests/x/assembled.mp3",
        assembled_audio_generated_at="2026-05-21T05:00:00Z",
    )
    _seed_sections(fake, test["id"], [None, None, None, None])
    out = _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=3600, authorization=authz,
    ))
    assert set(out["assembled"].keys()) == {
        "audio_storage_path",
        "signed_url",
        "generated_at",
    }


def test_signed_urls_section_block_field_names_locked(monkeypatch):
    # Per-section entries: ``section_num``, ``audio_storage_path``,
    # ``signed_url``. tests-detail.js iterates these when rendering
    # the 4-drop-zone grid.
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_sections(fake, test["id"], [
        "tests/x/section-1.mp3", None, None, None,
    ])
    out = _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=3600, authorization=authz,
    ))
    assert len(out["sections"]) == 4
    for entry in out["sections"]:
        assert set(entry.keys()) == {
            "section_num",
            "audio_storage_path",
            "signed_url",
        }


def test_signed_urls_full_block_is_present_even_when_empty(monkeypatch):
    # The frontend reads ``res.full && res.full.signed_url`` — the
    # short-circuit on the outer ``res.full`` would mask the actual
    # null state if the backend ever stopped returning ``full`` at
    # all. Pin that the key is always present, with ``signed_url``
    # explicitly null when there's no audio.
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_sections(fake, test["id"], [None, None, None, None])
    out = _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=3600, authorization=authz,
    ))
    assert "full" in out
    assert out["full"]["signed_url"] is None
    assert out["full"]["audio_storage_path"] is None


def test_signed_urls_sections_always_four_entries_indexed_one_to_four(monkeypatch):
    # tests-detail.js renders exactly four section drop zones and
    # indexes by ``section_num``. Pin the [1, 2, 3, 4] ordering
    # contract — order matters because the frontend uses array
    # index plus a section_num lookup.
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_sections(fake, test["id"], [None, None, None, None])
    out = _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=3600, authorization=authz,
    ))
    assert [s["section_num"] for s in out["sections"]] == [1, 2, 3, 4]


def test_signed_urls_root_has_expires_in_echo(monkeypatch):
    # Frontend uses ``expires_in`` to schedule a silent refresh
    # before the URLs lapse. Pin that the field is at the root,
    # not nested under ``full``.
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake, full_audio_storage_path="tests/x/full.mp3")
    _seed_sections(fake, test["id"], [None, None, None, None])
    out = _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=7200, authorization=authz,
    ))
    assert "expires_in" in out
    assert out["expires_in"] == 7200
    # And NOT nested.
    assert "expires_in" not in out["full"]


def test_signed_urls_signed_url_value_is_string_or_none(monkeypatch):
    # Pin the value type so a future "richer" object (e.g.
    # ``{url, expires_at}``) would surface as a test failure rather
    # than a silent client-side crash on ``url.startsWith``.
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake, full_audio_storage_path="tests/x/full.mp3")
    _seed_sections(fake, test["id"], [
        "tests/x/s1.mp3", None, "tests/x/s3.mp3", None,
    ])
    out = _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=3600, authorization=authz,
    ))
    assert isinstance(out["full"]["signed_url"], str)
    for entry in out["sections"]:
        assert entry["signed_url"] is None or isinstance(entry["signed_url"], str)


def test_signed_urls_section_audio_path_propagates(monkeypatch):
    # Sprint 13.6.1 audio cutter does not yet operate on per-section
    # audio — but the tests-detail page does, and the round-trip
    # should always return the storage path so the admin UI can
    # show the bucket key even when the signed URL mint fails.
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake)
    _seed_sections(fake, test["id"], [
        "tests/x/s1.mp3", "tests/x/s2.mp3", None, None,
    ])
    out = _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=3600, authorization=authz,
    ))
    paths = [s["audio_storage_path"] for s in out["sections"]]
    assert paths == ["tests/x/s1.mp3", "tests/x/s2.mp3", None, None]


def test_signed_urls_does_not_leak_storage_bucket_in_root(monkeypatch):
    # Internal bucket name should not appear as a root field — the
    # frontend uses signed URLs only, and a bucket-key root field
    # would tempt clients to construct their own URLs (RLS-bypass
    # surface). Pin the absence.
    fake, authz = _patch(monkeypatch)
    test = _seed_test(fake, full_audio_storage_path="tests/x/full.mp3")
    _seed_sections(fake, test["id"], [None, None, None, None])
    out = _run(listening_router.admin_get_test_audio_signed_urls(
        test_id=test["id"], expires_in=3600, authorization=authz,
    ))
    assert "bucket" not in out
    assert "storage_bucket" not in out
