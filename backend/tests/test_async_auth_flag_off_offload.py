"""PC-J444 / ASYNCAUTH-0036 Revision 3 (Q5: b): flag-off auth reads off the loop.

With ``USE_ASYNC_DB`` off, every FR-008 path runs its existing sync query, on
its existing client and in its existing order, in a worker thread instead of on
the event-loop thread. These tests pin:

  (a) every FR-008 function keeps the loop free: two calls park their queries
      in workers at the same time while a heartbeat task keeps ticking
      (``tests/loop_gate.py`` explains why this replaces wall-clock bounds);
  (b) the real routes (``/api/quiz/banks`` with the real activation gate,
      ``/auth/check-active``, ``/api/student/permissions``) do the same;
  (c) parity with the previous on-loop behaviour: the same body, status,
      detail, PostgREST query sequence and rows, for every user, role,
      activation state and lookup failure. The "before" run executes the very
      same code with ``asyncio.to_thread`` replaced by an inline call, which
      is exactly what the flag-off branches did before Revision 3;
  (d) the per-request memos still work across the worker boundary;
  (e) with the flag on, no FR-008 path uses a worker thread;
  (f) with the flag off, the async client is never created;
  plus the cancellation contract of the flag-off ``aexecute`` and the G4
  same-user serialization of the ``user_vocabulary`` insert (T012).
"""

from __future__ import annotations

import asyncio
import copy
import threading
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

import database
import main
import routers.admin as admin_module
import routers.auth as auth_module
import routers.grading as grading
import routers.health as health
import routers.quiz as quiz
from config import settings
from services import access_code_permissions as acp
from services import activation_gate
from services import student_service
from services.db_async import aexecute
from tests.loop_gate import WAIT, LoopGate, until
from tests.test_async_auth_db_layer import TABLES, FakeDB, _AuthClient, _flag

USERS_DOWN = {("users", (("eq", "id"),))}
FAILURES = {
    "ok": set(),
    "users_down": USERS_DOWN,
    "assignments_down": {("user_code_assignments", (("eq", "user_id"),))},
    "codes_down": {("access_codes", (("in", "id"),))},
    "legacy_down": {("access_codes", (("eq", "used_by"),))},
    "students_down": {("students", (("eq", "user_id"), ("is", "archived_at")))},
    "assignments_bridge_down": {("writing_assignments", (("eq", "student_id"),))},
}


class ThreadedDB(FakeDB):
    """``FakeDB`` that records the thread of every ``.execute()`` and can park it."""

    def __init__(self, tables):
        super().__init__(tables)
        self.threads: list = []
        self.park = None

    def table(self, name):
        query = super().table(name)
        run = query.execute

        def execute():
            self.threads.append(threading.get_ident())
            if self.park is not None:
                self.park()
            return run()

        query.execute = execute
        return query


async def _outcome(awaitable):
    try:
        return await awaitable
    except HTTPException as exc:
        return ("HTTPException", exc.status_code, exc.detail)


async def _inline_to_thread(func, /, *args, **kwargs):
    """The pre-Revision-3 flag-off behaviour: the sync call on the loop thread."""
    return func(*args, **kwargs)


@pytest.fixture
def auth_stub(monkeypatch, live_activation_gate):
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _AuthClient())
    monkeypatch.setattr("services.runtime_flags.is_enabled", lambda *_a, **_k: False)


# name -> (modules whose ``supabase_admin`` the fake replaces, call factory)
FUNCTIONS = {
    "alookup_is_active": (
        (activation_gate,), lambda: activation_gate.alookup_is_active("u-active")),
    "aget_user_access_code_permissions_cached": (
        (acp,), lambda: acp.aget_user_access_code_permissions_cached("u-active")),
    "aget_account_permissions_summary": (
        (acp, activation_gate), lambda: acp.aget_account_permissions_summary("u-active", "A")),
    "aget_user_access_code_permissions": (
        (acp,), lambda: acp.aget_user_access_code_permissions("u-active")),
    "astudent_has_writing_assignment": (
        (acp,), lambda: acp.astudent_has_writing_assignment("s-1")),
    "astudent_id_for_user": (
        (acp,), lambda: acp.astudent_id_for_user("u-active", "A")),
    "aexecute": (
        (), lambda: aexecute(lambda db: db.table("users").select("role").eq("id", "u-admin").limit(1))),
    "aexecute_sync_client": (
        (admin_module,), lambda: aexecute(
            lambda db: db.table("users").select("role").eq("id", "u-admin").limit(1),
            sync_client=admin_module.supabase_admin)),
    "afetch_linked_student": (
        (), lambda: student_service.afetch_linked_student("u-active", "A")),
    "require_instructor": (
        (admin_module, activation_gate), lambda: admin_module.require_instructor("Bearer u-instructor")),
    "require_admin": (
        (admin_module, activation_gate), lambda: admin_module.require_admin("Bearer u-admin")),
}


