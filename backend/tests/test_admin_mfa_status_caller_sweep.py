"""GET /admin/mfa/status sweeps the caller (ADMINAAL2-0032 plan.md, FR-010; PC-J101).

The status read runs sweep steps 1 and 2 for the calling admin only, so an
admin's own factor change is audited at once instead of at the next cron run
(PC-J66 F04). The PostgreSQL cases run the real sweep SQL on migration 332 in
a disposable schema (the harness of test_staff_security_sweep.py) through a
SQLAlchemy asyncpg engine, like the backend's ``_db_engine``; the guard, GoTrue
and the Auth admin factor list are the fakes of test_staff_guard.py and
test_staff_security_sweep.py.

Proves: one row per log entry however often the caller asks; the caller pass
neither audits another admin's entries nor moves the shared cursor, and the
cron later adds no duplicate row or alert; the snapshot backstop covers the
caller only, and two passes on one account are serialized, reading the
factor list under the account lock, so a pass that listed before a
verification neither reports the factor deleted nor overwrites the newer
snapshot (PC-J180, SA PR-1936 F1), and a verification that lands while
a pass lists is stamped as seen after its log entry, so it is still audited
and alerted, not taken for a step-up (SA F1-R1); a cursor the cron
has not started is left alone; a cron batch holding the cursor lock (a
warning), a timeout or a broken engine is logged with its code and the route
still answers 200 with the unchanged body, also at AAL1. Under load (SA
PR-1936 F2) concurrent reads by one admin start one pass, a repeat with the
same factor list inside the interval starts none, a worker runs at most
CALLER_MAX_CONCURRENT passes so a suspension still gets a pooled connection
at once, and the Auth factor read is bounded as a whole.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import asyncio
import functools
import logging
import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

import routers.admin as admin_module
import test_migration_332_staff_security_audit as m332
import test_staff_security_sweep as tss
from scripts import staff_security_sweep as sweep
from test_migration_240_core_attempt_evidence import psql

pg = tss.pg   # the disposable migration-332 schema plus a stand-in auth log
run = tss.run
STATUS_KEYS = {"aal", "enforce", "verified_factor_count", "next_step"}


def _engine():
    """An engine like routers.admin._db_engine, connected as the schema owner."""
    url = os.environ["TEST_PG_URL"].replace("postgres://", "postgresql+asyncpg://", 1)
    return create_async_engine(url, poolclass=NullPool,
                               connect_args={"server_settings": {"role": m332.OWNER}})


def _caller(pg, user: str, factors: tss.Factors, *, timeout: float = 60) -> sweep.CallerSummary:
    schema, auth = pg

    async def go():
        engine = _engine()
        try:
            return await sweep.sweep_caller(engine, user, list_factors=factors, timeout=timeout,
                                            schema=schema, auth_schema=auth)
        finally:
            await engine.dispose()

    return run(go())


def _cursor_row(schema: str) -> str:
    return psql(f"SELECT last_created_at || ' ' || last_entry_id FROM "
                f"{schema}.staff_security_sweep_cursor WHERE name = '{sweep.LOG_CURSOR}'")


# ── Through the route (AAL1 is accepted) ────────────────────────────────────

@pytest.fixture(autouse=True)
def _fresh_status_throttle(monkeypatch):
    """Each test starts with no recent or running status pass in this worker."""
    monkeypatch.setattr(sweep, "_caller_recent", {})
    monkeypatch.setattr(sweep, "_caller_running", set())


@pytest.fixture
def status_route(live_activation_gate, monkeypatch):
    """The real guard and route, with the sweep hook pointed at ``engine``/``pg``.
    ``prepare`` returns the app and the caller's bearer token."""
    from config import settings
    from services import activation_gate
    import routers.auth as auth_module
    from tests import test_staff_guard as tsg

    tsg.TOKENS.clear()
    guard_db = tsg._DB()
    for module in (admin_module, activation_gate):
        monkeypatch.setattr(module, "supabase_admin", guard_db)
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: tsg._AuthClient([]))
    monkeypatch.setattr(settings, "ADMIN_AAL2_ENFORCE", True)
    from main import app

    def prepare(admin: str, *, engine, pg=None, factors=None, timeout: float = 60,
                auth_factors=None):
        monkeypatch.setitem(tsg.USERS, admin, {"role": "admin", "is_active": True})
        monkeypatch.setattr(admin_module, "_db_engine", engine)
        if pg is not None:
            schema, auth = pg
            real = functools.partial(
                _REAL_SWEEP_CALLER, list_factors=factors or tss.Factors(), timeout=timeout,
                schema=schema, auth_schema=auth)

            async def counted(engine, user_id, **kwargs):
                prepare.swept.append(user_id)
                return await real(engine, user_id, **kwargs)

            monkeypatch.setattr(sweep, "sweep_caller", counted)
        return app, tsg.accept(admin, tsg.aal1_claims(admin), factors=auth_factors)

    prepare.swept = []   # user ids of the passes the route started
    return prepare


