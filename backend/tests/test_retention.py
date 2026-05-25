"""
tests/test_retention.py — Sprint 16.2 retention schema + soft-hide.

Covers:
  - compute_expiry / is_hidden / hide_cutoff / should_touch (pure, Pattern #29).
  - GET /sessions soft-hide filter (default on; include_hidden=true bypass) and
    the per-row retention augmentation (Pattern #34 integration sentinel).
  - GET /sessions/{id} enqueues a throttled last_accessed_at touch + augments
    the response with retention info.
  - _touch_last_accessed throttle + non-fatal behaviour.
  - migration 078 structure (ADD COLUMN IF NOT EXISTS, grace backfill, index).
"""

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from fastapi import BackgroundTasks

from routers import sessions as sessions_module
from services import retention
from services.retention import (
    compute_expiry,
    hide_cutoff,
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


# ── compute_expiry (anchor = most-recent of started_at / last_accessed_at) ─────

def test_compute_expiry_fresh_session():
    e = compute_expiry({"started_at": _ago(days=0)}, now=NOW)
    assert e["is_hidden"] is False and e["is_purged"] is False
    assert e["days_until_hide"] == 7 and e["days_until_purge"] == 30


def test_compute_expiry_8_days_old():
    e = compute_expiry({"started_at": _ago(days=8)}, now=NOW)
    assert e["is_hidden"] is True and e["is_purged"] is False
    assert e["days_until_hide"] == 0


def test_compute_expiry_31_days_old():
    e = compute_expiry({"started_at": _ago(days=31)}, now=NOW)
    assert e["is_hidden"] is True and e["is_purged"] is True
    assert e["days_until_purge"] == 0


def test_compute_expiry_uses_last_accessed_if_recent():
    # Started 10d ago but opened 1d ago → recent activity keeps it visible.
    e = compute_expiry({"started_at": _ago(days=10), "last_accessed_at": _ago(days=1)}, now=NOW)
    assert e["is_hidden"] is False


def test_compute_expiry_uses_started_if_no_access():
    e = compute_expiry({"started_at": _ago(days=10), "last_accessed_at": None}, now=NOW)
    assert e["is_hidden"] is True


def test_compute_expiry_persisted_hidden_at_is_authoritative():
    # Fresh by anchor, but a 16.4 sweep already stamped hidden_at → hidden.
    e = compute_expiry({"started_at": _ago(days=0), "hidden_at": _ago(days=1)}, now=NOW)
    assert e["is_hidden"] is True


def test_compute_expiry_no_timestamp_safe_default():
    e = compute_expiry({}, now=NOW)
    assert e["is_hidden"] is False and e["is_purged"] is False
    assert e["days_until_hide"] is None


def test_is_hidden_wrapper():
    assert is_hidden({"started_at": _ago(days=9)}, now=NOW) is True
    assert is_hidden({"started_at": _ago(days=2)}, now=NOW) is False


def test_hide_cutoff_is_z_iso_7_days_back():
    cut = hide_cutoff(now=NOW)
    assert cut.endswith("Z") and "+" not in cut
    parsed = datetime.fromisoformat(cut.replace("Z", "+00:00"))
    assert (NOW - parsed) == timedelta(days=7)


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

    select = eq = order = limit = range = gte = lte = ilike = _noop

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


# ── GET /sessions soft-hide filter ─────────────────────────────────────────────

def test_get_sessions_excludes_hidden_default(monkeypatch):
    rec = _patch(monkeypatch, {"sessions": [{"id": "s1", "started_at": _ago(days=1)}]})
    out = _run(sessions_module.list_sessions(**_LIST_DEFAULTS, include_hidden=False))
    assert ("hidden_at", "null") in rec["is_"]
    assert any("started_at.gte." in q and "last_accessed_at.gte." in q for q in rec["or_"])
    # rows augmented with retention info
    assert "retention" in out[0] and out[0]["retention"]["is_hidden"] is False


def test_get_sessions_include_hidden_skips_filter(monkeypatch):
    rec = _patch(monkeypatch, {"sessions": [{"id": "s1", "started_at": _ago(days=40)}]})
    out = _run(sessions_module.list_sessions(**_LIST_DEFAULTS, include_hidden=True))
    assert "is_" not in rec and "or_" not in rec
    # still augmented; this old row reports hidden+purged
    assert out[0]["retention"]["is_hidden"] is True


# ── GET /sessions/{id} touch + augmentation ────────────────────────────────────

def test_get_session_enqueues_touch_and_augments(monkeypatch):
    session = {"id": "sess-1", "user_id": "user-uuid-test", "started_at": _ago(days=2),
               "last_accessed_at": None}
    _patch(monkeypatch, {"sessions": [session], "questions": [], "responses": []})
    bt = BackgroundTasks()
    out = _run(sessions_module.get_session("sess-1", bt, authorization="Bearer x"))
    assert "retention" in out and out["session_id"] == "sess-1"
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
    # Must not raise (Pattern #29).
    sessions_module._touch_last_accessed("sess-1", None)


# ── Migration 078 structure (Pattern #20 schema-aware) ─────────────────────────

def test_migration_078_structure():
    sql = (Path(__file__).resolve().parents[1] / "migrations"
           / "078_sessions_retention_columns.sql").read_text()
    low = sql.lower()
    for col in ("last_accessed_at", "hidden_at", "purged_at"):
        assert f"add column if not exists {col}" in low
    # Grace backfill must only touch unstamped rows (idempotent).
    assert "update sessions set last_accessed_at = now() where last_accessed_at is null" in low
    assert "create index if not exists idx_sessions_retention" in low