def _plain(result):
    """Comparable form of a facade ``APIResponse`` (or any other result)."""
    return ("APIResponse", result.data) if hasattr(result, "data") else result


async def _overlap(gate, make_call):
    """Both calls' queries must be parked in workers at once while the loop
    keeps ticking an unrelated heartbeat; only then are they released."""
    ticks, done = [0], asyncio.Event()

    async def heartbeat():
        while not done.is_set():
            await asyncio.sleep(0.001)
            ticks[0] += 1

    beat = asyncio.create_task(heartbeat())
    calls = asyncio.gather(_outcome(make_call()), _outcome(make_call()))
    try:
        overlapped = await until(lambda: gate.inside >= 2, stop=calls)
        seen = ticks[0]
        ticking = await until(lambda: ticks[0] >= seen + 3, stop=calls)
        parked = overlapped and ticking and not calls.done() and not gate.released
    finally:
        gate.release()
        done.set()
    results = await asyncio.wait_for(calls, WAIT)
    await beat
    assert not gate.timed_out, "a flag-off query ran on the event loop"
    assert parked, f"{gate.inside} of 2 queries parked together while the loop ticked"
    return results


# ── (a) every FR-008 function keeps the loop free ────────────────────────────


@pytest.mark.parametrize("name", sorted(FUNCTIONS))
def test_flag_off_queries_run_in_workers_and_overlap(monkeypatch, auth_stub, name):
    modules, make_call = FUNCTIONS[name]
    db = ThreadedDB(TABLES)
    _flag(monkeypatch, db, False, *modules)
    gate = LoopGate()
    db.park = gate.park

    async def run():
        return threading.get_ident(), await _overlap(gate, make_call)

    loop_thread, results = asyncio.run(run())
    assert _plain(results[0]) == _plain(results[1])
    assert db.threads and all(t != loop_thread for t in db.threads)


# ── (b) real routes keep the loop free ───────────────────────────────────────


async def _get(path, user_id):
    transport = httpx.ASGITransport(app=main.app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path, headers={"Authorization": f"Bearer {user_id}"})


@pytest.fixture
def quiz_banks_stub(monkeypatch):
    monkeypatch.setattr(quiz.quiz_service, "list_published_banks", lambda *_a, **_k: {"ok": True})


ROUTES = ["/api/quiz/banks", "/auth/check-active", "/api/student/permissions"]


@pytest.mark.parametrize("path", ROUTES)
def test_flag_off_routes_overlap_without_blocking_the_loop(monkeypatch, auth_stub, quiz_banks_stub, path):
    db = ThreadedDB(TABLES)
    _flag(monkeypatch, db, False, auth_module, acp, activation_gate)
    gate = LoopGate()
    db.park = gate.park

    async def run():
        return threading.get_ident(), await _overlap(gate, lambda: _get(path, "u-active"))

    loop_thread, responses = asyncio.run(run())
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    assert db.threads and all(t != loop_thread for t in db.threads)


# ── (c) parity with the previous on-loop flag-off behaviour ──────────────────


def _normalise(response):
    body = response.json()
    if isinstance(body, dict) and isinstance(body.get("detail"), dict):
        body["detail"].pop("ref", None)  # a fresh error reference per response
    return response.status_code, body


def _before_and_after(monkeypatch, run, modules, fail):
    """Run ``run()`` with the pre-Revision-3 inline call and with the real
    worker thread, each on a fresh copy of the data. Returns both captures."""
    out = {}
    for mode in ("before", "after"):
        with monkeypatch.context() as mp:
            if mode == "before":
                mp.setattr(asyncio, "to_thread", _inline_to_thread)
            db = ThreadedDB(TABLES)
            db.fail = set(fail)
            _flag(mp, db, False, *modules)

            async def capture():
                return threading.get_ident(), await run()

            loop_thread, result = asyncio.run(capture())
            on_loop = {t == loop_thread for t in db.threads}
            out[mode] = (result, db.calls, db.tables, on_loop)
    before, after = out["before"], out["after"]
    assert before[3] <= {True}, "the 'before' oracle must run on the loop"
    assert after[3] <= {False}, "Revision 3 must not run a query on the loop"
    return before, after


