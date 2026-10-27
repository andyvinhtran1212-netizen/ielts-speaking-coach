"""Private `writing-images` bucket: path storage + sign-on-read (B10).

Covers ref resolution, signing (batch, failure, reuse cache), the routes that
persist/emit Task 1 chart refs, the grader's server-side fetch and the
path backfill planner.
"""
from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from config import settings
from services import writing_image_access as wia

ORIGIN = settings.SUPABASE_URL.rstrip("/")
PATH = "prompts/0b7f-1700000000.png"
PUBLIC_URL = f"{ORIGIN}/storage/v1/object/public/writing-images/{PATH}"
SIGNED_URL = f"{ORIGIN}/storage/v1/object/sign/writing-images/{PATH}?token=abc"
FOREIGN_URL = "https://nqhrtqspznepmveyurzm.supabase.co/storage/v1/object/public/writing-images/x.png"


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Bucket:
    def __init__(self, fail=False, omit=()):
        self.calls = []
        self.fail = fail
        self.omit = set(omit)

    def create_signed_urls(self, paths, ttl):
        self.calls.append((list(paths), ttl))
        if self.fail:
            raise RuntimeError("storage down token=SECRET")
        return [
            {"path": p, "error": None,
             "signedURL": f"{ORIGIN}/storage/v1/object/sign/writing-images/{p}?token=t{len(self.calls)}"}
            for p in paths if p not in self.omit
        ]


@pytest.fixture
def bucket(monkeypatch):
    b = _Bucket()
    client = MagicMock()
    client.storage.from_.return_value = b
    import database
    monkeypatch.setattr(database, "supabase_admin", client)
    wia._cache.clear()
    yield b
    wia._cache.clear()


# ── ref resolution ────────────────────────────────────────────────────

@pytest.mark.parametrize("ref,expected", [
    (PATH, PATH),
    (PUBLIC_URL, PATH),
    (SIGNED_URL, PATH),
    (f"{ORIGIN}/storage/v1/object/authenticated/writing-images/{PATH}", PATH),
    (f"{ORIGIN}/storage/v1/object/public/audio-responses/{PATH}", None),   # other bucket
    (FOREIGN_URL, None),                                                   # other project
    (PUBLIC_URL.replace("https://", "http://"), None),
    (f"{ORIGIN}/storage/v1/object/public/writing-images/prompts/..%2F..%2Fx", None),
    ("prompts/../secret.png", None),
    ("", None),
    (None, None),
])
def test_image_path(ref, expected):
    assert wia.image_path(ref) == expected


def test_canonical_ref_stores_path_for_our_bucket_and_keeps_foreign_urls():
    assert wia.canonical_image_ref(SIGNED_URL) == PATH
    assert wia.canonical_image_ref(f"  {PUBLIC_URL} ") == PATH
    assert wia.canonical_image_ref(FOREIGN_URL) == FOREIGN_URL
    assert wia.canonical_image_ref("") is None
    assert wia.canonical_image_ref(None) is None


# ── signing ───────────────────────────────────────────────────────────

def test_attach_signs_paths_and_legacy_public_urls_never_echoing_them(bucket):
    rows = [{"prompt_image_url": PATH}, {"prompt_image_url": PUBLIC_URL},
            {"prompt_image_url": FOREIGN_URL}, {"prompt_image_url": None}, None]
    assert wia.attach_signed_image_urls(rows) is True
    assert "/object/sign/writing-images/" in rows[0]["prompt_image_url"]
    assert rows[1]["prompt_image_url"] == rows[0]["prompt_image_url"]
    assert "/object/public/" not in rows[1]["prompt_image_url"]
    assert rows[2]["prompt_image_url"] == FOREIGN_URL
    assert rows[3]["prompt_image_url"] is None
    assert bucket.calls == [([PATH], wia.VIEW_TTL)]       # one deduped batch
    assert not any(r and r.get("prompt_image_lookup_failed") for r in rows)


def test_signing_failure_masks_the_stored_url_and_flags_the_row(bucket, caplog):
    bucket.fail = True
    rows = [{"prompt_image_url": PUBLIC_URL}]
    assert wia.attach_signed_image_urls(rows) is False
    assert rows[0]["prompt_image_url"] is None
    assert rows[0]["prompt_image_lookup_failed"] is True
    assert "SECRET" not in caplog.text


def test_missing_object_flags_only_that_row(bucket):
    bucket.omit = {"prompts/gone.png"}
    rows = [{"prompt_image_url": PATH}, {"prompt_image_url": "prompts/gone.png"}]
    wia.attach_signed_image_urls(rows)
    assert rows[0]["prompt_image_url"] and not rows[0].get("prompt_image_lookup_failed")
    assert rows[1]["prompt_image_url"] is None and rows[1]["prompt_image_lookup_failed"]


def test_unresolvable_url_on_our_storage_origin_is_not_echoed(bucket):
    rows = [{"prompt_image_url": f"{ORIGIN}/storage/v1/object/public/writing-images/a/../b"}]
    wia.attach_signed_image_urls(rows)
    assert rows[0]["prompt_image_url"] is None
    assert rows[0]["prompt_image_lookup_failed"] is True


