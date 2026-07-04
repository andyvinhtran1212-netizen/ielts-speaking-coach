"""
tests/test_retention.py — Sprint 16.2.1 retention model v2 (decoupled audio/content).

Covers:
  - compute_expiry / is_hidden / content_purge_cutoff / should_touch (pure, #29).
    v2: audio retained 15d, content retained 60d, anchor = max(started_at,
    last_accessed_at), is_hidden == is_content_purged.
  - GET /sessions content-purge filter (default on; include_hidden=true bypass) +
    per-row retention augmentation (Pattern #34 integration sentinel).
  - GET /sessions/{id} enqueues a throttled last_accessed_at touch + augments.
  - _touch_last_accessed throttle + non-fatal behaviour.
  - migration 079 structure (add v2 cols, drop v1 cols, v2 index).
"""

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from fastapi import BackgroundTasks

from routers import sessions as sessions_module
from services.retention import (
    compute_expiry,
    content_purge_cutoff,
    is_hidden,
    should_touch,
)

NOW = datetime(2026, 5, 25, 12, 0, 0, tzinfo=timezone.utc)


def _ago(days=0, hours=0, minutes=0):
    return (NOW - timedelta(days=days, hours=hours, minutes=minutes)).isoformat()


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── compute_expiry v2 (audio 15d / content 60d; anchor = most-recent activity) ──

def test_compute_expiry_v2_fresh():
    e = compute_expiry({"started_at": _ago(days=0)}, now=NOW)
    assert e["is_audio_purged"] is False and e["is_content_purged"] is False
    assert e["is_hidden"] is False
    assert e["days_until_audio_purge"] == 15 and e["days_until_content_purge"] == 60


def test_compute_expiry_v2_audio_purged_content_alive():
    e = compute_expiry({"started_at": _ago(days=16)}, now=NOW)
    assert e["is_audio_purged"] is True
    assert e["is_content_purged"] is False and e["is_hidden"] is False
    assert e["days_until_audio_purge"] == 0


def test_compute_expiry_v2_content_purged():
    e = compute_expiry({"started_at": _ago(days=61)}, now=NOW)
    assert e["is_audio_purged"] is True and e["is_content_purged"] is True
    assert e["is_hidden"] is True
    assert e["days_until_content_purge"] == 0


def test_compute_expiry_v2_decoupled_anchors():
    # Sprint 16.4.1: practised 70d ago, opened 1d ago. Audio is strict recording-age
    # → purged (access doesn't save audio). Content is activity-extended → alive.
    e = compute_expiry({"started_at": _ago(days=70), "last_accessed_at": _ago(days=1)}, now=NOW)
    assert e["is_audio_purged"] is True       # strict started_at (70d ≥ 15)
    assert e["is_content_purged"] is False     # max anchor = 1d ago
    assert e["is_hidden"] is False


def test_compute_expiry_v2_audio_strict_recent_started():
    # Started 14d ago, opened 1d ago → audio not yet purged (14 < 15), content far.
    e = compute_expiry({"started_at": _ago(days=14), "last_accessed_at": _ago(days=1)}, now=NOW)
    assert e["is_audio_purged"] is False and e["days_until_audio_purge"] == 1
    assert e["days_until_content_purge"] == 59   # content uses max anchor (1d ago)


def test_compute_expiry_v2_legacy_grace_uses_started():
    e = compute_expiry({"started_at": _ago(days=70), "last_accessed_at": None}, now=NOW)
    assert e["is_content_purged"] is True and e["is_hidden"] is True


def test_compute_expiry_v2_persisted_content_purge_authoritative():
    # Fresh by anchor, but a 16.4 sweep already stamped content_purged_at.
    e = compute_expiry({"started_at": _ago(days=0), "content_purged_at": _ago(days=1)}, now=NOW)
    assert e["is_content_purged"] is True and e["is_hidden"] is True


def test_compute_expiry_v2_persisted_audio_purge_authoritative():
    e = compute_expiry({"started_at": _ago(days=0), "audio_purged_at": _ago(days=1)}, now=NOW)
    assert e["is_audio_purged"] is True
    assert e["is_content_purged"] is False  # audio purge alone doesn't hide


def test_compute_expiry_v2_no_timestamp_safe_default():
    e = compute_expiry({}, now=NOW)
    assert e["is_audio_purged"] is False and e["is_content_purged"] is False
    assert e["is_hidden"] is False
    assert e["days_until_audio_purge"] is None and e["days_until_content_purge"] is None


def test_is_hidden_wrapper_v2():
    assert is_hidden({"started_at": _ago(days=61)}, now=NOW) is True
    assert is_hidden({"started_at": _ago(days=20)}, now=NOW) is False  # audio gone, content alive


def test_content_purge_cutoff_is_z_iso_60_days_back():
    cut = content_purge_cutoff(now=NOW)
    assert cut.endswith("Z") and "+" not in cut
    parsed = datetime.fromisoformat(cut.replace("Z", "+00:00"))
    assert (NOW - parsed) == timedelta(days=60)