@pytest.mark.parametrize("failure", ["ok", "users_down"])
@pytest.mark.parametrize("user_id", ["u-active", "u-inactive", "u-new"])
@pytest.mark.parametrize("path", ROUTES)
def test_flag_off_route_parity_with_on_loop(monkeypatch, auth_stub, quiz_banks_stub, path, user_id, failure):
    before, after = _before_and_after(
        monkeypatch, lambda: _get(path, user_id),
        (auth_module, acp, activation_gate), FAILURES[failure])
    assert _normalise(after[0]) == _normalise(before[0])
    assert after[1] == before[1], "same PostgREST queries, same order"
    assert after[2] == before[2]
    if failure == "users_down":
        status, body = _normalise(after[0])
        assert status == 503 and set(body["detail"]) == {"error_code", "message"}


@pytest.mark.parametrize("failure", sorted(set(FAILURES) - {"ok", "users_down"}))
def test_flag_off_permissions_route_parity_on_permission_failures(monkeypatch, auth_stub, failure):
    before, after = _before_and_after(
        monkeypatch, lambda: _get("/api/student/permissions", "u-active"),
        (auth_module, acp, activation_gate), FAILURES[failure])
    assert _normalise(after[0]) == _normalise(before[0])
    assert after[1] == before[1]


@pytest.mark.parametrize("failure", ["ok", "users_down"])
@pytest.mark.parametrize("user_id", ["u-admin", "u-instructor", "u-instructor-off", "u-active", "nobody"])
@pytest.mark.parametrize("guard", ["require_admin", "require_instructor"])
def test_flag_off_staff_guard_parity_with_on_loop(monkeypatch, auth_stub, guard, user_id, failure):
    fn = getattr(admin_module, guard)
    before, after = _before_and_after(
        monkeypatch, lambda: _outcome(fn(f"Bearer {user_id}")),
        (admin_module, activation_gate), FAILURES[failure])
    assert after[0] == before[0]
    assert after[1] == before[1]
    if failure == "users_down":
        assert after[0][:2] == ("HTTPException", 503)


@pytest.mark.parametrize("failure", sorted(FAILURES))
@pytest.mark.parametrize("name", sorted(FUNCTIONS))
def test_flag_off_function_parity_with_on_loop(monkeypatch, auth_stub, name, failure):
    modules, make_call = FUNCTIONS[name]

    async def run():
        try:
            return _plain(await _outcome(make_call()))
        except Exception as exc:  # the bare facade propagates DB errors
            return ("raised", type(exc).__name__, str(exc))

    before, after = _before_and_after(monkeypatch, run, modules, FAILURES[failure])
    assert after[0] == before[0]
    assert after[1] == before[1]


@pytest.mark.parametrize("user_id", ["u-active", "u-inactive", "nobody"])
def test_flag_off_gate_parity_inactive_and_missing(monkeypatch, auth_stub, user_id):
    before, after = _before_and_after(
        monkeypatch, lambda: _outcome(activation_gate.aensure_account_active(user_id)),
        (activation_gate,), set())
    assert after[0] == before[0]
    assert after[1] == before[1]
    if user_id != "u-active":
        assert after[0] == ("HTTPException", 403, activation_gate.INACTIVE_DETAIL)


# ── (d) per-request memos across the worker boundary ─────────────────────────


def test_flag_off_permission_memo_written_in_worker_is_seen_by_request(monkeypatch, auth_stub):
    db = ThreadedDB(TABLES)
    _flag(monkeypatch, db, False, acp)
    token = acp.begin_request_permission_memo()
    try:
        async def twice():
            a = await acp.aget_user_access_code_permissions_cached("u-active")
            b = await acp.aget_user_access_code_permissions_cached("u-active")
            return threading.get_ident(), a, b, dict(acp._perm_memo.get())
        loop_thread, a, b, memo = asyncio.run(twice())
    finally:
        acp.reset_request_permission_memo(token)
    assert a == b == memo["u-active"]
    assert len(db.calls) == 3, "one lookup (assignments, codes, legacy) for two gates"
    assert all(t != loop_thread for t in db.threads)


