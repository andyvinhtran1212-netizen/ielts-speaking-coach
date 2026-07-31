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
    def order(self, *_a, **_k): return self

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
        self.table_calls: list[str] = []
        self.upload_should_fail = upload_should_fail
        self.storage = _FakeStorage(self)

    def table(self, name: str):
        self.table_calls.append(name)
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


def test_boot_listening_dictation_combines_content_and_exercises(monkeypatch):
    canned = {
        "listening_content": [{
            "id": "c1",
            "status": "published",
            "audio_storage_path": "ai/c1.mp3",
            "title": "Section 1 booking",
            "transcript": "Full transcript",
        }],
        "listening_exercises": [{
            "id": "ex1",
            "content_id": "c1",
            "exercise_type": "dictation",
            "status": "published",
            "order_num": 1,
            "segments": [{"idx": 0, "transcript": "Full transcript"}],
        }],
        # Boot does not expose user attempt/progress state; attempts stay POST-only.
        "listening_attempts": [{
            "id": "attempt-other",
            "user_id": "other-user",
            "exercise_id": "ex1",
        }],
    }
    fake = _FakeAdminClient(canned)
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_user_auth(monkeypatch)

    out = _run(listening_router.boot_listening_dictation(
        content_id="c1", authorization=authz,
    ))

    assert out["content"]["id"] == "c1"
    assert out["content"]["audio_signed_url"].startswith("https://storage.test/")
    assert out["exercises"][0]["id"] == "ex1"
    assert out["exercises"][0]["segments"][0]["transcript"] == "Full transcript"
    assert "attempts" not in out
    assert "listening_attempts" not in fake.table_calls


def test_boot_listening_dictation_requires_auth(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient({"listening_content": []}))

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.boot_listening_dictation(
            content_id="c1", authorization=None,
        ))
    assert exc.value.status_code == 401


def test_boot_listening_dictation_404_for_draft(monkeypatch):
    canned = {
        "listening_content": [{
            "id": "c1",
            "status": "draft",
            "audio_storage_path": "ai/c1.mp3",
            "title": "WIP",
            "transcript": "x",
        }],
        "listening_exercises": [{
            "id": "ex1",
            "content_id": "c1",
            "exercise_type": "dictation",
            "status": "published",
            "segments": [{"idx": 0, "transcript": "x"}],
        }],
    }
    fake = _FakeAdminClient(canned)
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_user_auth(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.boot_listening_dictation(
            content_id="c1", authorization=authz,
        ))
    assert exc.value.status_code == 404
    assert "listening_exercises" not in fake.table_calls