@pytest.fixture
def status_api(status_route):
    def call(admin: str, **kwargs):
        app, token = status_route(admin, **kwargs)
        api = TestClient(app, raise_server_exceptions=False)
        return api.get("/admin/mfa/status", headers={"Authorization": f"Bearer {token}"})

    return call


_REAL_SWEEP_CALLER = sweep.sweep_caller


def _assert_unchanged_aal1_body(response) -> None:
    assert response.status_code == 200, response.text
    assert set(response.json()) == STATUS_KEYS
    assert response.json() == {"aal": "aal1", "enforce": True, "verified_factor_count": 0,
                               "next_step": "enroll"}


def test_the_callers_enrollment_is_audited_once_by_the_status_read_at_aal1(pg, status_api):
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    tss._ready(pg)
    cursor = _cursor_row(schema)
    entry = tss._log(auth, "factor_in_progress", admin, str(uuid4()))
    engine = _engine()

    _assert_unchanged_aal1_body(status_api(admin, engine=engine, pg=pg))
    rows = tss._rows(schema, admin)
    assert [(r["event"], r["detail"]["auth_log_entry_id"], r["detail"]["detected_by"])
            for r in rows] == [("mfa_factor_enrolled", entry, "auth_log")]
    _assert_unchanged_aal1_body(status_api(admin, engine=engine, pg=pg))
    assert tss._rows(schema, admin) == rows
    assert _cursor_row(schema) == cursor, "the caller pass never moves the shared cursor"

    fields, ok = tss._sweep(pg, tss.Factors())
    assert ok and fields["log_rows"] == 0 and tss._rows(schema, admin) == rows
    assert tss._cursor(schema) == entry


# ── Scope: the caller only, the cursor untouched ────────────────────────────

def test_another_admins_entries_are_neither_audited_nor_passed_by_the_caller_pass(pg):
    schema, auth = pg
    caller, other = m332._user(schema, "admin", True), m332._user(schema, "admin", True)
    tss._ready(pg)
    cursor = _cursor_row(schema)
    other_first = tss._log(auth, "factor_in_progress", other, str(uuid4()))
    tss._lifecycle(auth, caller, str(uuid4()))
    other_deleted = tss._log(auth, "factor_deleted", other, str(uuid4()), trait_user=other)
    factors = tss.Factors()

    summary = _caller(pg, caller, factors)
    assert summary.log_error is None and summary.log_rows == 3 and summary.log_entries == 3
    assert [r["event"] for r in tss._rows(schema, caller)] == [
        "mfa_factor_enrolled", "mfa_factor_verified", "mfa_factor_deleted"]
    assert [o["status"] for o in tss._alerts(schema, caller)] == ["pending", "pending"]
    assert tss._rows(schema, other) == [] and tss._alerts(schema, other) == []
    assert _cursor_row(schema) == cursor
    assert factors.calls == [caller], "only the caller's factor list is read"

    sender = tss.Sender()
    fields, ok = tss._sweep(pg, tss.Factors(), sender=sender)
    assert ok and fields["log_entries"] == 5 and fields["log_rows"] == 2
    assert [r["detail"]["auth_log_entry_id"] for r in tss._rows(schema, other)] == [
        other_first, other_deleted]
    assert len(tss._rows(schema, caller)) == 3, "the cron adds no duplicate"
    assert [o["status"] for o in tss._alerts(schema, caller)] == ["sent", "sent"]
    assert len(sender.calls) == 3   # caller verified + deleted, other deleted
    assert tss._cursor(schema) == other_deleted


