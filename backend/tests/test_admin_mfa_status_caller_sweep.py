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
caller only, and two passes on one account are serialized; a cursor the cron
has not started is left alone; a cron batch holding the cursor lock, a
timeout or a broken engine is logged with its code and the route still
answers 200 with the unchanged body, also at AAL1.

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

@pytest.fixture
def status_api(live_activation_gate, monkeypatch):
    """The real guard and route, with the sweep hook pointed at ``engine``/``pg``."""
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

    def call(admin: str, *, engine, pg=None, factors=None, timeout: float = 60):
        monkeypatch.setitem(tsg.USERS, admin, {"role": "admin", "is_active": True})
        monkeypatch.setattr(admin_module, "_db_engine", engine)
        if pg is not None:
            schema, auth = pg
            monkeypatch.setattr(sweep, "sweep_caller", functools.partial(
                _REAL_SWEEP_CALLER, list_factors=factors or tss.Factors(), timeout=timeout,
                schema=schema, auth_schema=auth))
        token = tsg.accept(admin, tsg.aal1_claims(admin))
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


def test_a_non_admin_caller_gets_no_snapshot_pass(pg):
    schema, _ = pg
    user = m332._user(schema, "user", True)
    tss._ready(pg)
    factors = tss.Factors()
    summary = _caller(pg, user, factors)
    assert summary.snapshot_skipped == "not_admin" and factors.calls == []


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

    with caplog.at_level(logging.ERROR, logger="staff_security_sweep"):
        summary = run(go())
    assert summary.log_error == "LockNotAvailableError[55P03]"
    assert summary.snapshot_error is None and summary.snapshot_skipped is None
    assert (f"staff_security_sweep_caller_step_failed step=log user_id={admin} "
            f"error=LockNotAvailableError[55P03]") in caplog.text
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
    admin = str(uuid4())
    with caplog.at_level(logging.ERROR, logger="staff_security_sweep"):
        _assert_unchanged_aal1_body(status_api(admin, engine=None))
        _assert_unchanged_aal1_body(status_api(admin, engine=None))
    assert caplog.text.count("staff_security_sweep_caller_unavailable error=no_database_url") == 1


def test_an_id_that_is_not_a_uuid_is_logged_not_swept(caplog):
    class Untouched:
        def connect(self):
            raise AssertionError("no connection for an invalid id")

    with caplog.at_level(logging.ERROR, logger="staff_security_sweep"):
        assert run(sweep.sweep_caller(Untouched(), "admin-active")) is None
    assert "staff_security_sweep_caller_failed error=invalid_user_id" in caplog.text
