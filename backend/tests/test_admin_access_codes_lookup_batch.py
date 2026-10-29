"""
tests/test_admin_access_codes_lookup_batch.py — PC-J80.

GET /admin/access-codes used to read user_code_assignments with ONE
`.in_("code_id", <every code id>)`. As the table grew, the generated URL got
rejected by the gateway (400 "JSON could not be generated") and EVERY code was
flagged `association_lookup_failed`. Pins:
  - code ids are looked up in batches of ≤ _ACCESS_CODE_ID_CHUNK and merged;
  - each batch is paged past the ~1000-row response cap;
  - a failed batch flags ONLY its own codes, never synthesizes a used_by
    fallback for them, and leaves the other codes fully enriched;
  - the failure log carries shape only (no ids / user data).
"""

import asyncio
import logging

import pytest

from routers import admin as admin_module


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Exec:
    def __init__(self, data):
        self.data = data


class _B:
    """Minimal PostgREST builder: honours in_/eq/gt/order/limit on seeded rows."""

    def __init__(self, name, db):
        self._name, self._db = name, db
        self._in = None
        self._gt = None
        self._limit = None

    def select(self, *a, **k): return self
    def order(self, *a, **k): return self
    def eq(self, *a, **k): return self

    def in_(self, col, ids):
        ids = list(ids)
        self._db.in_calls.append((self._name, col, ids))
        self._in = (col, set(ids))
        return self

    def gt(self, col, value):
        self._gt = (col, value)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def execute(self):
        self._db.executes.append(self._name)
        if self._name in self._db.fail_tables:
            col, ids = self._in
            if self._db.fail_tables[self._name] & ids:
                raise RuntimeError("Bad Request")
        rows = list(self._db.tables.get(self._name, []))
        if self._in is not None:
            col, ids = self._in
            rows = [r for r in rows if r.get(col) in ids]
        if self._gt is not None:
            col, value = self._gt
            rows = sorted((r for r in rows if r[col] > value), key=lambda r: r[col])
        elif self._limit is not None:
            rows = sorted(rows, key=lambda r: r.get("id", ""))
        if self._limit is not None:
            rows = rows[: self._limit]
        return _Exec(rows)


class _DB:
    def __init__(self, tables, fail_tables=None):
        self.tables = tables
        self.fail_tables = fail_tables or {}
        self.in_calls: list = []
        self.executes: list = []

    def table(self, name):
        return _B(name, self)


def _install(monkeypatch, tables, fail_tables=None):
    db = _DB(tables, fail_tables)

    async def _ok(_authz):
        return {"id": "admin", "role": "admin"}

    monkeypatch.setattr(admin_module, "require_admin", _ok)
    monkeypatch.setattr(admin_module, "supabase_admin", db)
    monkeypatch.setattr(admin_module, "get_completed_session_counts", lambda uids: {})
    return db


def _cid(i):
    return f"c{i:05d}"


def _codes(n, **extra):
    return [{"id": _cid(i), "code": f"CODE-{i}", "is_used": False, "used_by": None,
             "session_limit": None, "cohort_id": None, **extra} for i in range(n)]


def _asgn_in_calls(db):
    return [ids for (t, col, ids) in db.in_calls if t == "user_code_assignments"]


@pytest.mark.parametrize("n, batches", [(0, 0), (1, 1), (150, 1), (151, 2), (1000, 7)])
def test_chunk_helper_counts(n, batches):
    ids = [_cid(i) for i in range(n)]
    chunks = admin_module._access_code_id_chunks(ids)
    assert len(chunks) == batches
    assert all(len(c) <= admin_module._ACCESS_CODE_ID_CHUNK for c in chunks)
    assert [i for c in chunks for i in c] == ids  # order-preserving, no loss/dup


