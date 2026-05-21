"""Tests for Sprint 13.4.3 — listening test bundle audio upload + assembly.

Pins:
  * services.listening_audio.validate_full_audio  / validate_section_audio
  * services.listening_audio.assemble_test_audio   (with pydub + ElevenLabs
    mocks so CI doesn't need ffmpeg or the network)
  * services.listening_audio.can_publish           publish-gate rule
  * POST /admin/listening/tests/{id}/audio/full
  * POST /admin/listening/tests/{id}/audio/section/{section_num}
  * POST /admin/listening/tests/{id}/audio/assemble
  * PATCH /admin/listening/tests/{id}/audio/mode
  * PATCH /admin/listening/tests/{id}/status — audio publish gate
"""

from __future__ import annotations

import asyncio
import io
import sys
import types
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile

from routers import listening as listening_router


# ── pydub mock (registered once at import time) ─────────────────────────────


class _FakeAudioSegment:
    """Minimal AudioSegment-like object: tracks duration in ms + supports
    +, len(), export().
    """

    def __init__(self, duration_ms: int = 0):
        self.duration_ms = duration_ms

    def __len__(self):
        return self.duration_ms

    def __add__(self, other):
        return _FakeAudioSegment(self.duration_ms + other.duration_ms)

    def export(self, buf, format="mp3", bitrate="192k"):
        buf.write(b"FAKE-ASSEMBLED-MP3-" + str(self.duration_ms).encode())
        return buf

    @classmethod
    def from_file(cls, fileobj, format="mp3"):
        # Read bytes, derive duration from a marker in the bytes:
        # convention used by tests below — "DUR=<ms>" embedded in fixture.
        try:
            data = fileobj.read()
        except Exception:
            data = b""
        ms = 60_000                                 # default 60s
        marker = b"DUR="
        if marker in data:
            tail = data.split(marker, 1)[1]
            # Iterating over bytes yields ints in Python 3 — collect a
            # text-mode digit prefix instead.
            digit_chars: list[str] = []
            for b in tail[:10]:
                ch = chr(b)
                if ch.isdigit():
                    digit_chars.append(ch)
                else:
                    break
            if digit_chars:
                ms = int("".join(digit_chars))
        return cls(ms)

    @classmethod
    def silent(cls, duration: int = 0):
        return cls(duration_ms=duration)


# Pre-install fake pydub before importing listening_audio so it picks up
# the fake (the service does `from pydub import AudioSegment` inside its
# functions, so the patch only needs to be in place at call time).
_fake_pydub = types.ModuleType("pydub")
_fake_pydub.AudioSegment = _FakeAudioSegment                                # type: ignore
sys.modules.setdefault("pydub", _fake_pydub)
# Replace anything pre-imported by other tests so the fake wins.
sys.modules["pydub"] = _fake_pydub


from services import listening_audio                                       # noqa: E402


# ── Fixtures ────────────────────────────────────────────────────────────────


def _mp3_bytes(duration_ms: int, size_kb: int = 200) -> bytes:
    """Build a fake MP3 byte blob the fake pydub will decode to
    `duration_ms`. Pads to `size_kb` KB so size validators are happy."""
    header = b"ID3"                                                         # MP3 magic prefix
    marker = f"DUR={duration_ms}".encode()
    payload = header + marker
    pad = b"\x00" * max(0, size_kb * 1024 - len(payload))
    return payload + pad


# ── validate_full_audio ─────────────────────────────────────────────────────


def test_validate_full_audio_happy_path_warns_outside_target_band():
    data = _mp3_bytes(20 * 60 * 1000, size_kb=2000)     # 20 min — outside 25-35 target
    out = listening_audio.validate_full_audio(data)
    assert out["errors"] == []
    assert out["duration_seconds"] == 20 * 60
    assert any("25-35 phút" in w for w in out["warnings"])


def test_validate_full_audio_rejects_too_small():
    out = listening_audio.validate_full_audio(b"ID3" + b"\x00" * 100)
    assert any("quá nhỏ" in e for e in out["errors"])


def test_validate_full_audio_rejects_too_short_duration():
    data = _mp3_bytes(2 * 60 * 1000, size_kb=500)        # 2 min < 5 min floor
    out = listening_audio.validate_full_audio(data)
    assert any("< 300s" in e or "minimum" in e.lower() for e in out["errors"])