def test_a_cursor_the_cron_has_not_started_is_left_alone(pg):
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    tss._log(auth, "factor_in_progress", admin, str(uuid4()))
    summary = _caller(pg, admin, tss.Factors())
    assert summary.log_skipped == "cursor_uninitialized"
    assert summary.snapshot_skipped == "not_seeded"
    assert tss._rows(schema, admin) == []
    assert psql(f"SELECT count(*) FROM {schema}.staff_security_sweep_cursor") == "0"


def test_the_snapshot_backstop_reconciles_the_caller_only(pg, caplog):
    schema, auth = pg
    caller, other = m332._user(schema, "admin", True), m332._user(schema, "admin", True)
    factors = tss.Factors()
    tss._ready(pg, factors)
    missed_caller, missed_other = str(uuid4()), str(uuid4())   # no log entry: the log missed them
    factors.set(caller, (missed_caller, "verified"))
    factors.set(other, (missed_other, "verified"))
    factors.calls.clear()

    with caplog.at_level(logging.ERROR, logger="staff_security_sweep"):
        summary = _caller(pg, caller, factors)
    assert summary.snapshot_error is None and summary.snapshot_factor_diffs == 2
    assert factors.calls == [caller]
    assert [(r["event"], r["detail"]["detected_by"]) for r in tss._rows(schema, caller)] == [
        ("mfa_factor_enrolled", "snapshot"), ("mfa_factor_verified", "snapshot")]
    assert tss._rows(schema, other) == []
    assert f"staff_security_sweep_log_missed_event event=mfa_factor_verified user_id={caller}" \
        in caplog.text
    assert _caller(pg, caller, factors).snapshot_factor_diffs == 0

    fields, ok = tss._sweep(pg, factors)
    assert ok and fields["snapshot_factor_diffs"] == 2
    assert len(tss._rows(schema, caller)) == 2 and len(tss._rows(schema, other)) == 2


def test_the_snapshot_pass_takes_the_per_account_lock_the_cron_also_takes(pg):
    """An account with no snapshot row yet has nothing for FOR UPDATE to lock,
    so two passes (cron + status, or two tabs) are serialized by a per-account
    advisory lock instead; held elsewhere, the caller's snapshot step times out."""
    schema, _ = pg
    admin = m332._user(schema, "admin", True)
    factors = tss.Factors()
    tss._ready(pg, factors)
    factors.set(admin, (str(uuid4()), "verified"))   # missed by the log

    async def held():
        holder = await tss._conn()
        engine = _engine()
        try:
            async with holder.transaction():
                await holder.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                                     f"{schema}.staff_mfa_factor_snapshot:{admin}")
                return await sweep.sweep_caller(engine, admin, list_factors=factors, timeout=60,
                                                schema=schema, auth_schema=pg[1])
        finally:
            await engine.dispose()
            await holder.close()

    summary = run(held())
    assert summary.log_error is None and summary.snapshot_error == "LockNotAvailableError[55P03]"
    assert tss._rows(schema, admin) == []

    async def two_at_once():
        engines = [_engine(), _engine()]
        try:
            return await asyncio.gather(*(
                sweep.sweep_caller(e, admin, list_factors=factors, timeout=60, schema=schema,
                                   auth_schema=pg[1]) for e in engines))
        finally:
            for e in engines:
                await e.dispose()

    results = run(two_at_once())
    assert sorted(r.snapshot_factor_diffs for r in results) == [0, 2]
    assert [r["event"] for r in tss._rows(schema, admin)] == [
        "mfa_factor_enrolled", "mfa_factor_verified"]
    assert [o["event"] for o in tss._alerts(schema, admin)] == ["mfa_factor_verified"]


class _GoTrue(tss.Factors):
    """The Auth admin factor list as of each call. The first read is ``stale``:
    it returns the list as it was, then answers only once ``release()`` is
    true, like a slow Auth admin API response."""

    def __init__(self, release) -> None:
        super().__init__()
        self.release = release
        self.stale_read = asyncio.Event()

    async def __call__(self, user: str) -> list[dict]:
        listed = list(self.by_user.get(user, []))
        self.calls.append(user)
        if len(self.calls) == 1:
            self.stale_read.set()
            for _ in range(600):
                if await self.release():
                    break
                await asyncio.sleep(0.05)
        return listed