@pytest.mark.parametrize("n, batches", [(1, 1), (150, 1), (151, 2), (1000, 7)])
def test_assignment_lookup_is_batched_and_merged(monkeypatch, n, batches):
    codes = _codes(n)
    # One active assignment per code, one user per code.
    asgn = [{"id": f"a{i:05d}", "code_id": _cid(i), "user_id": f"u{i:05d}", "is_active": True}
            for i in range(n)]
    users = [{"id": f"u{i:05d}", "email": f"u{i}@x.io", "display_name": f"U{i}"}
             for i in range(n)]
    db = _install(monkeypatch, {"access_codes": codes, "user_code_assignments": asgn,
                                "users": users})

    out = _run(admin_module.list_access_codes(authorization="Bearer t"))

    calls = _asgn_in_calls(db)
    assert len(calls) == batches
    assert all(len(ids) <= admin_module._ACCESS_CODE_ID_CHUNK for ids in calls)
    assert sorted(i for ids in calls for i in ids) == sorted(c["id"] for c in codes)
    # users lookup is batched the same way
    user_calls = [ids for (t, _c, ids) in db.in_calls if t == "users"]
    assert all(len(ids) <= admin_module._ACCESS_CODE_ID_CHUNK for ids in user_calls)

    assert len(out) == n
    for i, c in enumerate(out):
        assert not c.get("association_lookup_failed")
        assert c["assigned_user_count"] == 1
        assert c["assigned_users"][0]["user_id"] == f"u{i:05d}"
        assert c["assigned_users"][0]["email"] == f"u{i}@x.io"


def test_zero_codes_makes_no_assignment_lookup(monkeypatch):
    db = _install(monkeypatch, {"access_codes": []})
    assert _run(admin_module.list_access_codes(authorization="Bearer t")) == []
    assert _asgn_in_calls(db) == []


def test_batch_is_paged_past_the_row_cap(monkeypatch):
    """One mass code with 2,500 assignment rows: all must be counted, not 1000."""
    codes = _codes(1, code_type="mass")
    asgn = [{"id": f"a{i:05d}", "code_id": _cid(0), "user_id": f"u{i:05d}", "is_active": True}
            for i in range(2500)]
    db = _install(monkeypatch, {"access_codes": codes, "user_code_assignments": asgn,
                                "users": []})

    out = _run(admin_module.list_access_codes(authorization="Bearer t"))

    assert out[0]["assigned_user_count"] == 2500
    assert db.executes.count("user_code_assignments") == 3  # 1000 + 1000 + 500


def test_failed_batch_flags_only_its_codes(monkeypatch, caplog):
    codes = _codes(400)                   # batches: [0..149], [150..299], [300..399]
    # A legacy redeemer in the failing batch: must NOT be synthesized as owner.
    codes[200].update(is_used=True, used_by="legacy-user")
    # A legacy redeemer in a healthy batch: fallback still works.
    codes[10].update(is_used=True, used_by="legacy-ok")
    asgn = [{"id": f"a{i:05d}", "code_id": _cid(i), "user_id": f"u{i:05d}", "is_active": True}
            for i in range(400) if i not in (10, 200)]
    db = _install(
        monkeypatch,
        {"access_codes": codes, "user_code_assignments": asgn, "users": []},
        fail_tables={"user_code_assignments": {_cid(150)}},
    )

    with caplog.at_level(logging.WARNING, logger=admin_module.logger.name):
        out = _run(admin_module.list_access_codes(authorization="Bearer t"))

    by_id = {c["id"]: c for c in out}
    flagged = {cid for cid, c in by_id.items() if c.get("association_lookup_failed")}
    assert flagged == {_cid(i) for i in range(150, 300)}
    for cid in flagged:
        assert "assigned_users" not in by_id[cid]
        assert "assigned_user_count" not in by_id[cid]
    # Healthy batches are fully enriched.
    assert by_id[_cid(0)]["assigned_user_count"] == 1
    assert by_id[_cid(399)]["assigned_user_count"] == 1
    legacy_ok = by_id[_cid(10)]["assigned_users"]
    assert legacy_ok[0]["user_id"] == "legacy-ok" and legacy_ok[0]["is_fallback_used_by"]
    # The failing batch's legacy redeemer was never looked up as a user.
    assert all("legacy-user" not in ids for (t, _c, ids) in db.in_calls if t == "users")
    assert len(_asgn_in_calls(db)) == 3

    msgs = [r.getMessage() for r in caplog.records
            if "assignment lookup failed" in r.getMessage()]
    assert len(msgs) == 1
    assert "batch=2/3" in msgs[0] and "ids=150" in msgs[0] and "filter_len=" in msgs[0]
    assert _cid(150) not in msgs[0]        # no ids / user data in the log


def test_every_batch_failing_flags_every_code(monkeypatch):
    codes = _codes(151)
    db = _install(
        monkeypatch,
        {"access_codes": codes, "user_code_assignments": [], "users": []},
        fail_tables={"user_code_assignments": {_cid(0), _cid(150)}},
    )
    out = _run(admin_module.list_access_codes(authorization="Bearer t"))
    assert all(c.get("association_lookup_failed") is True for c in out)
    assert len(_asgn_in_calls(db)) == 2