def test_validate_full_audio_target_band_no_warning():
    data = _mp3_bytes(30 * 60 * 1000, size_kb=2000)      # 30 min — inside target
    out = listening_audio.validate_full_audio(data)
    assert out["errors"] == []
    assert all("25-35 phút" not in w for w in out["warnings"])


def test_validate_full_audio_warns_on_missing_magic_bytes():
    # 30 min duration but no ID3 / FFFB prefix → soft warning.
    bare = f"DUR={30 * 60 * 1000}".encode() + b"\x00" * (500 * 1024)
    out = listening_audio.validate_full_audio(bare)
    assert any("magic bytes" in w for w in out["warnings"])


# ── validate_section_audio ──────────────────────────────────────────────────


def test_validate_section_audio_within_target():
    data = _mp3_bytes(5 * 60 * 1000, size_kb=300)
    out = listening_audio.validate_section_audio(data)
    assert out["errors"] == []
    assert out["duration_seconds"] == 5 * 60


def test_validate_section_audio_warns_outside_target():
    data = _mp3_bytes(10 * 60 * 1000, size_kb=300)       # 10 min — outside 3-8
    out = listening_audio.validate_section_audio(data)
    assert out["errors"] == []
    assert any("3-8 phút" in w for w in out["warnings"])


def test_validate_section_audio_rejects_too_long():
    data = _mp3_bytes(20 * 60 * 1000, size_kb=300)       # > 15 min max
    out = listening_audio.validate_section_audio(data)
    assert any("1-15 phút" in e for e in out["errors"])


# ── can_publish ─────────────────────────────────────────────────────────────


def test_can_publish_full_premixed_satisfied():
    ok, _ = listening_audio.can_publish({
        "audio_assembly_mode":     "full_premixed",
        "full_audio_storage_path": "tests/x/full.mp3",
    })
    assert ok


def test_can_publish_full_premixed_missing_blocks():
    ok, reason = listening_audio.can_publish({
        "audio_assembly_mode":     "full_premixed",
        "full_audio_storage_path": None,
    })
    assert not ok and "full_audio_storage_path" in reason


def test_can_publish_parts_auto_satisfied_only_when_assembled():
    ok, _ = listening_audio.can_publish({
        "audio_assembly_mode":          "parts_auto_assembled",
        "assembled_audio_storage_path": "tests/x/assembled.mp3",
    })
    assert ok
    ok, reason = listening_audio.can_publish({
        "audio_assembly_mode":          "parts_auto_assembled",
        "assembled_audio_storage_path": None,
    })
    assert not ok and "assembled_audio_storage_path" in reason


def test_can_publish_parts_only_always_blocked():
    ok, reason = listening_audio.can_publish({
        "audio_assembly_mode": "parts_only",
    })
    assert not ok and "parts_only" in reason


def test_can_publish_missing_mode_blocked():
    ok, reason = listening_audio.can_publish({})
    assert not ok and "audio_assembly_mode" in reason


# ── assemble_test_audio ─────────────────────────────────────────────────────


def test_assemble_test_audio_produces_cue_points_in_order():
    # 4 sections of 5 min each → expected pattern of cue points.
    section_durations_ms = [5 * 60 * 1000] * 4
    sections = [_mp3_bytes(d, size_kb=300) for d in section_durations_ms]
    intros   = [f"Section {n} intro." for n in (1, 2, 3, 4)]

    # Mock ElevenLabs: fixed 10-second narrator per call.
    narrator_ms = 10_000
    def fake_render(text, voice_id, model):
        return _mp3_bytes(narrator_ms, size_kb=50)

    result = listening_audio.assemble_test_audio(
        sections, intros, elevenlabs_render_fn=fake_render,
        pre_read_pause=30, inter_section_pause=5, end_pause=30,
    )
    assert result.duration_seconds > 0
    # Sequence of cue point types: 4×(narrator_intro_start, section_start,
    # section_end) + test_end.
    types_seen = [c["type"] for c in result.cue_points]
    assert types_seen[:3] == ["narrator_intro_start", "section_start", "section_end"]
    assert types_seen[-1] == "test_end"
    # 4 narrator intros + 4 starts + 4 ends + 1 test_end = 13.
    assert len(result.cue_points) == 13
    # Cue timestamps are strictly monotonic.
    ts = [c["timestamp_seconds"] for c in result.cue_points]
    assert ts == sorted(ts)