async def _waiting_on_the_account_lock() -> bool:
    """Another pass is queued on an account's advisory snapshot lock. Read as
    the cluster superuser: other sessions' wait events are hidden from the
    schema owner."""
    import asyncpg
    conn = await asyncpg.connect(os.environ["TEST_PG_URL"], statement_cache_size=0)
    try:
        return bool(await conn.fetchval(
            "SELECT count(*) FROM pg_stat_activity "
            "WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'"))
    finally:
        await conn.close()


def _verify_while_the_first_pass_lists(pg, first, monkeypatch):
    """SA PR-1936 F1: pass A reads the factor list before the admin's factor X
    is verified; pass B (a second status read) reads it after and saves.
    A's stale empty list must neither report X deleted nor overwrite B's
    newer snapshot, whichever pass ends up holding the account lock first."""
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    tss._ready(pg)
    factor = str(uuid4())
    # A host pause must not turn B's wait for A's lock into a timeout.
    monkeypatch.setattr(sweep, "CALLER_LOCK_TIMEOUT", "60s")
    monkeypatch.setattr(sweep, "CALLER_STATEMENT_TIMEOUT", "60s")
    b_done = asyncio.Event()

    async def release() -> bool:
        return b_done.is_set() or await _waiting_on_the_account_lock()

    factors = _GoTrue(release)

    async def go():
        engine = _engine()
        try:
            a = asyncio.ensure_future(first(engine, admin, factors))
            await asyncio.wait_for(factors.stale_read.wait(), 60)
            tss._log(auth, "factor_in_progress", admin, factor)
            tss._log(auth, "verification_attempted", admin, factor)
            factors.set(admin, (factor, "verified"))
            b = await sweep.sweep_caller(engine, admin, list_factors=factors, timeout=60,
                                         schema=schema, auth_schema=auth)
            b_done.set()
            return await a, b
        finally:
            await engine.dispose()

    a, b = run(go())
    assert b.snapshot_error is None and b.snapshot_factor_diffs == 0
    assert [(r["event"], r["detail"]["detected_by"]) for r in tss._rows(schema, admin)] == [
        ("mfa_factor_enrolled", "auth_log"), ("mfa_factor_verified", "auth_log")], \
        "no mfa_factor_deleted for a factor that was never removed"
    assert [o["event"] for o in tss._alerts(schema, admin)] == ["mfa_factor_verified"]
    assert psql(f"SELECT factor_id || ' ' || status FROM {schema}.staff_mfa_factor_snapshot "
                f"WHERE user_id = '{admin}'") == f"{factor} verified", \
        "the newer snapshot is not overwritten by the stale list"
    return a, admin, factors


def test_two_status_reads_racing_a_verification_report_no_false_deletion(pg, monkeypatch):
    async def status_read(engine, admin, factors):
        return await sweep.sweep_caller(engine, admin, list_factors=factors, timeout=60,
                                        schema=pg[0], auth_schema=pg[1])

    a, _, _ = _verify_while_the_first_pass_lists(pg, status_read, monkeypatch)
    assert a.snapshot_error is None and a.snapshot_factor_diffs == 0


def test_the_cron_racing_a_status_read_reports_no_false_deletion(pg, monkeypatch):
    async def cron(engine, admin, factors):
        conn = await tss._conn()
        try:
            return await sweep.run_sweep(conn, factors, schema=pg[0], auth_schema=pg[1],
                                         config=tss.CONFIG, send=tss.Sender(), lag_seconds=0)
        finally:
            await conn.close()

    (fields, ok), _, _ = _verify_while_the_first_pass_lists(pg, cron, monkeypatch)
    assert ok and fields["snapshot_factor_diffs"] == 0 and fields["snapshot_errors"] == 0