def test_flag_off_gate_memo_reaches_the_worker(monkeypatch, auth_stub):
    db = ThreadedDB(TABLES)
    _flag(monkeypatch, db, False, acp, activation_gate)
    token = activation_gate.begin_request_memo()
    perm_token = acp.begin_request_permission_memo()
    try:
        async def run():
            await activation_gate.aensure_account_active("u-active")
            summary = await acp.aget_account_permissions_summary("u-active", "A")
            return summary, activation_gate.account_is_active("u-active")
        summary, still_active = asyncio.run(run())
    finally:
        acp.reset_request_permission_memo(perm_token)
        activation_gate.reset_request_memo(token)
    assert still_active is True
    assert summary["writing"] is True
    users_reads = [c for c in db.calls if c[1] == "users"]
    assert len(users_reads) == 1, "the worker reused the gate's confirmation"


def test_flag_off_permissions_route_reads_is_active_once(monkeypatch, auth_stub):
    db = ThreadedDB(TABLES)
    _flag(monkeypatch, db, False, auth_module, acp, activation_gate)
    response = asyncio.run(_get("/api/student/permissions", "u-active"))
    assert response.status_code == 200
    assert [c for c in db.calls if c[1] == "users"] == [("select", "users", (("eq", "id", "u-active"),))]
    assert [c[1] for c in db.calls].count("user_code_assignments") == 1


# ── (e) flag on: no worker thread on any FR-008 path ─────────────────────────


@pytest.mark.parametrize("name", sorted(FUNCTIONS))
def test_flag_on_paths_never_use_a_worker(monkeypatch, auth_stub, name):
    modules, make_call = FUNCTIONS[name]

    async def forbidden(*_a, **_k):
        raise AssertionError("asyncio.to_thread used while USE_ASYNC_DB is on")

    results = {}
    for on in (False, True):
        with monkeypatch.context() as mp:
            db = FakeDB(TABLES)
            _flag(mp, db, on, *modules)
            if on:
                mp.setattr(asyncio, "to_thread", forbidden)
            results[on] = (_plain(asyncio.run(_outcome(make_call()))), db.calls)
    assert results[True] == results[False]


# ── (f) flag off never creates the async client ──────────────────────────────


def test_flag_off_never_initialises_the_async_client(monkeypatch, auth_stub, quiz_banks_stub):
    monkeypatch.setattr(database, "_supabase_async", None)
    db = ThreadedDB(TABLES)
    _flag(monkeypatch, db, False, auth_module, acp, activation_gate)  # async getter raises

    async def admin(_authorization):
        return True  # the full snapshot is admin-only; the guard is not under test

    monkeypatch.setattr(health, "_is_admin", admin)

    async def run():
        statuses = [(await _get(path, "u-active")).status_code for path in ROUTES]
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                     base_url="http://test") as client:
            probe = (await client.get("/health/async-db")).json()
        return statuses, probe

    statuses, probe = asyncio.run(run())
    assert statuses == [200, 200, 200]
    assert probe["use_async_db"] is False
    assert probe["async_client_initialised"] is False


# ── aexecute flag-off cancellation: the query still finishes first ──────────


def test_flag_off_aexecute_cancel_waits_for_the_worker(monkeypatch):
    db = ThreadedDB(TABLES)
    _flag(monkeypatch, db, False)
    gate = LoopGate()
    db.park = gate.park

    async def run():
        task = asyncio.create_task(
            aexecute(lambda c: c.table("users").select("role").eq("id", "u-admin").limit(1)))
        assert await until(lambda: gate.inside == 1)
        task.cancel()
        # Before Revision 3 the call ran to completion before the request could
        # see the cancel; the worker version keeps that: it is still waiting.
        for _ in range(20):
            await asyncio.sleep(0.001)
        still_waiting = not task.done()
        gate.release()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, WAIT)
        return still_waiting

    assert asyncio.run(run()) is True
    assert not gate.timed_out
    assert len(db.calls) == 1, "the query ran to completion"


# ── G4 (T012): same-user user_vocabulary writes stay serialized ─────────────