def test_assemble_test_audio_credit_estimate_counts_all_narrator_text():
    sections = [_mp3_bytes(5 * 60 * 1000, size_kb=300)] * 4
    intros   = ["Hello.", "Hello.", "Hello.", "Hello."]   # 6 chars × 4 = 24
    end_chars = len(listening_audio.END_ANNOUNCEMENT_TEXT)
    expected_chars = 24 + end_chars

    def fake_render(text, voice_id, model):
        return _mp3_bytes(5_000, size_kb=50)

    result = listening_audio.assemble_test_audio(
        sections, intros, elevenlabs_render_fn=fake_render,
    )
    # 2 credits/char (multilingual_v2 default).
    assert result.narrator_credit_estimate == expected_chars * 2


def test_assemble_test_audio_falls_back_to_default_intro_when_narrator_empty():
    sections = [_mp3_bytes(60_000, size_kb=300)] * 4
    intros   = [None, "", "   ", None]                   # all empty
    captured: list[str] = []

    def fake_render(text, voice_id, model):
        captured.append(text)
        return _mp3_bytes(5_000, size_kb=50)

    listening_audio.assemble_test_audio(
        sections, intros, elevenlabs_render_fn=fake_render,
    )
    # First 4 calls = narrator intros (fallback template). Each falls back
    # to "You will now hear section N..." (contains "section N").
    for i in range(4):
        assert f"section {i + 1}" in captured[i].lower()
    # 5th call = end announcement.
    assert "end of the listening test" in captured[4].lower()


def test_assemble_test_audio_rejects_non_four_sections():
    with pytest.raises(ValueError):
        listening_audio.assemble_test_audio(
            [_mp3_bytes(60_000)] * 3, ["a", "b", "c"],
            elevenlabs_render_fn=lambda *_a: b"",
        )


# ── Router: full audio upload ───────────────────────────────────────────────


def _patch_admin_auth(monkeypatch):
    async def _fake_admin(_authz):
        return {"id": "admin-1", "email": "admin@example.com"}
    monkeypatch.setattr(listening_router, "require_admin", _fake_admin)
    return "Bearer fake-admin"


def _patch_supabase_admin(monkeypatch, fake):
    monkeypatch.setattr(listening_router, "supabase_admin", fake)


def _patch_settings_bucket(monkeypatch, bucket: str = "listening-audio"):
    monkeypatch.setattr(listening_router.settings, "LISTENING_AUDIO_BUCKET", bucket)


class _Resp:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _Query:
    def __init__(self, fake, name):
        self.fake = fake
        self.name = name
        self._mode = "select"
        self._payload = None
        self._eq: list[tuple[str, object]] = []

    def select(self, *_a, **_kw):
        self._mode = "select"
        return self

    def update(self, payload):
        self._mode = "update"
        self._payload = payload
        return self

    def insert(self, payload):
        self._mode = "insert"
        self._payload = payload
        return self

    def delete(self):
        self._mode = "delete"
        return self

    def eq(self, col, val):
        self._eq.append((col, val))
        return self

    def order(self, *_a, **_kw):
        return self

    def limit(self, *_a, **_kw):
        return self

    def execute(self):
        rows = self.fake.tables.setdefault(self.name, [])
        def _match(r):
            return all(r.get(c) == v for c, v in self._eq)
        if self._mode == "update":
            matched = [r for r in rows if _match(r)]
            for r in matched:
                r.update(self._payload or {})
            self.fake.updates.append((self.name, dict(self._payload or {}), list(self._eq)))
            return _Resp(matched)
        if self._mode == "insert":
            payload = self._payload or {}
            payloads = payload if isinstance(payload, list) else [payload]
            for p in payloads:
                rows.append(dict(p))
            return _Resp(payloads)
        matched = sorted([r for r in rows if _match(r)],
                         key=lambda r: r.get("section_num") or 0)
        return _Resp(matched, count=len(matched))


class _StorageBucket:
    def __init__(self, fake, bucket_name):
        self._fake = fake
        self._bucket = bucket_name

    def upload(self, path, data, headers=None):
        self._fake.uploads.append((self._bucket, path, len(data), headers))
        self._fake.storage_blobs[(self._bucket, path)] = bytes(data)
        return {"path": path}

    def download(self, path):
        return self._fake.storage_blobs.get((self._bucket, path), b"")

    def create_signed_url(self, path, ttl):
        return {"signedURL": f"https://storage.test/{self._bucket}/{path}?ttl={ttl}"}


