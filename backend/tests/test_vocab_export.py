"""
Tests for GET /api/vocabulary/bank/export.

Pattern follows test_health.py and test_admin_flashcard_stats.py: stub
the user-scoped Supabase client so we can simulate query results without
any network or DB.

The export endpoint pulls auth (`_require_auth`) before resolving the
user-scoped client (`_user_sb`), so we patch both — `_require_auth` to
return a fake auth_user, `_user_sb` to return our stub client.
"""

import asyncio
import csv
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from routers import vocabulary_bank as vb


def _run(coro):
    """Fresh loop per call — TestClient closes the shared one mid-suite."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Stub Supabase client ─────────────────────────────────────────────────────


class _StubBuilder:
    def __init__(self, data):
        self._data = data

    def select(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self
    # PR-A: export query now also filters is_skipped, so the stub has to
    # respond to .eq().  Filter is opaque here — tests pass already-curated
    # row sets in `data`, so we don't simulate column predicates.
    def eq(self, *_a, **_k): return self

    def execute(self):
        class _R:
            pass
        r = _R()
        r.data = list(self._data) if self._data else []
        r.count = None
        return r


class _StubClient:
    def __init__(self, data):
        self._data = data
    def table(self, *_a, **_k):
        return _StubBuilder(self._data)


def _patch(monkeypatch, rows, *, flag_enabled: bool = True):
    """Wire up _require_auth, _vocab_bank_enabled, and _user_sb for offline runs."""
    async def _fake_auth(_authz):
        return {"id": "user-uuid-123"}
    monkeypatch.setattr(vb, "_require_auth", _fake_auth)
    monkeypatch.setattr(vb, "_vocab_bank_enabled", lambda _uid: flag_enabled)
    monkeypatch.setattr(vb, "_user_sb", lambda _token: _StubClient(rows))
    # _fire_event hits Supabase (analytics); no-op it for offline tests.
    monkeypatch.setattr(vb, "_fire_event", lambda *_a, **_k: None)
    # _token_from_header validates the header shape; supply a valid one.
    return "Bearer fake-jwt"


def _read_streaming(resp) -> str:
    """Drain a StreamingResponse body into a single string for assertions.

    StreamingResponse exposes its iterator as `body_iterator` which is
    converted to async by Starlette.  We re-resolve it synchronously here
    by running an inline coroutine.
    """
    async def _drain():
        chunks = []
        async for chunk in resp.body_iterator:
            chunks.append(chunk.decode("utf-8") if isinstance(chunk, bytes) else str(chunk))
        return "".join(chunks)
    return _run(_drain())


_SAMPLE_ROWS = [
    {
        "headword": "mitigate",
        "definition_vi": "giảm thiểu, làm giảm tác động",
        "definition_en": "to make less severe",
        "ipa": "/ˈmɪtɪɡeɪt/",
        "example_sentence": "Governments must mitigate climate impacts.",
        "context_sentence": "We need to mitigate the risk before launch.",
        "category": "topic",
        "topic": "Environment",
        "source_type": "used_well",
        "is_archived": False,
        "created_at": "2026-04-20T10:00:00+00:00",
    },
    {
        "headword": "elucidate",
        "definition_vi": "làm sáng tỏ",
        "definition_en": "to make clear",
        "ipa": "/ɪˈluːsɪdeɪt/",
        "example_sentence": "Please elucidate the procedure.",
        "context_sentence": "She elucidated the steps clearly.",
        "category": "topic",
        "topic": "Education",
        "source_type": "needs_review",
        "is_archived": False,
        "created_at": "2026-04-21T11:00:00+00:00",
    },
    {
        "headword": "old_archived",
        "definition_vi": "cũ",
        "definition_en": None,
        "ipa": None,
        "example_sentence": None,
        "context_sentence": "manual entry",
        "category": "topic",
        "topic": None,
        "source_type": "manual",
        "is_archived": True,        # archived row — must STILL appear in export
        "created_at": "2026-01-15T08:00:00+00:00",
    },
]


# ── CSV ──────────────────────────────────────────────────────────────────────


def test_export_csv_default(monkeypatch):
    """GET /export with no format → CSV streaming response."""
    authz = _patch(monkeypatch, _SAMPLE_ROWS)
    resp = _run(vb.export_user_vocabulary(format="csv", authorization=authz))

    assert resp.media_type.startswith("text/csv")
    cd = resp.headers.get("Content-Disposition", "")
    assert "attachment" in cd
    assert "vocab_export_" in cd and cd.endswith('.csv"')

    body = _read_streaming(resp)
    assert body.startswith("\ufeff"), "CSV must start with UTF-8 BOM for Excel"

    # Strip BOM, parse, and check shape.
    rdr = csv.DictReader(io.StringIO(body.lstrip("\ufeff")))
    parsed = list(rdr)
    assert len(parsed) == 3
    headwords = [r["headword"] for r in parsed]
    assert headwords == ["mitigate", "elucidate", "old_archived"]


def test_export_empty_vocab(monkeypatch):
    """User with no vocab rows → CSV with only the header line."""
    authz = _patch(monkeypatch, [])
    resp = _run(vb.export_user_vocabulary(format="csv", authorization=authz))

    body = _read_streaming(resp).lstrip("\ufeff")
    lines = [l for l in body.splitlines() if l.strip()]
    # Header row only.
    assert len(lines) == 1
    assert "headword" in lines[0]


def test_export_includes_archived(monkeypatch):
    """Archived rows must appear in the export — backup is lossless."""
    authz = _patch(monkeypatch, _SAMPLE_ROWS)
    resp = _run(vb.export_user_vocabulary(format="csv", authorization=authz))
    body = _read_streaming(resp).lstrip("\ufeff")
    parsed = list(csv.DictReader(io.StringIO(body)))
    archived = [r for r in parsed if r["is_archived"] in ("True", "true", "1")]
    assert len(archived) == 1
    assert archived[0]["headword"] == "old_archived"


def test_export_vietnamese_chars_in_csv(monkeypatch):
    """Vietnamese diacritics survive the round-trip through the CSV writer."""
    rows = [{
        **_SAMPLE_ROWS[0],
        "definition_vi": "Học hành chăm chỉ",
    }]
    authz = _patch(monkeypatch, rows)
    resp = _run(vb.export_user_vocabulary(format="csv", authorization=authz))
    body = _read_streaming(resp)
    assert body.startswith("\ufeff"), "BOM enables Excel to read UTF-8"
    assert "Học hành chăm chỉ" in body


# ── JSON ─────────────────────────────────────────────────────────────────────


def test_export_json_format(monkeypatch):
    """GET /export?format=json → JSON file with metadata + rows."""
    authz = _patch(monkeypatch, _SAMPLE_ROWS)
    resp = _run(vb.export_user_vocabulary(format="json", authorization=authz))

    assert resp.headers.get("Content-Disposition", "").endswith('.json"')
    payload = json.loads(resp.body.decode("utf-8"))
    assert payload["total_count"] == 3
    assert "exported_at" in payload
    assert isinstance(payload["vocabulary"], list)
    assert {v["headword"] for v in payload["vocabulary"]} == {
        "mitigate", "elucidate", "old_archived",
    }


def test_export_json_empty(monkeypatch):
    """JSON with zero vocab rows still includes total_count + empty list."""
    authz = _patch(monkeypatch, [])
    resp = _run(vb.export_user_vocabulary(format="json", authorization=authz))
    payload = json.loads(resp.body.decode("utf-8"))
    assert payload["total_count"] == 0
    assert payload["vocabulary"] == []


# ── Validation ───────────────────────────────────────────────────────────────


def test_export_blocked_when_feature_flag_off(monkeypatch):
    """Default-deny: when vocab_enabled is False the export is 403'd, even
    though the user is authenticated.  Mirrors the gate on every other
    vocabulary_bank endpoint."""
    authz = _patch(monkeypatch, _SAMPLE_ROWS, flag_enabled=False)
    with pytest.raises(Exception) as exc_info:
        _run(vb.export_user_vocabulary(format="csv", authorization=authz))
    assert getattr(exc_info.value, "status_code", None) == 403


def test_export_invalid_format_via_testclient():
    """`?format=xml` is rejected at the FastAPI query-validation layer with
    422, before any handler code runs.

    The route is registered BEFORE `/{vocab_id}` so the request hits this
    handler rather than the detail handler — the previous bug where
    `/export` was treated as a vocab_id (yielding 403 from the feature-flag
    check on the detail route) is now structurally impossible.  This test
    pins both behaviours: validation fires, and the route resolves to the
    export endpoint.
    """
    from fastapi.testclient import TestClient
    from main import app

    c = TestClient(app)
    r = c.get(
        "/api/vocabulary/bank/export?format=xml",
        headers={"Authorization": "Bearer fake-jwt-shape-only"},
    )
    assert r.status_code == 422
    body = r.json()
    # Pydantic v2 surfaces the offending field name in `loc`.
    assert any("format" in (err.get("loc") or []) for err in body.get("detail", []))
