"""Sprint 11.1 — pin the Listening router contract (DEBT-LISTENING-
MODULE foundation 1/5).

Contracts under test:

  1. GET /api/listening/content/{id} happy path: published row returns
     full payload + a fresh audio_signed_url.
  2. GET 404 when the row is in draft status (admin-only visibility).
  3. GET 404 when the row doesn't exist.
  4. POST /admin/listening/upload happy path → source_type='upload_mp3',
     row INSERTed with status='draft', no external_license.
  5. POST /admin/listening/upload with external_license set →
     source_type='curated_external', license + source URL persisted.
  6. POST /admin/listening/upload: is_premium=true + NC license → 422
     (Sprint 11.0 §4E gate — license incompatible with paid tier).
  7. POST /admin/listening/upload: external_license without external_
     source_url → 422 (attribution-required gate).
  8. POST /admin/listening/render with LISTENING_AI_RENDER_ENABLED=
     false → 503 (feature flag still gates).
  9. POST /admin/listening/render with key + flag set → 202-ish
     ({"job_id", "status": "queued"}) and BackgroundTask scheduled
     exactly once with the right kwargs.
 10. Auth — admin routes 403 for non-admin auth.

Mock pattern: lightweight per-table query stub mirroring Sprint 10.4
_Builder. Storage mock provides .from_().upload() + .create_signed_url().
"""

from __future__ import annotations

import asyncio
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException, UploadFile

from routers import listening as listening_router


# ── Fake Supabase admin client (table + storage) ─────────────────────


class _FakeRes:
    def __init__(self, data):
        self.data = data
        self.count = None