@pytest.mark.parametrize("value,expected", [
    (None, True),
    (_ago(minutes=30), False),
    (_ago(hours=2), True),
])
def test_should_touch(value, expected):
    assert should_touch(value, now=NOW) is expected


# ── Recording stub Supabase client ─────────────────────────────────────────────

class _Exec:
    def __init__(self, data, count=None):
        self.data = list(data)
        self.count = count


class _Builder:
    def __init__(self, data, rec, count=None):
        self._data, self._rec, self._count = data, rec, count

    def _noop(self, *a, **k):
        return self

    select = eq = neq = order = limit = range = gte = lte = ilike = _noop

    def is_(self, col, val):
        self._rec.setdefault("is_", []).append((col, val))
        return self

    def or_(self, q):
        self._rec.setdefault("or_", []).append(q)
        return self

    def update(self, payload):
        self._rec.setdefault("update", []).append(payload)
        return self

    def execute(self):
        return _Exec(self._data, self._count)


class _StubClient:
    def __init__(self, by_table, rec):
        self._by, self._rec = by_table, rec

    def table(self, name):
        return _Builder(self._by.get(name, []), self._rec, self._by.get(name + "__count"))


def _patch(monkeypatch, by_table):
    rec: dict = {}

    async def _fake_user(_authz):
        return {"id": "user-uuid-test"}

    monkeypatch.setattr(sessions_module, "get_supabase_user", _fake_user)
    monkeypatch.setattr(sessions_module, "supabase_admin", _StubClient(by_table, rec))
    return rec


_LIST_DEFAULTS = dict(
    authorization="Bearer x", status=None, part=None, limit=20,
    search=None, sort="newest", date_from=None, date_to=None,
    page=None, page_size=20,
)


# ── GET /sessions content-purge filter (v2) ────────────────────────────────────

def test_get_sessions_excludes_content_purged_default(monkeypatch):
    rec = _patch(monkeypatch, {"sessions": [{"id": "s1", "started_at": _ago(days=1)}]})
    out = _run(sessions_module.list_sessions(**_LIST_DEFAULTS, include_hidden=False))
    assert ("content_purged_at", "null") in rec["is_"]
    assert any("started_at.gte." in q and "last_accessed_at.gte." in q for q in rec["or_"])
    assert "retention" in out[0] and out[0]["retention"]["is_hidden"] is False


def test_get_sessions_include_hidden_skips_filter(monkeypatch):
    rec = _patch(monkeypatch, {"sessions": [{"id": "s1", "started_at": _ago(days=70)}]})
    out = _run(sessions_module.list_sessions(**_LIST_DEFAULTS, include_hidden=True))
    assert "is_" not in rec and "or_" not in rec
    # 70d-old row (no recent access) → content purged → hidden.
    assert out[0]["retention"]["is_hidden"] is True


# ── GET /sessions/{id} touch + augmentation ────────────────────────────────────

def test_get_session_enqueues_touch_and_augments(monkeypatch):
    session = {"id": "sess-1", "user_id": "user-uuid-test", "started_at": _ago(days=2),
               "last_accessed_at": None}
    _patch(monkeypatch, {"sessions": [session], "questions": [], "responses": []})
    bt = BackgroundTasks()
    out = _run(sessions_module.get_session("sess-1", bt, authorization="Bearer x"))
    assert "retention" in out and out["session_id"] == "sess-1"
    assert "days_until_content_purge" in out["retention"]  # v2 shape
    funcs = [t.func for t in bt.tasks]
    assert sessions_module._touch_last_accessed in funcs


def test_touch_writes_when_stale_and_skips_when_recent(monkeypatch):
    rec: dict = {}
    monkeypatch.setattr(sessions_module, "supabase_admin", _StubClient({}, rec))
    sessions_module._touch_last_accessed("sess-1", None)            # NULL → write
    assert len(rec.get("update", [])) == 1
    rec.clear()
    sessions_module._touch_last_accessed("sess-1", datetime.now(timezone.utc).isoformat())
    assert "update" not in rec                                       # recent → skip


def test_touch_is_non_fatal(monkeypatch):
    class _Boom:
        def table(self, *_):
            raise RuntimeError("db down")
    monkeypatch.setattr(sessions_module, "supabase_admin", _Boom())
    sessions_module._touch_last_accessed("sess-1", None)            # must not raise (#29)


# ── Migration 079 structure (Pattern #20 schema-aware) ─────────────────────────

def test_migration_079_structure():
    sql = (Path(__file__).resolve().parents[1] / "migrations"
           / "079_retention_model_v2.sql").read_text()
    low = sql.lower()
    for col in ("audio_purged_at", "content_purged_at"):
        assert f"add column if not exists {col}" in low
    for col in ("hidden_at", "purged_at"):
        assert f"drop column if exists {col}" in low
    assert "create index if not exists idx_sessions_retention_v2" in low