class _Storage:
    def __init__(self, fake):
        self.fake = fake

    def from_(self, bucket):
        return _StorageBucket(self.fake, bucket)


class _FakeAdmin:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {
            "listening_tests":    [],
            "listening_content":  [],
            "listening_exercises": [],
        }
        self.uploads: list[tuple] = []
        self.updates: list[tuple] = []
        self.storage_blobs: dict[tuple, bytes] = {}
        self.storage = _Storage(self)

    def table(self, name):
        return _Query(self, name)


def _seed_test(fake: _FakeAdmin, **overrides) -> dict:
    row = {
        "id":               str(uuid4()),
        "test_id":          "ILR-LIS-001",
        "title":            "Pilot 01",
        "status":           "draft",
        "audio_assembly_mode":          None,
        "full_audio_storage_path":      None,
        "full_audio_duration_seconds":  None,
        "assembled_audio_storage_path": None,
        "assembled_audio_generated_at": None,
        "cue_points":       [],
    }
    row.update(overrides)
    fake.tables["listening_tests"].append(row)
    return row


def _seed_sections(fake: _FakeAdmin, test_id: str, audio_paths: list[str | None]):
    for n, path in enumerate(audio_paths, start=1):
        fake.tables["listening_content"].append({
            "id":                 f"content-{n}",
            "test_id":            test_id,
            "section_num":        n,
            "audio_storage_path": path,
            "updated_at":         "2026-05-21T00:00:00Z",
            "metadata":           {"narrator_intro": f"Section {n} intro."},
        })


def _make_upload(name: str, body: bytes) -> UploadFile:
    return UploadFile(filename=name, file=io.BytesIO(body))


def _run(coro):
    return asyncio.run(coro)


