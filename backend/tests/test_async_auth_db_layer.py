"""PC-J05 D1 — per-request auth/permission checks on the async-DB layer.

D1a moved the DB reads that run on every request (learner activation gate,
staff role guards, /auth/me, /auth/check-active, /api/student/permissions) onto
``services.db_async``. D1b fans /api/student/home-summary out over per-thread
service-role clients. These tests pin:

  * equivalence — every converted path returns the same result (and the same
    HTTP status/detail) with USE_ASYNC_DB off and on, over the same data,
    including the degraded/failure branches;
  * flag OFF never touches the async client; flag ON never touches the sync
    singleton (the point of the change: no blocking call on the loop);
  * flag ON really frees the event loop (concurrent checks overlap);
  * transports — the async client and the per-thread clients use HTTP/1.1,
    and per-thread clients are never shared between threads.
"""

from __future__ import annotations

import asyncio
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import database
import main
import routers.admin as admin_module
import routers.auth as auth_module
from config import settings
from services import access_code_permissions as acp
from services import activation_gate


# ── In-memory PostgREST fake (sync + async views over one dataset) ───────────


class _Resp:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _Query:
    def __init__(self, db, table):
        self.db, self.table_name = db, table
        self.filters: list = []
        self.op, self.payload = "select", None
        self.limit_n = None
        self.do_nothing = False

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append(("eq", col, val))
        return self

    def in_(self, col, vals):
        self.filters.append(("in", col, list(vals)))
        return self

    def is_(self, col, val):
        self.filters.append(("is", col, val))
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def insert(self, row):
        self.op, self.payload = "insert", row
        return self

    def upsert(self, row, *, on_conflict="", ignore_duplicates=False):
        # Only INSERT ... ON CONFLICT (id) DO NOTHING is modelled; a merge
        # upsert would overwrite an existing row and must not slip through.
        assert (on_conflict, ignore_duplicates) == ("id", True), "merge upsert"
        self.op, self.payload, self.do_nothing = "insert", row, True
        return self

    def update(self, row):
        self.op, self.payload = "update", row
        return self

    def _match(self, row):
        for kind, col, val in self.filters:
            if kind == "eq" and row.get(col) != val:
                return False
            if kind == "in" and row.get(col) not in val:
                return False
            if kind == "is" and val == "null" and row.get(col) is not None:
                return False
        return True

    def run(self):
        key = (self.table_name, tuple((k, c) for k, c, _ in self.filters))
        self.db.calls.append((self.op, self.table_name, tuple(self.filters)))
        if key in self.db.fail:
            raise RuntimeError(f"{self.table_name} down")
        rows = self.db.tables.setdefault(self.table_name, [])
        if self.op == "insert":
            with self.db.lock:
                if any(r.get("id") == self.payload.get("id") for r in rows):
                    if self.do_nothing:
                        return _Resp([])
                    raise RuntimeError("duplicate key value violates unique constraint")
                rows.append(dict(self.payload))
            return _Resp([dict(self.payload)])
        matched = [r for r in rows if self._match(r)]
        if self.op == "update":
            for r in matched:
                r.update(self.payload)
            return _Resp([dict(r) for r in matched])
        if self.limit_n is not None:
            matched = matched[: self.limit_n]
        resp = _Resp([dict(r) for r in matched])
        if self.table_name == "users" and not resp.data and self.db.on_missing_user:
            self.db.on_missing_user()
        return resp

    def execute(self):
        if self.db.forbid_sync:
            raise AssertionError("sync client used while USE_ASYNC_DB is on")
        return self.run()


class _AsyncQuery(_Query):
    async def execute(self):  # type: ignore[override]
        await asyncio.sleep(self.db.async_delay)
        resp = self.run()
        if self.table_name == "users" and self.op == "select" and not resp.data \
                and self.db.aon_missing_user:
            await self.db.aon_missing_user()
        return resp


class FakeDB:
    """One dataset; ``.table`` is the sync client, ``.aclient`` the async one."""

    def __init__(self, tables):
        self.tables = {k: [dict(r) for r in v] for k, v in tables.items()}
        self.calls: list = []
        self.fail: set = set()
        self.forbid_sync = False
        self.async_delay = 0.0
        # Race hooks: run after a users SELECT that found no row.
        self.on_missing_user = None
        self.aon_missing_user = None
        self.lock = threading.Lock()
        db = self

        class _AsyncClient:
            def table(self, name):
                return _AsyncQuery(db, name)

        self.aclient = _AsyncClient()

    def table(self, name):
        return _Query(self, name)