def test_signed_url_is_reused_so_polling_keeps_a_stable_src(bucket):
    first = [{"prompt_image_url": PATH}]
    second = [{"prompt_image_url": PATH}]
    wia.attach_signed_image_urls(first)
    wia.attach_signed_image_urls(second)
    assert first[0]["prompt_image_url"] == second[0]["prompt_image_url"]
    assert len(bucket.calls) == 1


def test_fetchable_url_signs_briefly_and_passes_foreign_urls(bucket):
    assert "/object/sign/" in wia.fetchable_image_url(PUBLIC_URL)
    assert bucket.calls[-1][1] == wia.FETCH_TTL
    assert wia.fetchable_image_url(FOREIGN_URL) == FOREIGN_URL
    assert wia.fetchable_image_url("javascript:alert(1)") is None


# ── prompt bank (public list, signed only for an active signed-in user) ──

class _Q:
    def __init__(self, data): self._data = data
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def order(self, *a, **k): return self
    def execute(self): return type("R", (), {"data": self._data})()


class _DB:
    def __init__(self, data): self._data = data
    def table(self, _n): return _Q(self._data)


class _Req:
    headers: dict = {}


_BANK_ROWS = [{"id": "p1", "title": "Chart", "prompt_text": "Describe.", "task_type": "task1_academic",
               "difficulty": None, "prompt_image_url": PUBLIC_URL, "updated_at": "2026-10-01T00:00:00Z"}]


def _bank(monkeypatch, *, user=None, active=True, authorization="Bearer tok"):
    from routers import writing_student as ws
    monkeypatch.setattr(ws.settings, "WRITING_PROMPT_BANK_ENABLED", True)
    monkeypatch.setattr(ws, "supabase_admin", _DB([dict(r) for r in _BANK_ROWS]))
    monkeypatch.setattr(ws, "get_supabase_user", AsyncMock(return_value=user or {"id": "u1"}))
    monkeypatch.setattr(ws.activation_gate, "account_is_active", lambda _uid: active)
    resp = _run(ws.get_prompt_bank(_Req(), task_type=None, authorization=authorization))
    return resp, json.loads(resp.body)


def test_prompt_bank_signs_for_active_signed_in_user_without_caching(monkeypatch, bucket):
    resp, body = _bank(monkeypatch)
    p = body["prompts"][0]
    assert p["has_prompt_image"] is True
    assert "/object/sign/writing-images/" in p["prompt_image_url"]
    assert resp.headers["cache-control"] == "private, no-store"
    assert resp.headers["vary"] == "Authorization"


@pytest.mark.parametrize("kwargs", [{"authorization": None}, {"active": False}])
def test_prompt_bank_anonymous_or_inactive_gets_no_url(monkeypatch, bucket, kwargs):
    resp, body = _bank(monkeypatch, **kwargs)
    p = body["prompts"][0]
    assert p["has_prompt_image"] is True and p["prompt_image_url"] is None
    assert resp.headers["cache-control"].startswith("public")
    assert resp.headers["vary"] == "Authorization"
    assert bucket.calls == []


# ── admin writes persist the object path ──────────────────────────────

def _admin_client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers import admin_writing_prompts
    app = FastAPI()
    app.include_router(admin_writing_prompts.router)
    return TestClient(app)


def test_admin_create_stores_path_from_signed_preview_url_and_returns_signed(bucket):
    mock_db = MagicMock()
    mock_db.table.return_value.insert.return_value.execute.side_effect = (
        lambda: MagicMock(data=[{"id": "p1", **mock_db.table.return_value.insert.call_args[0][0]}]))
    body = {"task_type": "task1_academic", "title": "Energy",
            "prompt_text": "The chart below shows energy use in detail.",
            "prompt_image_url": SIGNED_URL + "x" * 600,   # real signed URLs exceed 500 chars
            "prompt_image_public_id": PATH}
    with patch("routers.admin_writing_prompts.require_admin", new=AsyncMock(return_value={"id": "a"})), \
         patch("routers.admin_writing_prompts.supabase_admin", mock_db), \
         patch("services.writing_prompt_analysis.mark_analysis_pending", return_value=None):
        r = _admin_client().post("/admin/writing/prompts", json=body, headers={"Authorization": "Bearer x"})
    assert r.status_code == 201, r.text
    sent = mock_db.table.return_value.insert.call_args[0][0]
    assert sent["prompt_image_url"] == PATH
    assert "/object/sign/" in r.json()["prompt_image_url"]