def test_router_upload_full_audio_happy_path(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(fake)
    _patch_supabase_admin(monkeypatch, fake)
    _patch_settings_bucket(monkeypatch)
    authz = _patch_admin_auth(monkeypatch)

    body = _mp3_bytes(30 * 60 * 1000, size_kb=2500)
    upload = _make_upload("full.mp3", body)
    out = _run(listening_router.admin_upload_test_full_audio(
        test_id=test["id"], audio=upload, authorization=authz,
    ))
    assert out["full_audio_storage_path"] == f"tests/{test['id']}/full.mp3"
    assert out["full_audio_duration_seconds"] == 30 * 60
    assert out["audio_assembly_mode"] == "full_premixed"          # auto-set
    # Bucket received the bytes.
    assert fake.uploads
    # listening_tests row updated.
    row = fake.tables["listening_tests"][0]
    assert row["audio_assembly_mode"] == "full_premixed"


def test_router_upload_full_audio_rejects_non_mp3(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(fake)
    _patch_supabase_admin(monkeypatch, fake)
    _patch_settings_bucket(monkeypatch)
    authz = _patch_admin_auth(monkeypatch)

    upload = _make_upload("audio.wav", _mp3_bytes(30 * 60 * 1000, size_kb=2500))
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_upload_test_full_audio(
            test_id=test["id"], audio=upload, authorization=authz,
        ))
    assert excinfo.value.status_code == 422


def test_router_upload_section_audio_updates_content_row(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(fake)
    _seed_sections(fake, test["id"], [None, None, None, None])
    _patch_supabase_admin(monkeypatch, fake)
    _patch_settings_bucket(monkeypatch)
    authz = _patch_admin_auth(monkeypatch)

    body = _mp3_bytes(5 * 60 * 1000, size_kb=400)
    upload = _make_upload("s1.mp3", body)
    out = _run(listening_router.admin_upload_test_section_audio(
        test_id=test["id"], section_num=1, audio=upload, authorization=authz,
    ))
    assert out["section_num"] == 1
    assert out["audio_storage_path"] == f"tests/{test['id']}/section-1.mp3"
    # Section row UPDATEd.
    sec = next(c for c in fake.tables["listening_content"] if c["section_num"] == 1)
    assert sec["audio_storage_path"] == out["audio_storage_path"]
    # Mode auto-set to parts_only on first part upload.
    assert fake.tables["listening_tests"][0]["audio_assembly_mode"] == "parts_only"


def test_router_upload_section_audio_invalidates_assembled_cache(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(
        fake,
        audio_assembly_mode="parts_auto_assembled",
        assembled_audio_storage_path="tests/x/assembled.mp3",
        assembled_audio_generated_at="2026-05-20T00:00:00Z",
    )
    _seed_sections(fake, test["id"], [
        "tests/x/section-1.mp3", "tests/x/section-2.mp3",
        "tests/x/section-3.mp3", "tests/x/section-4.mp3",
    ])
    _patch_supabase_admin(monkeypatch, fake)
    _patch_settings_bucket(monkeypatch)
    authz = _patch_admin_auth(monkeypatch)

    upload = _make_upload("s2.mp3", _mp3_bytes(5 * 60 * 1000, size_kb=400))
    _run(listening_router.admin_upload_test_section_audio(
        test_id=test["id"], section_num=2, audio=upload, authorization=authz,
    ))
    row = fake.tables["listening_tests"][0]
    assert row["assembled_audio_storage_path"] is None
    assert row["assembled_audio_generated_at"] is None
    # Mode preserved (parts_auto_assembled stays — admin clicks re-assemble).
    assert row["audio_assembly_mode"] == "parts_auto_assembled"


def test_router_section_audio_404_when_section_row_missing(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(fake)
    # No listening_content rows seeded.
    _patch_supabase_admin(monkeypatch, fake)
    _patch_settings_bucket(monkeypatch)
    authz = _patch_admin_auth(monkeypatch)

    upload = _make_upload("s1.mp3", _mp3_bytes(5 * 60 * 1000, size_kb=400))
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_upload_test_section_audio(
            test_id=test["id"], section_num=1, audio=upload, authorization=authz,
        ))
    assert excinfo.value.status_code == 404


# ── Router: assemble ────────────────────────────────────────────────────────


def _patch_elevenlabs_key(monkeypatch, key="sk_test"):
    monkeypatch.setattr(listening_router.settings, "ELEVENLABS_API_KEY", key)


def test_router_assemble_happy_path(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(fake, audio_assembly_mode="parts_only")
    _seed_sections(fake, test["id"], [
        f"tests/{test['id']}/section-{n}.mp3" for n in (1, 2, 3, 4)
    ])
    # Pre-populate storage with section blobs (download() reads these).
    for n in (1, 2, 3, 4):
        fake.storage_blobs[("listening-audio", f"tests/{test['id']}/section-{n}.mp3")] \
            = _mp3_bytes(5 * 60 * 1000, size_kb=400)

    _patch_supabase_admin(monkeypatch, fake)
    _patch_settings_bucket(monkeypatch)
    _patch_elevenlabs_key(monkeypatch)
    authz = _patch_admin_auth(monkeypatch)

    # Inject a deterministic ElevenLabs adapter by patching the default.
    monkeypatch.setattr(
        listening_audio, "_default_elevenlabs_render",
        lambda text, voice_id, model: _mp3_bytes(10_000, size_kb=50),
    )

    out = _run(listening_router.admin_assemble_test_audio(
        test_id=test["id"], body=listening_router.TestAudioAssembleRequest(),
        authorization=authz,
    ))
    assert out["assembled_audio_storage_path"] == f"tests/{test['id']}/assembled.mp3"
    assert out["cue_points"]
    assert out["narrator_credit_estimate"] > 0
    assert out["cached"] is False
    # Row updated to parts_auto_assembled.
    row = fake.tables["listening_tests"][0]
    assert row["audio_assembly_mode"] == "parts_auto_assembled"
    assert row["assembled_audio_storage_path"] == out["assembled_audio_storage_path"]
    assert row["cue_points"] == out["cue_points"]


def test_router_assemble_blocks_when_section_audio_missing(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(fake)
    _seed_sections(fake, test["id"], [
        "tests/x/section-1.mp3", None, "tests/x/section-3.mp3", "tests/x/section-4.mp3",
    ])
    _patch_supabase_admin(monkeypatch, fake)
    _patch_settings_bucket(monkeypatch)
    _patch_elevenlabs_key(monkeypatch)
    authz = _patch_admin_auth(monkeypatch)

    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_assemble_test_audio(
            test_id=test["id"], body=listening_router.TestAudioAssembleRequest(),
            authorization=authz,
        ))
    assert excinfo.value.status_code == 422
    assert "[2]" in str(excinfo.value.detail) or "2" in str(excinfo.value.detail)


def test_router_assemble_returns_cached_when_up_to_date(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(
        fake,
        audio_assembly_mode="parts_auto_assembled",
        assembled_audio_storage_path="tests/x/assembled.mp3",
        assembled_audio_generated_at="2026-05-22T00:00:00Z",
        cue_points=[{"type": "test_end", "timestamp_seconds": 1800.0}],
    )
    _seed_sections(fake, test["id"], [
        "tests/x/section-1.mp3", "tests/x/section-2.mp3",
        "tests/x/section-3.mp3", "tests/x/section-4.mp3",
    ])
    # All section updated_at < assembled_audio_generated_at.
    _patch_supabase_admin(monkeypatch, fake)
    _patch_settings_bucket(monkeypatch)
    _patch_elevenlabs_key(monkeypatch)
    authz = _patch_admin_auth(monkeypatch)

    out = _run(listening_router.admin_assemble_test_audio(
        test_id=test["id"], body=listening_router.TestAudioAssembleRequest(),
        authorization=authz,
    ))
    assert out["cached"] is True
    assert out["assembled_audio_storage_path"] == "tests/x/assembled.mp3"


def test_router_assemble_requires_elevenlabs_key(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(fake)
    _seed_sections(fake, test["id"], [
        "tests/x/section-1.mp3", "tests/x/section-2.mp3",
        "tests/x/section-3.mp3", "tests/x/section-4.mp3",
    ])
    _patch_supabase_admin(monkeypatch, fake)
    _patch_settings_bucket(monkeypatch)
    monkeypatch.setattr(listening_router.settings, "ELEVENLABS_API_KEY", "")
    authz = _patch_admin_auth(monkeypatch)

    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_assemble_test_audio(
            test_id=test["id"], body=listening_router.TestAudioAssembleRequest(),
            authorization=authz,
        ))
    assert excinfo.value.status_code == 503


# ── Router: mode toggle ─────────────────────────────────────────────────────


def test_router_mode_toggle_to_full_premixed_requires_full_audio(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(fake, full_audio_storage_path=None)
    _patch_supabase_admin(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.TestAudioModePatchRequest(mode="full_premixed")
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_patch_test_audio_mode(
            test_id=test["id"], body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 422


def test_router_mode_toggle_to_parts_auto_requires_all_4_sections(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(fake)
    _seed_sections(fake, test["id"], [
        "tests/x/section-1.mp3", None, "tests/x/section-3.mp3", "tests/x/section-4.mp3",
    ])
    _patch_supabase_admin(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.TestAudioModePatchRequest(mode="parts_auto_assembled")
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_patch_test_audio_mode(
            test_id=test["id"], body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 422


def test_router_mode_toggle_to_parts_only_always_allowed(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(fake)
    _patch_supabase_admin(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.TestAudioModePatchRequest(mode="parts_only")
    out = _run(listening_router.admin_patch_test_audio_mode(
        test_id=test["id"], body=body, authorization=authz,
    ))
    assert out["audio_assembly_mode"] == "parts_only"


def test_router_mode_toggle_rejects_unknown_mode(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(fake)
    _patch_supabase_admin(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.TestAudioModePatchRequest(mode="garbage")
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_patch_test_audio_mode(
            test_id=test["id"], body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 422


# ── Router: publish gate ────────────────────────────────────────────────────


def test_status_publish_blocked_when_no_audio(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(fake)                              # mode=None
    _patch_supabase_admin(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ListeningTestStatusPatchRequest(status="published")
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_patch_listening_test_status(
            test_id=test["id"], body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 422


def test_status_publish_allowed_when_full_audio_present(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(
        fake,
        audio_assembly_mode="full_premixed",
        full_audio_storage_path="tests/x/full.mp3",
    )
    _patch_supabase_admin(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ListeningTestStatusPatchRequest(status="published")
    out = _run(listening_router.admin_patch_listening_test_status(
        test_id=test["id"], body=body, authorization=authz,
    ))
    assert out["status"] == "published"


def test_status_publish_blocked_when_parts_only(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(fake, audio_assembly_mode="parts_only")
    _patch_supabase_admin(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ListeningTestStatusPatchRequest(status="published")
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_patch_listening_test_status(
            test_id=test["id"], body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 422
    assert "parts_only" in str(excinfo.value.detail)


def test_status_archive_still_allowed_without_audio(monkeypatch):
    fake = _FakeAdmin()
    test = _seed_test(fake)
    _patch_supabase_admin(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ListeningTestStatusPatchRequest(status="archived")
    out = _run(listening_router.admin_patch_listening_test_status(
        test_id=test["id"], body=body, authorization=authz,
    ))
    assert out["status"] == "archived"