def test_a_verification_landing_while_the_locked_pass_lists_is_still_audited_and_alerted(pg):
    """SA PR-1936 F1-R1: the snapshot pass begins its transaction before it
    waits for the account lock and reads the factor list, so a verification
    can land in between. Stamped with the transaction start, the snapshot would
    look verified BEFORE the verification's own log entry, and the next log
    step would take that entry for a step-up sign-in: no
    mfa_factor_verified row and no FR-011 alert, ever."""
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    tss._ready(pg)
    factor = str(uuid4())

    class VerifiesDuringTheRead(tss.Factors):
        async def __call__(self, user: str) -> list[dict]:
            self.calls.append(user)
            if len(self.calls) == 1:   # the admin verifies while Auth answers
                tss._log(auth, "factor_in_progress", admin, factor)
                tss._log(auth, "verification_attempted", admin, factor)
                self.set(admin, (factor, "verified"))
            return self.by_user.get(user, [])

    factors = VerifiesDuringTheRead()
    first = _caller(pg, admin, factors)
    assert first.snapshot_error is None and first.snapshot_factor_diffs == 0
    assert psql(f"""SELECT s.seen_at > e.created_at
                      FROM {schema}.staff_mfa_factor_snapshot s, {auth}.audit_log_entries e
                     WHERE s.factor_id = '{factor}'
                       AND e.payload::jsonb ->> 'action' = 'verification_attempted'""") == "t", \
        "the snapshot is stamped when the list was read, not when its transaction began"

    second = _caller(pg, admin, factors)   # the next status read: log step, lag 0
    assert second.log_error is None and second.log_rows == 2
    assert [(r["event"], r["detail"]["detected_by"]) for r in tss._rows(schema, admin)] == [
        ("mfa_factor_enrolled", "auth_log"), ("mfa_factor_verified", "auth_log")]
    assert [o["event"] for o in tss._alerts(schema, admin)] == ["mfa_factor_verified"]
    fields, ok = tss._sweep(pg, factors)
    assert ok and fields["log_rows"] == 0 and len(tss._rows(schema, admin)) == 2


def test_a_non_admin_caller_gets_no_snapshot_pass(pg):
    schema, _ = pg
    user = m332._user(schema, "user", True)
    tss._ready(pg)
    factors = tss.Factors()
    summary = _caller(pg, user, factors)
    assert summary.snapshot_skipped == "not_admin" and factors.calls == []


# ── Load: per-account throttle and per-worker cap (SA PR-1936 F2) ──────────

async def _get_status(app, token: str):
    import httpx
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get("/admin/mfa/status", headers={"Authorization": f"Bearer {token}"})


async def _until(predicate, timeout: float = 30) -> bool:
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        if asyncio.get_running_loop().time() > deadline:
            return False
        await asyncio.sleep(0.02)
    return True


class _HeldAuth(tss.Factors):
    """An Auth admin API that answers only once ``gate`` is set, counting the
    reads in flight."""

    def __init__(self) -> None:
        super().__init__()
        self.gate: asyncio.Event | None = None
        self.in_flight = self.peak = 0

    async def __call__(self, user: str) -> list[dict]:
        self.calls.append(user)
        self.in_flight += 1
        self.peak = max(self.peak, self.in_flight)
        try:
            await asyncio.wait_for(self.gate.wait(), 60)
            return self.by_user.get(user, [])
        finally:
            self.in_flight -= 1


def test_concurrent_status_reads_of_one_admin_start_one_pass(pg, status_route, monkeypatch):
    """20 reads at once start one pass; the rest answer at once with the same
    body. A repeated read inside CALLER_MIN_INTERVAL_SECONDS is skipped too,
    unless the factor list GoTrue returned with the caller changed."""
    schema, _ = pg
    admin = m332._user(schema, "admin", True)
    tss._ready(pg)
    factors = _HeldAuth()
    engine = _engine()
    app, token = status_route(admin, engine=engine, pg=pg, factors=factors)
    clock = [1000.0]
    monkeypatch.setattr(sweep, "_clock", lambda: clock[0])

    async def go():
        factors.gate = asyncio.Event()
        try:
            reads = [asyncio.ensure_future(_get_status(app, token)) for _ in range(20)]
            assert await _until(lambda: factors.in_flight == 1
                                and sum(r.done() for r in reads) == 19), \
                "every read but the pass's own answers without waiting for it"
            factors.gate.set()
            return await asyncio.gather(*reads)
        finally:
            factors.gate.set()
            await engine.dispose()

    for response in run(go()):
        _assert_unchanged_aal1_body(response)
    assert status_route.swept == [admin] and factors.calls == [admin]

    _assert_unchanged_aal1_body(TestClient(app).get(
        "/admin/mfa/status", headers={"Authorization": f"Bearer {token}"}))
    assert status_route.swept == [admin], "a repeated read inside the interval is skipped"

    factors.gate = asyncio.Event()
    factors.gate.set()   # from here on the Auth admin API answers at once
    _, enrolled = status_route(admin, engine=_engine(), auth_factors=[
        {"id": str(uuid4()), "factor_type": "totp", "status": "unverified"}])
    assert TestClient(app).get("/admin/mfa/status",
                               headers={"Authorization": f"Bearer {enrolled}"}).status_code == 200
    assert status_route.swept == [admin, admin], "a changed factor list is swept at once"

    clock[0] += sweep.CALLER_MIN_INTERVAL_SECONDS
    _assert_unchanged_aal1_body(TestClient(app).get(
        "/admin/mfa/status", headers={"Authorization": f"Bearer {token}"}))
    assert status_route.swept == [admin, admin, admin], "the interval over, it sweeps again"


