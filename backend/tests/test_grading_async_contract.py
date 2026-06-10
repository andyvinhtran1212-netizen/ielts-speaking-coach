"""P0-1 Phase 2 — grading.py async-wire CONTRACT TEST.

The pass criterion: with USE_ASYNC_DB OFF vs ON, the converted grading queries
must be BYTE-IDENTICAL — same returned data AND the same builder chain. The
facade picks the client; the query the call-site builds is flag-independent by
construction. This test pins that for the 6 grading sites wired in Phase 2.

(Full-suite green with the flag OFF — its default — separately proves the rest
of grading is unchanged.)
"""

from __future__ import annotations

import asyncio

import database
from config import settings
from services.db_async import aexecute


class _Resp:
    def __init__(self, data):
        self.data = data


class _FakeSync:
    """Records the builder chain; returns canned data on .execute()."""

    def __init__(self, data, log):
        self._data = data
        self._log = log

    def table(self, name):
        self._log.append(("table", name))
        return self

    def select(self, *a):
        self._log.append(("select", a))
        return self

    def insert(self, *a):
        self._log.append(("insert", a))
        return self

    def update(self, *a):
        self._log.append(("update", a))
        return self

    def eq(self, *a):
        self._log.append(("eq", a))
        return self

    def limit(self, *a):
        self._log.append(("limit", a))
        return self

    def execute(self):
        return _Resp(self._data)


class _FakeAsync(_FakeSync):
    async def execute(self):  # async parallel — awaited by the facade
        return _Resp(self._data)


_CANNED = [{
    "id": "x", "part": 2, "topic": "Work", "status": "active", "mode": "practice",
    "question_text": "Describe your job.", "feature_flags": {"vocab_enabled": True},
    "headword": "diligent", "lemma": "diligent",
}]

# The exact builder chains used at the 6 converted call-sites in grading.py.
_BUILDS = {
    "session_load":  lambda db: db.table("sessions").select("id, part, topic, status, mode").eq("id", "s").eq("user_id", "u").limit(1),
    "question_load": lambda db: db.table("questions").select("id, question_text").eq("id", "q").eq("session_id", "s").limit(1),
    "vocab_flag":    lambda db: db.table("users").select("feature_flags").eq("id", "u").limit(1),
    "vocab_topic":   lambda db: db.table("sessions").select("topic").eq("id", "s").limit(1),
    "vocab_existing": lambda db: db.table("user_vocabulary").select("headword, lemma").eq("user_id", "u").eq("is_archived", False),
    "vocab_insert":  lambda db: db.table("user_vocabulary").insert({"headword": "diligent"}),
}


def test_converted_queries_byte_identical_off_vs_on(monkeypatch):
    for name, build in _BUILDS.items():
        log_off: list = []
        log_on: list = []
        monkeypatch.setattr(database, "supabase_admin", _FakeSync(_CANNED, log_off))

        async def _get_async():
            return _FakeAsync(_CANNED, log_on)

        monkeypatch.setattr(database, "get_supabase_async", _get_async)

        monkeypatch.setattr(settings, "USE_ASYNC_DB", False)
        off = asyncio.run(aexecute(build))
        monkeypatch.setattr(settings, "USE_ASYNC_DB", True)
        on = asyncio.run(aexecute(build))

        assert off.data == on.data == _CANNED, f"{name}: returned data differs"
        assert log_off == log_on, f"{name}: builder chain differs off vs on"


def test_flag_off_never_touches_async_client(monkeypatch):
    # The whole point of OFF being a no-op: the async client is never reached.
    monkeypatch.setattr(settings, "USE_ASYNC_DB", False)
    monkeypatch.setattr(database, "supabase_admin", _FakeSync(_CANNED, []))

    async def _boom():
        raise AssertionError("async client must not be used when USE_ASYNC_DB is off")

    monkeypatch.setattr(database, "get_supabase_async", _boom)
    res = asyncio.run(aexecute(_BUILDS["session_load"]))
    assert res.data == _CANNED