def _flag(monkeypatch, db: FakeDB, on: bool, *modules):
    """Point every module-level sync client and the async client at ``db``."""
    monkeypatch.setattr(settings, "USE_ASYNC_DB", on)
    for mod in modules:
        monkeypatch.setattr(mod, "supabase_admin", db)
    monkeypatch.setattr(database, "supabase_admin", db)

    async def _get_async():
        if not on:
            raise AssertionError("async client used while USE_ASYNC_DB is off")
        return db.aclient

    monkeypatch.setattr(database, "get_supabase_async", _get_async)
    db.forbid_sync = on


def _both(monkeypatch, tables, run, *modules, fail=()):
    """Run ``run(db)`` once per flag state on fresh copies of ``tables``."""
    out = {}
    for on in (False, True):
        with monkeypatch.context() as mp:
            db = FakeDB(tables)
            db.fail = set(fail)
            _flag(mp, db, on, *modules)
            try:
                result = run(db)
            except HTTPException as exc:
                result = ("HTTPException", exc.status_code, exc.detail)
            out[on] = (result, db.calls, db.tables)
    return out


# ── Fixture data ─────────────────────────────────────────────────────────────

NOW = datetime.now(timezone.utc)
PAST = (NOW - timedelta(days=1)).isoformat()
FUTURE = (NOW + timedelta(days=30)).isoformat()


def _code(cid, perms, **kw):
    return {"id": cid, "permissions": perms, "session_limit": None, "is_revoked": False,
            "is_active": True, "expires_at": FUTURE, "used_by": None, **kw}


TABLES = {
    "users": [
        {"id": "u-active", "is_active": True, "role": "user", "email": "a@x.test",
         "feature_flags": {}, "last_seen_at": None},
        {"id": "u-inactive", "is_active": False, "role": "user", "email": "i@x.test"},
        {"id": "u-instructor", "is_active": True, "role": "instructor"},
        {"id": "u-instructor-off", "is_active": False, "role": "instructor"},
        {"id": "u-admin", "is_active": True, "role": "admin"},
    ],
    "user_code_assignments": [
        {"user_id": "u-active", "code_id": "c-speak", "is_active": True},
        {"user_id": "u-active", "code_id": "c-revoked", "is_active": True},
        {"user_id": "u-active", "code_id": "c-removed", "is_active": False},
    ],
    "access_codes": [
        _code("c-speak", ["practice_single", "practice_part"]),
        _code("c-revoked", ["writing"], is_revoked=True),
        # Legacy used_by for a code the user has an INACTIVE row for: suppressed (#442).
        _code("c-removed", ["all"], used_by="u-active"),
        # True legacy code (no assignment row): granted.
        _code("c-legacy", ["practice_full"], used_by="u-active"),
        _code("c-expired", ["writing"], used_by="u-active", expires_at=PAST),
    ],
    "students": [
        {"id": "s-1", "user_id": "u-active", "full_name": "A", "archived_at": None,
         "updated_at": PAST, "student_code": "S1"},
    ],
    "writing_assignments": [{"id": "wa-1", "student_id": "s-1"}],
}


# ── Live permissions: _active_code_rows ≡ _aactive_code_rows ────────────────

_FAILURES = {
    "ok": (),
    "assignments_down": {("user_code_assignments", (("eq", "user_id"),))},
    "codes_down": {("access_codes", (("in", "id"),))},
    "legacy_down": {("access_codes", (("eq", "used_by"),))},
}


@pytest.mark.parametrize("scenario", sorted(_FAILURES))
@pytest.mark.parametrize("user_id", ["u-active", "u-inactive", "nobody"])
def test_live_permissions_identical_in_both_flag_states(monkeypatch, scenario, user_id):
    out = _both(
        monkeypatch, TABLES,
        lambda _db: asyncio.run(acp.aget_user_access_code_permissions(user_id)),
        acp, fail=_FAILURES[scenario],
    )
    assert out[False][0] == out[True][0]
    assert out[False][1] == out[True][1], "same queries, same order"


def test_live_permissions_values_pin_the_sourcing_rules(monkeypatch):
    out = _both(monkeypatch, TABLES,
                lambda _db: asyncio.run(acp.aget_user_access_code_permissions("u-active")), acp)
    # c-speak (modern) + c-legacy (true legacy); not revoked/expired/#442-suppressed.
    assert out[True][0] == ["practice_full", "practice_part", "practice_single"]