class _VocabDB:
    """Sync PostgREST double for ``_run_vocab_extraction``. Reads return DEEP
    copies; the insert enforces ``idx_user_vocab_unique`` (user_id,
    lower(headword)) WHERE NOT is_archived, like migration 019. The
    existing-headword read waits (bounded) for the other request's read."""

    def __init__(self):
        self.rows = {
            "users": [{"id": "u-1", "feature_flags": {"vocab_enabled": True}}],
            "sessions": [{"id": "sess-1", "topic": "Hometown"}],
            "user_vocabulary": [],
        }
        self.lock = threading.Lock()
        self.vocab_reads = 0
        self.both_read = threading.Event()
        self.threads: list = []

    def table(self, name):
        owner = self

        class Query:
            op, payload, filters = "select", None, []

            def select(self, *_a):
                return self

            def eq(self, col, val):
                self.filters = self.filters + [(col, val)]
                return self

            def limit(self, *_a):
                return self

            def insert(self, row):
                self.op, self.payload = "insert", row
                return self

            def execute(self):
                owner.threads.append(threading.get_ident())
                if self.op == "insert":
                    with owner.lock:
                        key = (self.payload["user_id"], self.payload["headword"].lower())
                        if any((r["user_id"], r["headword"].lower()) == key and not r["is_archived"]
                               for r in owner.rows[name]):
                            raise RuntimeError("duplicate key value violates unique constraint")
                        owner.rows[name].append(copy.deepcopy(self.payload))
                    return SimpleNamespace(data=[copy.deepcopy(self.payload)])
                if name == "user_vocabulary":
                    with owner.lock:
                        owner.vocab_reads += 1
                        if owner.vocab_reads >= 2:
                            owner.both_read.set()
                    # Unserialized requests both read before either inserts.
                    owner.both_read.wait(0.5)
                with owner.lock:
                    rows = [r for r in owner.rows[name]
                            if all(r.get(c) == v for c, v in self.filters)]
                    return SimpleNamespace(data=copy.deepcopy(rows))

        return Query()


def _vocab_item(headword):
    fields = {
        "headword": headword, "context_sentence": f"I {headword} home.",
        "evidence_substring": headword, "category": "verb", "reason": "good",
        "definition_en": "move fast", "definition_vi": "chạy",
        "original_word": None, "suggestion": None,
    }
    return SimpleNamespace(**fields, model_dump=lambda: dict(fields))


def test_g4_same_user_vocab_inserts_do_not_duplicate_a_lemma(monkeypatch):
    db = _VocabDB()
    monkeypatch.setattr(settings, "USE_ASYNC_DB", False)
    monkeypatch.setattr(database, "supabase_admin", db)
    lemmas = {"ran": "run", "running": "run"}

    async def extract_vocab(transcript, *_a):
        return SimpleNamespace(used_well=[_vocab_item(transcript)], needs_review=[], upgrade_suggested=[])

    def run_all_guards(_item, _transcript, _source, _headwords, *, used_well_headwords,
                       existing_lemmas, new_lemma):
        if new_lemma in existing_lemmas:
            return False, "guard_6_lemma_duplicate"
        return True, None

    monkeypatch.setattr("services.vocab_extractor.extract_vocab", extract_vocab)
    monkeypatch.setattr("services.vocab_guards.run_all_guards", run_all_guards)
    monkeypatch.setattr("services.lemmatizer.lemmatize", lambda word: (lemmas[word], "VERB"))
    monkeypatch.setattr("services.lemmatizer.lemma_version", lambda: "test")
    monkeypatch.setattr("services.vocab_enrichment.enrich_vocabulary_batch", lambda _words: [])

    async def run():
        await asyncio.gather(
            grading._run_vocab_extraction("ran", "resp-1", "u-1", "sess-1"),
            grading._run_vocab_extraction("running", "resp-2", "u-1", "sess-1"),
        )
        return threading.get_ident()

    loop_thread = asyncio.run(run())
    lemmas_saved = [r["lemma"] for r in db.rows["user_vocabulary"]]
    assert lemmas_saved == ["run"], "one row per lemma, as when the loop serialized them"
    assert db.threads and all(t != loop_thread for t in db.threads)


def test_g4_vocab_lock_is_per_user(monkeypatch):
    a, b = grading._vocab_write_lock("u-1"), grading._vocab_write_lock("u-2")
    assert a is grading._vocab_write_lock("u-1")
    assert a is not b