def test_admin_patch_echoing_signed_url_of_legacy_row_is_not_an_image_change(bucket):
    current = {"id": "p1", "task_type": "task1_academic", "prompt_image_url": PUBLIC_URL,
               "prompt_image_public_id": PATH, "prompt_image_analysis_public_id": PATH}
    mock_db = MagicMock()
    q = mock_db.table.return_value
    q.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[current])
    q.update.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value = (
        MagicMock(data=[{**current, "prompt_image_url": PATH}]))
    with patch("routers.admin_writing_prompts.require_admin", new=AsyncMock(return_value={"id": "a"})), \
         patch("routers.admin_writing_prompts.supabase_admin", mock_db):
        r = _admin_client().patch(
            "/admin/writing/prompts/00000000-0000-0000-0000-000000000001",
            json={"title": "Renamed", "prompt_image_url": SIGNED_URL, "prompt_image_public_id": PATH},
            headers={"Authorization": "Bearer x"})
    assert r.status_code == 200, r.text
    sent = q.update.call_args[0][0]
    assert sent["prompt_image_url"] == PATH
    assert "prompt_image_analysis" not in sent          # reviewed answer key kept
    assert "/object/sign/" in r.json()["prompt_image_url"]


def test_essay_row_snapshot_persists_path(monkeypatch):
    from services import essay_service
    captured = {}
    db = MagicMock()
    db.table.return_value.insert.side_effect = lambda payload: captured.update(payload) or MagicMock(
        execute=lambda: MagicMock(data=[{"id": "e1"}]))
    monkeypatch.setattr(essay_service, "supabase_admin", db)
    monkeypatch.setattr(essay_service, "_ensure_student_exists", lambda _sid: None)
    out = essay_service.create_essay_row_only(data={
        "student_id": "s1", "task_type": "task1_academic", "prompt_text": "p",
        "essay_text": "e", "analysis_level": 3, "prompt_image_url": SIGNED_URL,
    }, admin_id="a")
    assert out["essay_id"] == "e1"
    assert captured["prompt_image_url"] == PATH


# ── grader fetch ──────────────────────────────────────────────────────

def test_grader_fetch_signs_private_ref_and_never_logs_the_token(bucket, caplog):
    from services.gemini_writing_grader import GeminiWritingGrader

    seen = {}

    class _Resp:
        status_code = 200
        content = b"\x89PNG\r\n\x1a\n" + b"0" * 200
        headers = {"content-type": "image/png"}

    class _Client:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url):
            seen["url"] = url
            return _Resp()

    grader = GeminiWritingGrader.__new__(GeminiWritingGrader)
    with patch("services.gemini_writing_grader.httpx.AsyncClient", _Client):
        got = _run(grader._fetch_image_bytes(PATH))
    assert got and got[1] == "image/png"
    assert "/object/sign/writing-images/" in seen["url"]

    bucket.fail = True
    wia._cache.clear()
    with patch("services.gemini_writing_grader.httpx.AsyncClient", _Client):
        assert _run(grader._fetch_image_bytes("prompts/other.png")) is None
    assert "token=" not in caplog.text


# ── backfill planner ──────────────────────────────────────────────────

def test_backfill_plan_converts_only_our_bucket_urls():
    from scripts.backfill_writing_image_paths import build_plan, project_ref
    plan = build_plan(
        prompts=[
            {"id": "p1", "prompt_image_url": PUBLIC_URL, "prompt_image_public_id": PATH},
            {"id": "p2", "prompt_image_url": PATH, "prompt_image_public_id": PATH},
            {"id": "p3", "prompt_image_url": PUBLIC_URL, "prompt_image_public_id": "prompts/other.png"},
            {"id": "p4", "prompt_image_url": FOREIGN_URL, "prompt_image_public_id": "x"},
        ],
        essays=[
            {"id": "e1", "prompt_image_url": SIGNED_URL},
            {"id": "e2", "prompt_image_url": "prompts/../x"},
        ],
    )
    assert [(t, i, n) for t, i, _o, n in plan["convert"]] == [
        ("writing_prompts", "p1", PATH), ("writing_essays", "e1", PATH)]
    assert [i for _t, i, _o, _n in plan["path"]] == ["p2"]
    assert [i for _t, i, _o, _n in plan["mismatch"]] == ["p3"]
    assert [i for _t, i, _o, _n in plan["external"]] == ["p4"]
    assert [i for _t, i, _o, _n in plan["invalid"]] == ["e2"]
    assert project_ref("https://zjphffoujxkpltixsbzj.supabase.co") == "zjphffoujxkpltixsbzj"


@pytest.mark.parametrize("argv,url", [
    (["--execute"], "https://zjphffoujxkpltixsbzj.supabase.co"),
    (["--execute", "--project-ref", "other"], "https://zjphffoujxkpltixsbzj.supabase.co"),
    (["--execute", "--project-ref", "huwsmtubwulikhlmcirx"], "https://huwsmtubwulikhlmcirx.supabase.co"),
])
def test_backfill_execute_guards_refuse_before_any_read(monkeypatch, argv, url):
    from scripts import backfill_writing_image_paths as bf
    import database
    db = MagicMock()
    monkeypatch.setattr(database, "supabase_admin", db)
    monkeypatch.setattr(settings, "SUPABASE_URL", url)
    assert bf.main(argv) == 2
    db.table.assert_not_called()
