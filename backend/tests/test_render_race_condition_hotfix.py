"""Tests for Sprint 13.3.1 — render race-condition hotfix.

Pinned contracts:
  - POST /admin/listening/render INSERTs a placeholder row
    synchronously (audio_storage_path=NULL, duration=0, size=0,
    status='draft') BEFORE the BackgroundTask is scheduled.
  - The returned content_id IS the placeholder row's id (job_id).
  - The BackgroundTask UPDATEs that row in place when the render
    completes (instead of INSERTing a fresh row).
  - On render failure (ElevenLabs error / bucket upload error), the
    placeholder row is flipped to status='archived' so the frontend
    can detect + surface a failed banner.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from routers import listening as listening_router
from services import listening_renderer
from tests.test_listening_router import (
    _FakeAdminClient,
    _FakeTableQuery,
    _patch_admin_auth,
    _patch_admin_client,
    _run,
)


_GOOD_SCRIPT = (
    "The exhibition opens on Saturday at the new convention "
    "centre downtown, and admission will be free throughout "
    "the weekend for residents and visitors alike."
)


def _build_body(**overrides) -> "listening_router.ListeningRenderRequest":
    defaults = dict(
        script_text=_GOOD_SCRIPT,
        voice_id="EXAVITQu4vr4xnSDxMaL",
        model="eleven_multilingual_v2",
        title="Section 1 booking",
        accent_tag="us_general",
        cefr_level="B2",
        ielts_section=1,
        topic_tags=["travel"],
    )
    defaults.update(overrides)
    return listening_router.ListeningRenderRequest(**defaults)


# ── Placeholder INSERT is synchronous ────────────────────────────────────────


def test_render_inserts_placeholder_row_synchronously(monkeypatch):
    fake = _FakeAdminClient()
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    monkeypatch.setattr(listening_router.settings, "LISTENING_AI_RENDER_ENABLED", True)
    monkeypatch.setattr(listening_router.settings, "ELEVENLABS_API_KEY", "sk_test")

    bg = MagicMock()
    out = _run(listening_router.admin_render_listening(
        body=_build_body(), background_tasks=bg, authorization=authz,
    ))
    # 1 INSERT must have happened by the time the response returns
    # (before any BackgroundTask runs).
    assert len(fake.inserts) == 1, "router must INSERT placeholder synchronously"
    table, payload = fake.inserts[0]
    assert table == "listening_content"
    # Placeholder shape — Sprint 13.3.1 canonical sentinels.
    assert payload["id"] == out["content_id"]
    assert payload["audio_storage_path"] is None
    assert payload["audio_duration_seconds"] == 0
    assert payload["audio_size_bytes"] == 0
    assert payload["status"] == "draft"
    assert payload["source_type"] == "ai_elevenlabs"
    # Metadata flowed through from the body.
    assert payload["title"] == "Section 1 booking"
    assert payload["accent_tag"] == "us_general"
    assert payload["elevenlabs_voice_id"] == "EXAVITQu4vr4xnSDxMaL"
    # BackgroundTask still scheduled exactly once.
    assert bg.add_task.call_count == 1


def test_returned_content_id_matches_placeholder_row(monkeypatch):
    fake = _FakeAdminClient()
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    monkeypatch.setattr(listening_router.settings, "LISTENING_AI_RENDER_ENABLED", True)
    monkeypatch.setattr(listening_router.settings, "ELEVENLABS_API_KEY", "sk_test")

    bg = MagicMock()
    out = _run(listening_router.admin_render_listening(
        body=_build_body(), background_tasks=bg, authorization=authz,
    ))
    placeholder_id = fake.inserts[0][1]["id"]
    assert out["content_id"] == placeholder_id
    assert out["job_id"]     == placeholder_id
    assert out["status"]     == "rendering"


def test_get_content_immediately_after_render_returns_placeholder(monkeypatch):
    # Simulate the Andy-dogfood race: render is fired, then the page
    # GETs /content/{id} *before* the BackgroundTask runs. The
    # placeholder must be visible (no 404).
    fake = _FakeAdminClient()
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    monkeypatch.setattr(listening_router.settings, "LISTENING_AI_RENDER_ENABLED", True)
    monkeypatch.setattr(listening_router.settings, "ELEVENLABS_API_KEY", "sk_test")

    bg = MagicMock()
    out = _run(listening_router.admin_render_listening(
        body=_build_body(), background_tasks=bg, authorization=authz,
    ))
    placeholder_id = out["content_id"]

    # Seed the row into the fake client's canned table so the GET can
    # find it (the fake doesn't share INSERTs with selects automatically).
    fake.canned["listening_content"] = [fake.inserts[0][1]]

    # Bypass storage signed-url path (placeholder has audio_storage_path=None).
    with patch.object(listening_router, "supabase_admin", fake):
        row = _run(listening_router.admin_get_listening_content(
            content_id=placeholder_id, authorization=authz,
        ))
    assert row["id"] == placeholder_id
    assert row["audio_storage_path"] is None
    assert row["status"] == "draft"


# ── BackgroundTask UPDATEs the placeholder ──────────────────────────────────


class _Resp:
    def __init__(self, data):
        self.data = data


class _UpdateRecorderQuery:
    """Minimal Supabase-table fake that records both INSERT and UPDATE
    calls. The Sprint 13.3.1 BackgroundTask only uses .update().eq().
    .execute(), so this is sufficient for the hotfix assertions.
    """
    def __init__(self, parent, name):
        self._parent = parent
        self._table = name
        self._mode = "select"
        self._update_payload = None
        self._insert_payload = None
        self._filters: list[tuple[str, object]] = []

    def select(self, *_a, **_kw):
        self._mode = "select"
        return self

    def update(self, payload):
        self._mode = "update"
        self._update_payload = payload
        return self

    def insert(self, payload):
        self._mode = "insert"
        self._insert_payload = payload
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def limit(self, *_a, **_kw):
        return self

    def execute(self):
        if self._mode == "update":
            self._parent.updates.append((
                self._table, self._update_payload, list(self._filters),
            ))
            return _Resp([self._update_payload])
        if self._mode == "insert":
            self._parent.inserts.append((self._table, self._insert_payload))
            return _Resp([self._insert_payload])
        return _Resp([])


class _FakeAdminClientWithUpdate:
    def __init__(self):
        self.inserts: list[tuple] = []
        self.updates: list[tuple] = []

    def table(self, name: str):
        return _UpdateRecorderQuery(self, name)


def test_background_task_updates_placeholder_on_success(monkeypatch):
    fake = _FakeAdminClientWithUpdate()
    monkeypatch.setattr(listening_renderer, "supabase_admin", fake)
    monkeypatch.setattr(
        listening_renderer,
        "_call_with_retry",
        lambda fn, **_kw: (b"\x00" * 32_000, {"characters": ["a"]}),
    )
    # Storage upload is patched to a no-op.
    storage_mock = MagicMock()
    storage_mock.from_.return_value.upload.return_value = {"path": "ok"}
    monkeypatch.setattr(listening_renderer.supabase_admin, "storage", storage_mock,
                        raising=False)

    listening_renderer.run_elevenlabs_render_job(
        job_id="content-1",
        script_text=_GOOD_SCRIPT,
        voice_id="vid", model="eleven_multilingual_v2", title="t",
        accent_tag="us_general", cefr_level="B2", ielts_section=1,
        topic_tags=[], transcript=None, created_by_user_id="admin-1",
    )

    # Should record exactly one UPDATE flipping status='draft' +
    # populating audio_storage_path.
    successes = [u for u in fake.updates if "audio_storage_path" in u[1]]
    assert len(successes) == 1
    table, payload, filters = successes[0]
    assert table == "listening_content"
    assert payload["audio_storage_path"] == "ai/content-1.mp3"
    assert payload["audio_size_bytes"] > 0
    assert payload["audio_duration_seconds"] >= 1
    assert ("id", "content-1") in filters


def test_background_task_marks_archived_on_render_failure(monkeypatch):
    fake = _FakeAdminClientWithUpdate()
    monkeypatch.setattr(listening_renderer, "supabase_admin", fake)

    def _boom(*_a, **_kw):
        raise RuntimeError("ElevenLabs 503 — quota exceeded")

    monkeypatch.setattr(listening_renderer, "_call_with_retry", _boom)

    listening_renderer.run_elevenlabs_render_job(
        job_id="content-2",
        script_text=_GOOD_SCRIPT,
        voice_id="vid", model="eleven_multilingual_v2", title="t",
        accent_tag="us_general", cefr_level="B2", ielts_section=1,
        topic_tags=[], transcript=None, created_by_user_id="admin-1",
    )

    archived = [u for u in fake.updates if u[1].get("status") == "archived"]
    assert len(archived) == 1
    _, payload, filters = archived[0]
    assert payload["status"] == "archived"
    assert ("id", "content-2") in filters
