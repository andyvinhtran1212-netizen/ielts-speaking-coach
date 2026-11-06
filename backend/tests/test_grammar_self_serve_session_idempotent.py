"""Self-serve Grammar Check-up creation reuses the learner's open session."""

import asyncio
import copy
import threading
import weakref
from types import SimpleNamespace

import pytest

from routers import grammar_diagnostic as diagnostic
from services import grammar_diagnostic_service as service


class _Sessions:
    """Filtering fake of grammar_diagnostic_sessions; reads can be slowed."""

    def __init__(self, rows=(), read_delay=0.0):
        self.rows = [dict(row) for row in rows]
        self.read_delay = read_delay
        self.inserts = []
        self.overlap = threading.Barrier(2)
        self.overlap_passes = []
        self._ids = iter(range(1, 1000))

    def table(self, name):
        assert name == "grammar_diagnostic_sessions"
        return _Query(self)


class _Query:
    def __init__(self, db):
        self.db, self.filters, self.row, self.max_rows = db, [], None, None

    def select(self, *_a, **_kw): return self
    def order(self, *_a, **_kw): return self

    def eq(self, column, value):
        self.filters.append(lambda row: row.get(column) == value)
        return self

    def is_(self, column, value):
        assert value == "null"
        self.filters.append(lambda row: row.get(column) is None)
        return self

    def limit(self, count):
        self.max_rows = count
        return self

    def insert(self, row):
        self.row = row
        return self

    def execute(self):
        db = self.db
        if self.row is not None:
            stored = {**self.row, "id": f"session-{next(db._ids)}", "status": "in_progress",
                      "current_phase": "BASELINE"}
            db.rows.append(stored)
            db.inserts.append(stored["id"])
            return SimpleNamespace(data=[copy.deepcopy(stored)])
        snapshot = [copy.deepcopy(row) for row in db.rows if all(f(row) for f in self.filters)]
        if db.read_delay:
            # Give a concurrent request every chance to read the same state.
            try:
                db.overlap_passes.append(db.overlap.wait(timeout=db.read_delay))
            except threading.BrokenBarrierError:
                pass
        return SimpleNamespace(data=snapshot[: self.max_rows])


@pytest.fixture
def self_serve(monkeypatch):
    monkeypatch.setattr(service.runtime_flags, "is_enabled", lambda *_a, **_kw: True)
    monkeypatch.setattr(service, "_active_release", lambda: {"id": "release-1"})
    monkeypatch.setattr(service, "_responses", lambda *_a: [])
    monkeypatch.setattr(diagnostic, "_learner_write_locks", weakref.WeakValueDictionary(), raising=False)

    def install(db):
        monkeypatch.setattr(service, "supabase_admin", db)
        return db

    return install


def _create(user_id="u-1", test_length="QUICK"):
    return service.create_session(
        user_id, mode="ENTRY", module="GENERAL", test_length=test_length,
        class_assignment_item_id=None,
    )


def test_repeated_self_serve_create_returns_the_open_session(self_serve):
    db = self_serve(_Sessions())
    first = _create()
    second = _create(test_length="FULL")
    assert second["id"] == first["id"]
    # The resumed session reports its own stored configuration.
    assert second["test_length"] == "QUICK"
    assert db.inserts == [first["id"]]


@pytest.mark.parametrize("status", ["completed", "exhausted", "abandoned"])
def test_finished_self_serve_session_allows_a_new_one(self_serve, status):
    finished = {"id": "old", "user_id": "u-1", "class_assignment_item_id": None,
                "status": status, "mode": "ENTRY", "module": "GENERAL",
                "test_length": "QUICK", "objective_limit": 28, "current_phase": "COMPLETED"}
    db = self_serve(_Sessions([finished]))
    created = _create()
    assert created["id"] != "old"
    assert db.inserts == [created["id"]]


def test_open_sessions_of_other_scopes_do_not_block_self_serve(self_serve):
    base = {"status": "in_progress", "mode": "ENTRY", "module": "GENERAL",
            "test_length": "QUICK", "objective_limit": 28, "current_phase": "BASELINE"}
    db = self_serve(_Sessions([
        {**base, "id": "assigned", "user_id": "u-1", "class_assignment_item_id": "item-1"},
        {**base, "id": "other-learner", "user_id": "u-2", "class_assignment_item_id": None},
    ]))
    created = _create()
    assert created["id"] not in {"assigned", "other-learner"}
    assert db.inserts == [created["id"]]


@pytest.mark.asyncio
async def test_concurrent_self_serve_requests_create_one_session(self_serve, monkeypatch):
    async def authenticated(authorization):
        return {"id": authorization}

    monkeypatch.setattr(diagnostic, "get_supabase_user", authenticated)
    db = self_serve(_Sessions(read_delay=0.3))
    results = await asyncio.gather(
        diagnostic.create_session(diagnostic.SessionCreate(), authorization="u-1"),
        diagnostic.create_session(diagnostic.SessionCreate(test_length="FULL"), authorization="u-1"),
    )
    assert len(db.inserts) == 1
    assert {result["id"] for result in results} == {db.inserts[0]}


@pytest.mark.asyncio
async def test_different_learners_create_self_serve_sessions_in_parallel(self_serve, monkeypatch):
    async def authenticated(authorization):
        return {"id": authorization}

    monkeypatch.setattr(diagnostic, "get_supabase_user", authenticated)
    db = self_serve(_Sessions(read_delay=2.0))
    results = await asyncio.gather(
        diagnostic.create_session(diagnostic.SessionCreate(), authorization="u-1"),
        diagnostic.create_session(diagnostic.SessionCreate(), authorization="u-2"),
    )
    # Both reads meet at the barrier instead of waiting out its timeout.
    assert not db.overlap.broken, "neither learner may time out at the barrier"
    assert sorted(db.overlap_passes) == [0, 1]
    assert len(db.inserts) == 2
    assert {result["user_id"] for result in db.rows} == {"u-1", "u-2"}
    assert len({result["id"] for result in results}) == 2