class _FakeTableQuery:
    """Records SELECT predicates + INSERT payloads against the parent
    fake's per-table store. Supports the chain shapes the router uses:
        .table(t).select(...).eq(...).eq(...).limit(...).execute()
        .table(t).insert({...}).execute()
    """

    def __init__(self, parent, table_name: str):
        self._parent = parent
        self._table = table_name
        self._filters: list[tuple[str, object]] = []
        self._filters_neq: list[tuple[str, object]] = []
        self._insert: dict | None = None

    def select(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def neq(self, col, val):
        # Sprint 13.5.4 — convert/commit dup-check filters archived rows out.
        self._filters_neq.append((col, val))
        return self

    def insert(self, payload):
        self._insert = payload
        self._parent.inserts.append((self._table, payload))
        return self

    def execute(self):
        if self._insert is not None:
            return _FakeRes([self._insert])
        rows = self._parent.canned.get(self._table, [])
        for col, val in self._filters:
            rows = [r for r in rows if r.get(col) == val]
        for col, val in self._filters_neq:
            rows = [r for r in rows if r.get(col) != val]
        return _FakeRes(rows)


class _FakeStorageBucket:
    """Records upload() calls and serves create_signed_url() from a
    canned dict (so the GET happy path can yield a deterministic URL)."""

    def __init__(self, parent, bucket_name: str):
        self._parent = parent
        self._bucket = bucket_name

    def upload(self, path: str, data: bytes, headers: dict | None = None):
        if self._parent.upload_should_fail:
            raise RuntimeError("bucket not found")
        self._parent.uploads.append((self._bucket, path, len(data), headers))
        return {"path": path}

    def create_signed_url(self, path: str, ttl: int):
        return {
            "signedURL": f"https://storage.test/{self._bucket}/{path}?token=fake&ttl={ttl}"
        }


class _FakeStorage:
    def __init__(self, parent):
        self._parent = parent

    def from_(self, bucket_name: str):
        return _FakeStorageBucket(self._parent, bucket_name)


class _FakeAdminClient:
    def __init__(self, canned: dict | None = None,
                 *, upload_should_fail: bool = False):
        self.canned = canned or {}
        self.inserts: list[tuple] = []
        self.uploads: list[tuple] = []
        self.upload_should_fail = upload_should_fail
        self.storage = _FakeStorage(self)

    def table(self, name: str):
        return _FakeTableQuery(self, name)


# ── Auth shims ───────────────────────────────────────────────────────


def _patch_admin_auth(monkeypatch, user_id: str = "admin-1"):
    """Both require_admin (in routers.admin) AND the re-export in
    routers.listening must be patched so the route gate accepts the
    fake bearer token."""
    async def _fake_admin(_authz):
        return {"id": user_id, "email": "admin@example.com"}
    monkeypatch.setattr(listening_router, "require_admin", _fake_admin)
    return "Bearer fake-admin-jwt"


def _patch_user_auth(monkeypatch, user_id: str = "user-1"):
    async def _fake_user(_authz):
        return {"id": user_id}
    monkeypatch.setattr(listening_router, "get_supabase_user", _fake_user)
    return "Bearer fake-user-jwt"


def _patch_admin_client(monkeypatch, fake: _FakeAdminClient):
    """The router module imports supabase_admin via the
    `from database import supabase_admin` form, so the symbol lives on
    the listening module namespace."""
    monkeypatch.setattr(listening_router, "supabase_admin", fake)


def _run(coro):
    return asyncio.run(coro)


# ── GET /api/listening/content/{id} ──────────────────────────────────


def test_get_listening_content_happy_path(monkeypatch):
    canned = {
        "listening_content": [{
            "id": "c1",
            "status": "published",
            "audio_storage_path": "ai/c1.mp3",
            "title": "Section 1 booking",
            "transcript": "Hello.",
        }],
    }
    fake = _FakeAdminClient(canned)
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_user_auth(monkeypatch)

    out = _run(listening_router.get_listening_content(
        content_id="c1", authorization=authz,
    ))
    assert out["id"] == "c1"
    assert out["title"] == "Section 1 booking"
    # Signed URL appended.
    assert "audio_signed_url" in out
    assert "storage.test/listening-audio/ai/c1.mp3" in out["audio_signed_url"]
    assert "ttl=3600" in out["audio_signed_url"]


def test_get_listening_content_404_for_draft(monkeypatch):
    canned = {
        "listening_content": [{
            "id": "c1",
            "status": "draft",  # admin-only — not visible to user route
            "audio_storage_path": "ai/c1.mp3",
            "title": "WIP",
            "transcript": "x",
        }],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user_auth(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.get_listening_content(
            content_id="c1", authorization=authz,
        ))
    assert exc.value.status_code == 404


def test_get_listening_content_404_for_missing_id(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient({"listening_content": []}))
    authz = _patch_user_auth(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.get_listening_content(
            content_id="nope", authorization=authz,
        ))
    assert exc.value.status_code == 404


# ── POST /admin/listening/upload ─────────────────────────────────────


def _fake_upload_file(content: bytes | None = None) -> UploadFile:
    """Build a minimal UploadFile shim. FastAPI's UploadFile.read() is
    async; passing a BytesIO via SpooledTemporaryFile is the canonical
    way but a MagicMock with an async read is simpler for unit tests.

    Sprint 13.2: default body is a 60 KB pad prefixed with the ID3 magic
    so the new listening_validator service passes (size ≥ 50 KB +
    MP3 signature present). Tests that need to exercise validation
    failure can pass a smaller `content` explicitly.
    """
    if content is None:
        content = b"ID3" + b"\x00" * (60 * 1024)
    f = MagicMock(spec=UploadFile)

    async def _read():
        return content

    f.read = _read
    return f


def test_admin_upload_happy_path_upload_mp3(monkeypatch):
    """No external_license → source_type='upload_mp3'.

    Note: FastAPI's Form(default=...) sentinel is truthy when the
    handler is called directly (vs through FastAPI's request parser),
    so the tests pass every Form-decorated param explicitly to avoid
    accidentally hitting an Optional branch with a Form() instance."""
    fake = _FakeAdminClient(canned={})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    out = _run(listening_router.admin_upload_listening(
        audio_file=_fake_upload_file(),
        title="Section 2 hobby monologue",
        transcript=(
            "I like reading novels and watching documentaries every weekend "
            "because it helps me relax."
        ),
        accent_tag="uk_rp",
        cefr_level="B2",
        ielts_section=2,
        external_license=None,
        external_source_url=None,
        topic_tags=None,
        is_premium=False,
        authorization=authz,
    ))
    assert out["ok"] is True
    assert out["source_type"] == "upload_mp3"
    assert out["status"] == "draft"

    # Bucket upload happened on the right bucket + a sane storage path.
    assert len(fake.uploads) == 1
    bucket, path, size, headers = fake.uploads[0]
    assert bucket == "listening-audio"
    assert path.startswith("uploads/") and path.endswith(".mp3")
    assert headers == {"content-type": "audio/mpeg"}

    # Row INSERT carries the right shape.
    assert len(fake.inserts) == 1
    table, payload = fake.inserts[0]
    assert table == "listening_content"
    assert payload["source_type"] == "upload_mp3"
    assert payload["external_license"] is None
    assert payload["external_source_url"] is None
    assert payload["accent_tag"] == "uk_rp"
    assert payload["ielts_section"] == 2
    assert payload["status"] == "draft"
    assert payload["is_premium"] is False
    assert payload["created_by"] == "admin-1"


def test_admin_upload_with_external_license_classifies_as_curated(monkeypatch):
    fake = _FakeAdminClient(canned={})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    out = _run(listening_router.admin_upload_listening(
        audio_file=_fake_upload_file(),
        title="BBC 6 Minute English — Sleep",
        transcript=(
            "Sleep researchers say adults should aim for seven to nine "
            "hours per night to feel rested."
        ),
        accent_tag="uk_rp",
        cefr_level="B2",
        ielts_section=3,
        external_license="CC BY-NC-ND 4.0",
        external_source_url="https://www.bbc.co.uk/learningenglish/...",
        topic_tags="health,sleep",
        is_premium=False,
        authorization=authz,
    ))
    assert out["source_type"] == "curated_external"

    _, payload = fake.inserts[0]
    assert payload["external_license"] == "CC BY-NC-ND 4.0"
    assert payload["external_source_url"].startswith("https://www.bbc.co.uk/")
    # Storage path lands under 'curated/' subdir (vs 'uploads/').
    assert payload["audio_storage_path"].startswith("curated/")
    # topic_tags comma-split + trimmed.
    assert payload["topic_tags"] == ["health", "sleep"]


def test_admin_upload_premium_plus_nc_license_blocked(monkeypatch):
    """Sprint 11.0 §4E hard gate — premium + non-commercial license
    is a license-compliance violation. Router rejects with 422."""
    fake = _FakeAdminClient(canned={})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upload_listening(
            audio_file=_fake_upload_file(),
            title="...",
            transcript="...",
            accent_tag="uk_rp",
            cefr_level="B2",
            ielts_section=1,
            external_license="CC BY-NC-ND 4.0",
            external_source_url="https://example.com",
            topic_tags=None,
            is_premium=True,
            authorization=authz,
        ))
    assert exc.value.status_code == 422
    assert "non-commercial" in str(exc.value.detail).lower() or "NC" in str(exc.value.detail)

    # Neither bucket upload nor DB INSERT must have fired.
    assert fake.uploads == []
    assert fake.inserts == []


def test_admin_upload_external_license_without_source_url_blocked(monkeypatch):
    """Attribution-required gate (Sprint 11.0 §4)."""
    fake = _FakeAdminClient(canned={})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upload_listening(
            audio_file=_fake_upload_file(),
            title="...",
            transcript="...",
            accent_tag="us_general",
            cefr_level="B2",
            ielts_section=1,
            external_license="CC BY 4.0",
            external_source_url=None,
            topic_tags=None,
            is_premium=False,
            authorization=authz,
        ))
    assert exc.value.status_code == 422
    assert "external_source_url" in str(exc.value.detail)
    assert fake.uploads == []
    assert fake.inserts == []