def _pooled_engine():
    """routers.admin._db_engine's pool (create_async_engine defaults: 5 + 10)."""
    url = os.environ["TEST_PG_URL"].replace("postgres://", "postgresql+asyncpg://", 1)
    return create_async_engine(url, connect_args={"server_settings": {"role": m332.OWNER}})


def test_status_reads_by_many_admins_leave_the_pool_to_a_suspension(pg, status_route, caplog,
                                                                    capsys):
    """30 admins' reads at once while the Auth admin API hangs: this worker
    runs CALLER_MAX_CONCURRENT passes and skips the rest, so the suspension's
    account lock (services.staff_security.target_lock, the first DB step of
    PATCH /admin/users/{id}/active) still gets a pooled connection at once.
    Before, every read held a connection through the Auth read and the
    suspension waited for the pool."""
    from services import staff_security
    import time

    schema, _ = pg
    admins = [m332._user(schema, "admin", True) for _ in range(30)]
    tss._ready(pg)
    factors = _HeldAuth()
    engine = _pooled_engine()
    tokens = []
    for i, admin in enumerate(admins):
        app, token = status_route(admin, engine=engine, pg=pg if i == 0 else None,
                                  factors=factors)
        tokens.append(token)

    async def suspension_lock() -> float:
        started = time.monotonic()
        async with staff_security.target_lock(engine, str(uuid4())):
            pass
        return time.monotonic() - started

    async def go():
        factors.gate = asyncio.Event()
        try:
            idle = await suspension_lock()
            reads = [asyncio.ensure_future(_get_status(app, t)) for t in tokens]
            # The passes that run hold their connections in the Auth read.
            await _until(lambda: factors.in_flight >= sweep.CALLER_MAX_CONCURRENT
                         and sum(r.done() for r in reads) >= len(reads) - factors.in_flight,
                         timeout=10)
            try:
                loaded = await asyncio.wait_for(suspension_lock(), 10)
            except asyncio.TimeoutError:
                loaded = None
            peak = factors.peak
            factors.gate.set()
            return idle, loaded, peak, await asyncio.gather(*reads)
        finally:
            factors.gate.set()
            await engine.dispose()

    with caplog.at_level(logging.WARNING, logger="staff_security_sweep"):
        idle, loaded, peak, responses = run(go())
    with capsys.disabled():
        print(f"\n[F2] suspension lock idle={idle * 1000:.0f}ms under 30 status reads="
              f"{'blocked >10s' if loaded is None else f'{loaded * 1000:.0f}ms'} "
              f"auth_reads_in_flight_peak={peak}")
    assert loaded is not None, "the suspension waited for a pooled connection"
    assert peak == sweep.CALLER_MAX_CONCURRENT
    assert len(status_route.swept) == sweep.CALLER_MAX_CONCURRENT
    assert all(r.status_code == 200 for r in responses)
    assert caplog.text.count("staff_security_sweep_caller_skipped") == \
        len(admins) - sweep.CALLER_MAX_CONCURRENT
    assert "reason=busy" in caplog.text


def test_the_auth_factor_read_is_bounded_as_a_whole(pg, monkeypatch):
    """httpx's timeout bounds each phase; a read that keeps the connection
    alive (or hangs between phases) must still end the snapshot step within
    CALLER_HTTP_TIMEOUT_SECONDS, well inside the route's overall bound."""
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    tss._ready(pg)
    hang = []

    async def never_answers(user: str) -> list[dict]:
        hang.append(user)
        await asyncio.Event().wait()

    monkeypatch.setattr(sweep, "auth_admin_factor_lister", lambda *_a: never_answers)
    monkeypatch.setattr(sweep, "CALLER_HTTP_TIMEOUT_SECONDS", 0.3)

    async def go():
        engine = _engine()
        try:
            return await sweep.sweep_caller(engine, admin, timeout=10, schema=schema,
                                            auth_schema=auth)
        finally:
            await engine.dispose()

    summary = run(go())
    assert hang == [admin]
    assert summary is not None, "the read is bounded before the route's overall timeout"
    assert summary.log_error is None and summary.snapshot_error == "TimeoutError"