def test_cached_permissions_memoise_within_a_request_when_on(monkeypatch):
    db = FakeDB(TABLES)
    _flag(monkeypatch, db, True, acp)
    token = acp.begin_request_permission_memo()
    try:
        async def twice():
            a = await acp.aget_user_access_code_permissions_cached("u-active")
            b = await acp.aget_user_access_code_permissions_cached("u-active")
            return a, b
        a, b = asyncio.run(twice())
    finally:
        acp.reset_request_permission_memo(token)
    assert a == b
    assert len(db.calls) == 3, "one lookup (assignments, codes, legacy) for two gates"


@pytest.mark.parametrize("user_id,display_name", [
    ("u-active", None), ("u-active", "A"), ("u-inactive", None), ("nobody", None),
])
def test_account_permissions_summary_identical(monkeypatch, live_activation_gate,
                                               user_id, display_name):
    tables = {**TABLES, "access_codes": [_code("c-speak", ["practice_single"])]}
    out = _both(
        monkeypatch, tables,
        lambda _db: asyncio.run(acp.aget_account_permissions_summary(user_id, display_name)),
        acp, activation_gate,
    )
    assert out[False][0] == out[True][0]
    assert out[False][1] == out[True][1]
    if user_id == "u-active":
        # Speaking-only code + a writing assignment → the WF bridge grants writing.
        assert out[True][0]["writing"] is True


# ── Activation gate ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("user_id", ["u-active", "u-inactive", "nobody"])
def test_gate_lookup_identical(monkeypatch, live_activation_gate, user_id):
    out = _both(monkeypatch, TABLES,
                lambda _db: asyncio.run(activation_gate.aensure_account_active(user_id)),
                activation_gate)
    assert out[False][0] == out[True][0]
    assert out[False][1] == out[True][1]


def test_gate_lookup_failure_fails_closed_503_in_both(monkeypatch, live_activation_gate):
    out = _both(monkeypatch, TABLES,
                lambda _db: asyncio.run(activation_gate.alookup_is_active("u-active")),
                activation_gate, fail={("users", (("eq", "id"),))})
    assert out[False][0] == out[True][0]
    assert out[True][0][:2] == ("HTTPException", 503)


def test_gate_memo_skips_second_lookup_when_on(monkeypatch, live_activation_gate):
    db = FakeDB(TABLES)
    _flag(monkeypatch, db, True, activation_gate)
    token = activation_gate.begin_request_memo()
    try:
        async def twice():
            await activation_gate.aensure_account_active("u-active")
            return activation_gate.account_is_active("u-active")
        assert asyncio.run(twice()) is True
    finally:
        activation_gate.reset_request_memo(token)
    assert len(db.calls) == 1, "the sync folded check reuses the async gate's memo"


def test_flag_on_gate_does_not_block_the_event_loop(monkeypatch, live_activation_gate):
    db = FakeDB(TABLES)
    db.async_delay = 0.2
    _flag(monkeypatch, db, True, activation_gate)

    async def five():
        start = time.perf_counter()
        await asyncio.gather(*(activation_gate.alookup_is_active("u-active") for _ in range(5)))
        return time.perf_counter() - start

    # Five 200 ms lookups overlap on one loop; a blocking client would take 1 s.
    assert asyncio.run(five()) < 0.6


# ── Staff guards ─────────────────────────────────────────────────────────────


class _AuthClient:
    is_closed = False

    class cookies:  # noqa: N801 — mimics httpx.AsyncClient.cookies
        @staticmethod
        def clear():
            pass

    async def get(self, _url, headers):
        uid = headers["Authorization"].removeprefix("Bearer ")

        class _R:
            status_code = 200

            @staticmethod
            def json():
                return {"id": uid, "email": f"{uid}@x.test", "user_metadata": {"full_name": "N"}}

        return _R()


@pytest.mark.parametrize("guard", ["require_admin", "require_instructor"])
@pytest.mark.parametrize("user_id", ["u-admin", "u-instructor", "u-instructor-off", "u-active", "nobody"])
def test_staff_guards_identical(monkeypatch, live_activation_gate, guard, user_id):
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _AuthClient())
    fn = getattr(admin_module, guard)
    out = _both(monkeypatch, TABLES, lambda _db: asyncio.run(fn(f"Bearer {user_id}")),
                admin_module, activation_gate)
    assert out[False][0] == out[True][0]
    assert out[False][1] == out[True][1]


def test_staff_guard_role_lookup_error_is_500_in_both(monkeypatch, live_activation_gate):
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _AuthClient())
    out = _both(monkeypatch, TABLES,
                lambda _db: asyncio.run(admin_module.require_instructor("Bearer u-instructor")),
                admin_module, activation_gate, fail={("users", (("eq", "id"),))})
    assert out[False][0][:2] == out[True][0][:2] == ("HTTPException", 500)


# ── HTTP routes: /auth/me, /auth/check-active, /api/student/permissions ─────