# ── POST /admin/listening/render (feature-flag gated) ────────────────


def test_admin_render_503_when_feature_flag_off(monkeypatch):
    """Sprint 11.1 ships the endpoint behind a feature flag. With
    LISTENING_AI_RENDER_ENABLED=false the route gates with 503 even
    when an API key is set."""
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)
    monkeypatch.setattr(listening_router.settings, "LISTENING_AI_RENDER_ENABLED", False)
    monkeypatch.setattr(listening_router.settings, "ELEVENLABS_API_KEY", "sk_test")

    body = listening_router.ListeningRenderRequest(
        # Sprint 13.3 added a 100-char floor on script_text to block
        # waste of ElevenLabs credits on accidental test renders.
        script_text=(
            "The exhibition opens on Saturday at the new convention "
            "centre downtown, and admission will be free throughout "
            "the weekend for residents and visitors alike."
        ),
        voice_id="EXAVITQu4vr4xnSDxMaL",
        model="eleven_multilingual_v2",
        title="Section 1 booking",
        accent_tag="us_general",
    )
    bg = MagicMock()
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_render_listening(
            body=body, background_tasks=bg, authorization=authz,
        ))
    assert exc.value.status_code == 503
    # No background task scheduled.
    assert bg.add_task.call_count == 0


def test_admin_render_503_when_api_key_missing(monkeypatch):
    """Flag-on + key-missing → still 503 (defense in depth)."""
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)
    monkeypatch.setattr(listening_router.settings, "LISTENING_AI_RENDER_ENABLED", True)
    monkeypatch.setattr(listening_router.settings, "ELEVENLABS_API_KEY", "")

    body = listening_router.ListeningRenderRequest(
        # Sprint 13.3 added a 100-char floor on script_text to block
        # waste of ElevenLabs credits on accidental test renders.
        script_text=(
            "The exhibition opens on Saturday at the new convention "
            "centre downtown, and admission will be free throughout "
            "the weekend for residents and visitors alike."
        ),
        voice_id="EXAVITQu4vr4xnSDxMaL",
        model="eleven_multilingual_v2",
        title="Section 1 booking",
        accent_tag="us_general",
    )
    bg = MagicMock()
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_render_listening(
            body=body, background_tasks=bg, authorization=authz,
        ))
    assert exc.value.status_code == 503
    assert bg.add_task.call_count == 0