# ── Failures never fail the status read ─────────────────────────────────────

def test_a_cron_batch_holding_the_cursor_lock_fails_only_the_log_step(pg, caplog):
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    tss._ready(pg)
    tss._log(auth, "factor_in_progress", admin, str(uuid4()))

    async def go():
        holder = await tss._conn()
        engine = _engine()
        try:
            async with holder.transaction():
                await holder.fetchrow(f"SELECT 1 FROM {schema}.staff_security_sweep_cursor "
                                      f"WHERE name = $1 FOR UPDATE", sweep.LOG_CURSOR)
                return await sweep.sweep_caller(engine, admin, list_factors=tss.Factors(),
                                                timeout=60, schema=schema, auth_schema=auth)
        finally:
            await engine.dispose()
            await holder.close()

    with caplog.at_level(logging.WARNING, logger="staff_security_sweep"):
        summary = run(go())
    assert summary.log_error == "LockNotAvailableError[55P03]"
    assert summary.snapshot_error is None and summary.snapshot_skipped is None
    # A lock held by the cron is expected and left to it: a warning, not an
    # error (CR/SA P3 on PR-1936).
    failed = [r for r in caplog.records
              if r.getMessage() == (f"staff_security_sweep_caller_step_failed step=log "
                                    f"user_id={admin} error=LockNotAvailableError[55P03]")]
    assert [r.levelno for r in failed] == [logging.WARNING]
    assert tss._rows(schema, admin) == []
    fields, ok = tss._sweep(pg, tss.Factors())
    assert ok and fields["log_rows"] == 1, "the cron still audits it"


def test_a_sweep_timeout_still_answers_200_and_logs_the_code(pg, status_api, caplog):
    schema, _ = pg
    admin = m332._user(schema, "admin", True)
    tss._ready(pg)

    class Stuck(tss.Factors):
        async def __call__(self, user):
            await asyncio.sleep(30)

    with caplog.at_level(logging.ERROR, logger="staff_security_sweep"):
        response = status_api(admin, engine=_engine(), pg=pg, factors=Stuck(), timeout=0.5)
    _assert_unchanged_aal1_body(response)
    assert f"staff_security_sweep_caller_failed user_id={admin} error=timeout" in caplog.text


def test_a_broken_engine_still_answers_200_and_logs_the_code(status_api, caplog):
    class Broken:
        def connect(self):
            raise ConnectionRefusedError("database down")

    admin = str(uuid4())
    with caplog.at_level(logging.ERROR, logger="staff_security_sweep"):
        _assert_unchanged_aal1_body(status_api(admin, engine=Broken()))
    assert (f"staff_security_sweep_caller_failed user_id={admin} "
            f"error=ConnectionRefusedError") in caplog.text


def test_without_a_database_engine_the_sweep_is_skipped_and_logged_once(status_api, monkeypatch,
                                                                       caplog):
    monkeypatch.setattr(sweep, "_caller_no_db_logged", False)
    # Two admins: a second read by the same one would now be throttled before
    # it reaches the hook.
    with caplog.at_level(logging.ERROR, logger="staff_security_sweep"):
        _assert_unchanged_aal1_body(status_api(str(uuid4()), engine=None))
        _assert_unchanged_aal1_body(status_api(str(uuid4()), engine=None))
    assert caplog.text.count("staff_security_sweep_caller_unavailable error=no_database_url") == 1


def test_an_id_that_is_not_a_uuid_is_logged_not_swept(caplog):
    class Untouched:
        def connect(self):
            raise AssertionError("no connection for an invalid id")

    with caplog.at_level(logging.ERROR, logger="staff_security_sweep"):
        assert run(sweep.sweep_caller(Untouched(), "admin-active")) is None
    assert "staff_security_sweep_caller_failed error=invalid_user_id" in caplog.text