def _http(path, user_id):
    def run(_db):
        api = TestClient(main.app, raise_server_exceptions=False)
        r = api.get(path, headers={"Authorization": f"Bearer {user_id}"})
        return r.status_code, r.json()
    return run


@pytest.mark.parametrize("path", ["/auth/me", "/auth/check-active", "/api/student/permissions"])
@pytest.mark.parametrize("user_id", ["u-active", "u-inactive", "u-new"])
def test_auth_routes_identical(monkeypatch, live_activation_gate, path, user_id):
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _AuthClient())
    monkeypatch.setattr("services.runtime_flags.is_enabled", lambda *_a, **_k: False)
    out = _both(monkeypatch, TABLES, _http(path, user_id),
                auth_module, acp, activation_gate)
    off, on = out[False], out[True]
    if path == "/auth/me":
        # last_seen_at is "now" in each run; everything else must match.
        for state in (off, on):
            for row in state[2]["users"]:
                row.pop("last_seen_at", None)
        strip = lambda calls: [c for c in calls if c[0] != "update"]  # noqa: E731
        assert len(off[1]) == len(on[1])
        assert strip(off[1]) == strip(on[1])
    else:
        assert off[1] == on[1]
    assert off[0] == on[0]
    assert off[2] == on[2], "same rows written (users provisioning)"
    if path == "/auth/me" and user_id == "u-new":
        assert any(c[0] == "insert" for c in on[1]), "first visit provisions the users row"


def test_auth_me_error_contract_identical(monkeypatch):
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _AuthClient())
    out = _both(monkeypatch, TABLES, _http("/auth/me", "u-active"),
                auth_module, acp, activation_gate, fail={("users", (("eq", "id"),))})
    for state in out.values():
        state[0][1]["detail"].pop("ref")  # a fresh error reference per response
    assert out[False][0] == out[True][0]
    assert out[True][0][0] == 500


# ── /auth/me first-visit provisioning races ─────────────────────────────────


def _new_user_rows(db):
    return [r for r in db.tables["users"] if r["id"] == "u-new"]


@pytest.mark.parametrize("on", [False, True])
def test_concurrent_first_visits_across_workers_both_succeed(monkeypatch, on):
    """Two workers both find no users row before either inserts."""
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _AuthClient())
    monkeypatch.setattr("services.runtime_flags.is_enabled", lambda *_a, **_k: False)
    db = FakeDB(TABLES)
    _flag(monkeypatch, db, on, auth_module, acp, activation_gate)
    barrier = threading.Barrier(2)
    db.on_missing_user = lambda: barrier.wait(timeout=5)

    results = []

    def visit():
        api = TestClient(main.app, raise_server_exceptions=False)
        results.append(api.get("/auth/me", headers={"Authorization": "Bearer u-new"}))

    workers = [threading.Thread(target=visit) for _ in range(2)]
    for w in workers:
        w.start()
    for w in workers:
        w.join(timeout=10)

    assert [r.status_code for r in results] == [200, 200], [r.text for r in results]
    assert all(r.json()["id"] == "u-new" for r in results)
    assert len(_new_user_rows(db)) == 1


def test_concurrent_first_visits_on_one_event_loop_both_succeed(monkeypatch):
    """USE_ASYNC_DB on: both requests interleave on the loop between SELECT
    and INSERT (Codex P2 on #1805)."""
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _AuthClient())
    monkeypatch.setattr("services.runtime_flags.is_enabled", lambda *_a, **_k: False)
    db = FakeDB(TABLES)
    _flag(monkeypatch, db, True, auth_module, acp, activation_gate)

    async def run():
        arrived, both = [], asyncio.Event()

        async def rendezvous():
            arrived.append(1)
            if len(arrived) == 2:
                both.set()
            await asyncio.wait_for(both.wait(), timeout=5)

        db.aon_missing_user = rendezvous
        transport = httpx.ASGITransport(app=main.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as api:
            return await asyncio.gather(*(
                api.get("/auth/me", headers={"Authorization": "Bearer u-new"})
                for _ in range(2)
            ))

    results = asyncio.run(run())
    assert [r.status_code for r in results] == [200, 200], [r.text for r in results]
    assert len(_new_user_rows(db)) == 1


@pytest.mark.parametrize("on", [False, True])
def test_first_visit_race_keeps_existing_role_and_activation(monkeypatch, on):
    """The row appears between /auth/me's SELECT and INSERT (the other request
    already provisioned it and /auth/activate promoted it): provisioning must
    not overwrite its role or is_active."""
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _AuthClient())
    monkeypatch.setattr("services.runtime_flags.is_enabled", lambda *_a, **_k: False)
    db = FakeDB(TABLES)
    _flag(monkeypatch, db, on, auth_module, acp, activation_gate)
    winner = {"id": "u-new", "email": "u-new@x.test", "display_name": "Winner",
              "role": "instructor", "is_active": True, "feature_flags": {}}

    def winner_commits():
        db.on_missing_user = None
        db.tables["users"].append(dict(winner))

    db.on_missing_user = winner_commits
    api = TestClient(main.app, raise_server_exceptions=False)
    r = api.get("/auth/me", headers={"Authorization": "Bearer u-new"})

    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["role"], body["is_active"], body["display_name"]) == ("instructor", True, "Winner")
    rows = _new_user_rows(db)
    assert len(rows) == 1
    row = dict(rows[0])
    row.pop("last_seen_at", None)
    assert row == winner