def test_admin_render_schedules_background_task_when_enabled(monkeypatch):
    """Flag + key both set → 202-ish, BackgroundTask scheduled exactly
    once with the right kwargs."""
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)
    monkeypatch.setattr(listening_router.settings, "LISTENING_AI_RENDER_ENABLED", True)
    monkeypatch.setattr(listening_router.settings, "ELEVENLABS_API_KEY", "sk_test")

    body = listening_router.ListeningRenderRequest(
        # Sprint 13.3 added a 100-char floor on script_text to block
        # waste of ElevenLabs credits on accidental test renders.
        script_text=(
            "The exhibition opens on Saturday at the new convention "
            "centre downtown, and admission will be free throughout "
            "the weekend for residents and visitors alike."
        ),
        voice_id="EXAVITQu4vr4xnSDxMaL",
        model="eleven_multilingual_v2",
        title="Section 1 booking",
        accent_tag="us_general",
        cefr_level="B2",
        ielts_section=1,
        topic_tags=["travel", "booking"],
    )
    bg = MagicMock()
    out = _run(listening_router.admin_render_listening(
        body=body, background_tasks=bg, authorization=authz,
    ))
    # Sprint 13.3.1 — status was 'queued'; now 'rendering' because the
    # placeholder row is INSERTed synchronously and only the audio
    # production is asynchronous.
    assert out["status"] == "rendering"
    assert "job_id" in out and out["job_id"]
    # Exactly one task queued.
    assert bg.add_task.call_count == 1
    _args, kwargs = bg.add_task.call_args
    assert kwargs["voice_id"] == "EXAVITQu4vr4xnSDxMaL"
    assert kwargs["model"] == "eleven_multilingual_v2"
    assert kwargs["script_text"].startswith("The exhibition opens")
    assert kwargs["title"] == "Section 1 booking"
    assert kwargs["accent_tag"] == "us_general"
    assert kwargs["topic_tags"] == ["travel", "booking"]
    assert kwargs["created_by_user_id"] == "admin-1"


def test_admin_render_rejects_unknown_model(monkeypatch):
    """Validation gate — only the 2 ElevenLabs models in the allowlist."""
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)
    monkeypatch.setattr(listening_router.settings, "LISTENING_AI_RENDER_ENABLED", True)
    monkeypatch.setattr(listening_router.settings, "ELEVENLABS_API_KEY", "sk_test")

    body = listening_router.ListeningRenderRequest(
        # Sprint 13.3 added a 100-char floor on script_text to block
        # waste of ElevenLabs credits on accidental test renders.
        script_text=(
            "The exhibition opens on Saturday at the new convention "
            "centre downtown, and admission will be free throughout "
            "the weekend for residents and visitors alike."
        ),
        voice_id="EXAVITQu4vr4xnSDxMaL",
        model="gpt-4o",  # not an ElevenLabs model
        title="x",
        accent_tag="us_general",
    )
    bg = MagicMock()
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_render_listening(
            body=body, background_tasks=bg, authorization=authz,
        ))
    assert exc.value.status_code == 422
    assert bg.add_task.call_count == 0