# ── Transports ───────────────────────────────────────────────────────────────


def test_async_client_postgrest_transport_is_http1(monkeypatch):
    seen = {}

    class _Fake:
        rest_url = "https://example.supabase.co/rest/v1"

        class options:  # noqa: N801
            headers = {"apikey": "k"}
            schema = "public"
            postgrest_client_timeout = 120

        def _init_postgrest_client(self, **kw):
            seen.update(kw)
            return "postgrest"

    async def _create(_url, _key):
        return _Fake()

    monkeypatch.setattr(database, "_supabase_async", None)
    monkeypatch.setattr(database, "create_async_client", _create)
    client = asyncio.run(database.init_supabase_async())
    transport = seen["http_client"]
    try:
        assert client._postgrest == "postgrest"
        assert isinstance(transport, httpx.AsyncClient)
        assert database._supabase_async_postgrest_http_client is transport
    finally:
        asyncio.run(database.close_supabase_async())
    assert transport.is_closed and database._supabase_async is None


def test_async_transport_factory_disables_http2(monkeypatch):
    calls = {}
    monkeypatch.setattr(database.httpx, "AsyncClient", lambda **kw: calls.update(kw) or "c")
    assert database._build_supabase_async_http_client() == "c"
    assert calls["http1"] is True and calls["http2"] is False


def test_thread_clients_are_per_thread_and_reused():
    seen: dict = {}

    def grab(tag):
        seen[tag] = (database.thread_supabase_admin(), database.thread_supabase_admin())

    threads = [threading.Thread(target=grab, args=(i,)) for i in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    clients = [pair[0] for pair in seen.values()]
    assert all(a is b for a, b in seen.values()), "a thread reuses its own client"
    assert len({id(c) for c in clients}) == 3, "threads never share a client"
    assert all(c is not database.supabase_admin for c in clients)
    for c in clients:
        session = c.postgrest.session
        assert isinstance(session, httpx.Client)
        assert session._transport._pool._http2 is False


def test_home_summary_builds_each_section_on_its_own_thread_client(monkeypatch):
    from services import student_home_aggregator as agg

    made: list = []

    class _Client:
        def __init__(self):
            self.thread = threading.get_ident()

    def make_sb():
        c = _Client()
        made.append(c)
        return c

    used: list = []
    for name in ("_build_speaking", "_build_grammar", "_build_vocabulary",
                 "_build_reading", "_build_listening", "_build_streak"):
        monkeypatch.setattr(agg, name, lambda sb, _uid, _n=name: used.append(sb) or {})
    monkeypatch.setattr(agg, "_build_writing", lambda sb, *_a: used.append(sb) or {})

    loop_thread = threading.get_ident()
    asyncio.run(agg.get_home_summary_concurrent(make_sb, "u", name="N", email="e"))
    assert len(made) == 7 and len(used) == 7
    assert len({id(c) for c in used}) == 7, "no client handed to two sections"
    assert all(c.thread != loop_thread for c in made), "clients are built in the worker thread"


def test_home_summary_sections_overlap(monkeypatch):
    from services import student_home_aggregator as agg

    def slow(*_a, **_k):
        time.sleep(0.15)
        raise RuntimeError("down")

    for name in ("_build_speaking", "_build_writing", "_build_grammar", "_build_vocabulary",
                 "_build_reading", "_build_listening", "_build_streak"):
        monkeypatch.setattr(agg, name, slow)
    start = time.perf_counter()
    payload = asyncio.run(agg.get_home_summary_concurrent(lambda: None, "u", name="N", email="e"))
    assert time.perf_counter() - start < 0.7, "seven 150 ms sections must not run serially"
    assert list(payload["_errors"]) == [
        "speaking", "writing", "grammar", "vocabulary", "reading", "listening", "streak"]
