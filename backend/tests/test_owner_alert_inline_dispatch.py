"""Owner alerts sent right after a committed staff-security change
(ADMINAAL2-0032 FR-011, plan.md "Dispatch runs inline right after a committed
API change"; PC-J102, PC-J66 F04 hook 2).

Route half: the suspend / reactivate, role and revoke-sessions routes of the
in-memory harness in test_admin_staff_security_routes.py hand the audit ids
they committed to ``owner_alerts.dispatch_committed`` as a background task.
The outbox is that harness's table behind a store with PgOutboxStore's
compare-and-set rules, and the transport is a fake Resend (never the real
one): one e-mail per alert, the row ends ``sent``, the cron right after sends
nothing, a refused send leaves the row to the cron under the usual backoff and
the response is the same as without dispatch, two dispatchers send one e-mail,
and a missing transport touches nothing and logs once.

PostgreSQL half: ``dispatch_committed`` on a real SQLAlchemy asyncpg engine
against migration 332's outbox (the claim commits before the send, concurrent
inline and cron dispatch send once). Set TEST_PG_URL to a LOCAL disposable
cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

import pytest

import test_owner_alerts as toa
from services import owner_alerts as oa
from test_admin_staff_security_routes import (  # noqa: F401 (fixtures)
    ADMIN2,
    AUTH,
    INSTRUCTOR,
    _active,
    client,
    db,
    engine,
)

OWNER = "owner@example.com"


class TableStore:
    """The harness's ``owner_alert_outbox`` rows, claimed and marked with the
    same compare-and-set rules as ``PgOutboxStore``. ``now`` is a fake clock
    in seconds."""

    def __init__(self, db) -> None:
        self.db = db
        self.now = 0.0
        self.opened = 0

    @property
    def rows(self) -> list[dict]:
        rows = self.db.tables["owner_alert_outbox"]
        for r in rows:
            r.setdefault("attempts", 0)
            r.setdefault("next", 0.0)
            r.setdefault("last_error", None)
        return rows

    def _row(self, row_id):
        return next(r for r in self.rows if r["id"] == row_id)

    def _due(self, rows, max_attempts):
        return [{"id": r["id"], "audit_id": r["audit_id"], "payload": r["payload"],
                 "attempts": r["attempts"]}
                for r in rows
                if r["status"] != "sent" and r["next"] <= self.now
                and (r["attempts"] < max_attempts or r["status"] == "pending")]

    async def due(self, *, max_attempts, limit):
        await asyncio.sleep(0)
        return self._due(self.rows, max_attempts)[:limit]

    async def due_for_audits(self, audit_ids, *, max_attempts):
        await asyncio.sleep(0)
        return self._due([r for r in self.rows if r["audit_id"] in set(audit_ids)], max_attempts)

    async def claim(self, row_id, attempts, lease_seconds):
        await asyncio.sleep(0)
        row = self._row(row_id)
        if row["attempts"] != attempts or row["status"] == "sent":
            return False
        row.update(attempts=attempts + 1, status="pending", next=self.now + lease_seconds)
        return True

    async def reclaim_final(self, row_id, attempts, lease_seconds):
        await asyncio.sleep(0)
        row = self._row(row_id)
        if row["attempts"] != attempts or row["status"] != "pending" or row["next"] > self.now:
            return False
        row["next"] = self.now + lease_seconds
        return True

    async def mark_sent(self, row_id, attempts):
        row = self._row(row_id)
        if row["attempts"] == attempts:
            row.update(status="sent", last_error=None)

    async def mark_failed(self, row_id, attempts, error, retry_seconds):
        row = self._row(row_id)
        if row["attempts"] == attempts and row["status"] != "sent":
            row.update(status="failed", last_error=error, next=self.now + retry_seconds)


@pytest.fixture
def transport(monkeypatch):
    """A configured transport whose sends go to a fake Resend."""
    monkeypatch.setenv("OWNER_ALERT_EMAILS", OWNER)
    monkeypatch.setenv("RESEND_API_KEY", toa.KEY)
    resend = toa.FakeResend()
    monkeypatch.setattr(oa, "send_via_resend", resend)
    monkeypatch.setattr(oa, "_inline_skip_logged", set())
    return resend


@pytest.fixture
def store(monkeypatch, db, engine):
    """``engine_store`` on the harness's outbox; only the route's engine opens it."""
    table = TableStore(db)

    @asynccontextmanager
    async def fake_engine_store(eng, schema="public"):
        assert eng is engine and schema == "public"
        table.opened += 1
        yield table

    monkeypatch.setattr(oa, "engine_store", fake_engine_store)
    return table


def _outbox(db) -> list[dict]:
    return db.tables["owner_alert_outbox"]


def _cron(store, **kw):
    return asyncio.run(oa.dispatch_due(store, config=toa._config(), send=oa.send_via_resend, **kw))


def _role(client, uid, role):
    return client.patch(f"/admin/users/{uid}/role", json={"role": role}, headers=AUTH)


# ── After the commit, before the cron ────────────────────────────────────────

class TestSentRightAfterTheChange:
    def test_suspension_sends_one_email_and_marks_the_row_sent(self, client, db, store, transport):
        r = _active(client, ADMIN2, False)
        assert r.status_code == 200, r.text
        [row] = _outbox(db)
        assert row["audit_id"] == r.json()["audit_id"]
        assert (row["status"], row["attempts"]) == ("sent", 1)
        assert transport.calls == [f"owner-alert-{row['id']}"]
        assert transport.delivered == transport.calls

    def test_the_cron_right_after_sends_nothing_again(self, client, db, store, transport):
        assert _active(client, ADMIN2, False).status_code == 200
        summary = _cron(store)
        assert (summary.due, summary.sent) == (0, 0)
        store.now += 10 * 86400          # also long after: a sent row is never due
        assert _cron(store).due == 0
        assert len(transport.calls) == 1

    def test_reactivation_and_role_change_alert_inline(self, client, db, store, transport):
        assert _active(client, ADMIN2, False).status_code == 200
        assert _active(client, ADMIN2, True).status_code == 200
        r = _role(client, ADMIN2, "instructor")
        assert r.status_code == 200, r.text
        assert [o["event"] for o in _outbox(db)] == ["active_changed", "active_changed", "role_changed"]
        assert {o["status"] for o in _outbox(db)} == {"sent"}
        assert len(transport.delivered) == 3

    def test_a_revocation_failure_alert_is_sent_with_the_change(self, client, db, engine, store,
                                                                 transport):
        engine.fail = True               # auth.sessions unreachable
        r = _active(client, ADMIN2, False)
        assert r.status_code == 200, r.text
        assert r.json()["sessions_revoked"] is False
        events = sorted(o["event"] for o in _outbox(db))
        assert events == ["active_changed", "sessions_revoke_failed"]
        assert {o["status"] for o in _outbox(db)} == {"sent"}
        assert len(transport.delivered) == 2

    def test_a_failed_reactivation_revocation_is_alerted_inline(self, client, db, engine, store,
                                                                transport):
        assert _active(client, INSTRUCTOR, False).status_code == 200
        engine.fail = True
        r = _active(client, INSTRUCTOR, True)
        assert r.status_code == 200 and r.json()["ok"] is False
        # Instructor privilege events are audit-only (Q4); the revocation
        # failure is not.
        [row] = _outbox(db)
        assert (row["event"], row["status"]) == ("sessions_revoke_failed", "sent")
        assert len(transport.delivered) == 1

    def test_a_failed_retry_is_alerted_inline(self, client, db, engine, store, transport):
        engine.fail = True
        r = client.post(f"/admin/users/{INSTRUCTOR}/revoke-sessions", json={}, headers=AUTH)
        assert r.status_code == 200 and r.json()["sessions_revoked"] is False
        [row] = _outbox(db)
        assert (row["audit_id"], row["status"]) == (r.json()["audit_id"], "sent")
        assert len(transport.delivered) == 1

    def test_a_change_without_an_alert_or_a_no_op_sends_nothing(self, client, db, store, transport):
        assert _active(client, INSTRUCTOR, False).status_code == 200   # audit-only event
        assert _role(client, INSTRUCTOR, "instructor").status_code == 200   # no change
        assert transport.calls == [] and _outbox(db) == []

    def test_only_the_rows_this_request_committed_are_sent(self, client, db, store, transport):
        # An alert some other change left for the cron (e.g. out of band).
        db.tables["owner_alert_outbox"].append({
            "id": "other-row", "audit_id": "other-audit", "event": "role_changed",
            "payload": {"event": "role_changed"}, "status": "pending"})
        assert _active(client, ADMIN2, False).status_code == 200
        other = next(o for o in _outbox(db) if o["id"] == "other-row")
        assert (other["status"], other["attempts"]) == ("pending", 0)
        assert len(transport.calls) == 1


# ── Failures stay with the cron ──────────────────────────────────────────────

class TestFailuresStayWithTheCron:
    def test_a_refused_send_keeps_the_response_and_leaves_the_row_to_retry(
            self, client, db, store, transport, monkeypatch):
        monkeypatch.setenv("RESEND_API_KEY", "")
        unconfigured = _active(client, ADMIN2, False).json()
        assert _active(client, ADMIN2, True).status_code == 200
        db.tables["owner_alert_outbox"].clear()
        db.tables["staff_security_audit"].clear()
        monkeypatch.setenv("RESEND_API_KEY", toa.KEY)
        transport.refusals.append(oa.SendResult(False, "http_403:validation_error"))

        r = _active(client, ADMIN2, False)
        assert r.status_code == 200
        body = r.json()
        for key in ("audit_id", "suspended_at"):
            body.pop(key), unconfigured.pop(key)
        assert body == unconfigured
        [row] = _outbox(db)
        # Attempt 1 is spent by the usual rule; the cron retries after the backoff.
        assert (row["status"], row["attempts"], row["last_error"]) == (
            "failed", 1, "http_403:validation_error")
        assert row["next"] == store.now + oa.backoff_seconds(1)
        assert _cron(store).due == 0
        store.now += oa.backoff_seconds(1)
        summary = _cron(store)
        assert (summary.due, summary.sent) == (1, 1)
        assert (row["status"], row["attempts"]) == ("sent", 2)
        assert transport.delivered == [f"owner-alert-{row['id']}"]

    def test_a_store_failure_is_logged_and_the_row_stays_due(
            self, client, db, transport, monkeypatch, caplog):
        @asynccontextmanager
        async def broken(eng, schema="public"):
            raise ConnectionRefusedError("database down")
            yield  # pragma: no cover

        monkeypatch.setattr(oa, "engine_store", broken)
        with caplog.at_level(logging.ERROR, logger="owner_alerts"):
            r = _active(client, ADMIN2, False)
        assert r.status_code == 200 and r.json()["ok"] is True
        [row] = _outbox(db)
        assert row["status"] == "pending" and transport.calls == []
        assert "owner_alert_inline_dispatch_failed" in caplog.text
        assert "database down" not in caplog.text
        assert _cron(TableStore(db)).sent == 1

    @pytest.mark.parametrize("missing", ["RESEND_API_KEY", "OWNER_ALERT_EMAILS"])
    def test_without_a_transport_nothing_is_touched_and_it_is_logged_once(
            self, client, db, store, transport, monkeypatch, caplog, missing):
        monkeypatch.setenv(missing, "")
        with caplog.at_level(logging.WARNING, logger="owner_alerts"):
            assert _active(client, ADMIN2, False).status_code == 200
            assert _active(client, ADMIN2, True).status_code == 200
        assert store.opened == 0 and transport.calls == []
        assert {o["status"] for o in _outbox(db)} == {"pending"}
        skipped = [m for m in caplog.messages if "owner_alert_inline_dispatch_skipped" in m]
        assert skipped == [f"owner_alert_inline_dispatch_skipped missing={missing}: "
                           "the cron sends these alerts"]
        assert toa.KEY not in caplog.text

    def test_without_the_direct_connection_nothing_is_sent_and_it_is_logged_once(
            self, transport, caplog):
        with caplog.at_level(logging.WARNING, logger="owner_alerts"):
            for _ in range(2):
                assert asyncio.run(oa.dispatch_committed(None, ["a"], config=toa._config())) is None
        assert [m for m in caplog.messages if "skipped" in m] == [
            "owner_alert_inline_dispatch_skipped no_direct_connection: the cron sends these alerts"]
        assert transport.calls == []


# ── Concurrent dispatchers ───────────────────────────────────────────────────

def _pending_alert(db, store) -> str:
    db.tables["owner_alert_outbox"].append({
        "id": "row-1", "audit_id": "audit-1", "event": "role_changed",
        "payload": toa._payload(), "status": "pending"})
    return "audit-1"


class TestConcurrentDispatch:
    def test_two_inline_dispatches_send_one_email(self, db, engine, store, transport):
        audit = _pending_alert(db, store)

        async def go():
            return await asyncio.gather(*(oa.dispatch_committed(engine, [audit]) for _ in range(2)))

        first, second = asyncio.run(go())
        assert sorted([first.sent, second.sent]) == [0, 1]
        assert first.skipped_claimed + second.skipped_claimed == 1
        assert transport.calls == ["owner-alert-row-1"]
        assert (_outbox(db)[0]["status"], _outbox(db)[0]["attempts"]) == ("sent", 1)

    def test_inline_and_cron_at_the_same_moment_send_one_email(self, db, engine, store, transport):
        audit = _pending_alert(db, store)

        async def go():
            return await asyncio.gather(oa.dispatch_committed(engine, [audit]),
                                        oa.dispatch_due(store, config=toa._config(),
                                                        send=oa.send_via_resend))

        inline, cron = asyncio.run(go())
        assert inline.sent + cron.sent == 1
        assert transport.calls == ["owner-alert-row-1"]

    def test_a_row_another_dispatcher_holds_is_not_sent(self, db, engine, store, transport):
        audit = _pending_alert(db, store)
        assert asyncio.run(store.claim("row-1", 0, oa.backoff_seconds(1)))   # the cron's claim
        summary = asyncio.run(oa.dispatch_committed(engine, [audit]))
        assert (summary.due, summary.sent) == (0, 0) and transport.calls == []

    def test_duplicate_and_empty_ids_are_one_lookup(self, db, engine, store, transport):
        audit = _pending_alert(db, store)
        summary = asyncio.run(oa.dispatch_committed(engine, [audit, None, audit, ""]))
        assert (summary.due, summary.sent) == (1, 1)
        assert asyncio.run(oa.dispatch_committed(engine, [None, ""])) is None
        assert store.opened == 1


# ── PostgreSQL: the real store on the backend's SQLAlchemy engine ────────────

pg = toa.pg   # migration 332 in a disposable schema


def _engine():
    from services.async_pg_engine import create_asyncpg_engine
    dsn = os.environ["TEST_PG_URL"]
    return create_asyncpg_engine("postgresql+asyncpg://" + dsn.split("://", 1)[1])


class _ObservingResend(toa.FakeResend):
    """Reads the row from another session while the send is in flight."""

    def __init__(self, schema: str, audit_id: str) -> None:
        super().__init__()
        self.schema, self.audit_id = schema, audit_id
        self.seen: list[dict] = []

    async def __call__(self, email, *, config, idempotency_key):
        self.seen.append(toa._row(self.schema, self.audit_id))
        return await super().__call__(email, config=config, idempotency_key=idempotency_key)


def test_pg_inline_dispatch_sends_once_and_the_cron_after_sends_nothing(pg):
    audit_id = toa._admin_alert(pg)
    send = _ObservingResend(pg, audit_id)

    async def go():
        eng = _engine()
        try:
            inline = await oa.dispatch_committed(eng, [audit_id], config=toa._config(), send=send,
                                                 schema=pg)
            conn = await toa._owner_conn()
            try:
                cron = await oa.dispatch_due(oa.PgOutboxStore(conn, pg), config=toa._config(),
                                             send=send)
            finally:
                await conn.close()
            return inline, cron
        finally:
            await eng.dispose()

    inline, cron = toa.run(go())
    assert (inline.due, inline.sent, cron.due, cron.sent) == (1, 1, 0, 0)
    # The claim had committed before the e-mail left: another session saw it.
    assert send.seen == [{"status": "pending", "attempts": 1, "last_error": None, "sent": False,
                          "deferred": True}]
    assert toa._row(pg, audit_id) == {"status": "sent", "attempts": 1, "last_error": None,
                                      "sent": True, "deferred": True}
    assert len(send.delivered) == 1


def test_pg_concurrent_inline_and_cron_dispatch_send_one_email(pg):
    audit_id = toa._admin_alert(pg)
    send = toa.FakeResend()

    async def go():
        eng = _engine()
        conn = await toa._owner_conn()
        try:
            return await asyncio.gather(
                oa.dispatch_committed(eng, [audit_id], config=toa._config(), send=send, schema=pg),
                oa.dispatch_committed(eng, [audit_id], config=toa._config(), send=send, schema=pg),
                oa.dispatch_due(oa.PgOutboxStore(conn, pg), config=toa._config(), send=send))
        finally:
            await conn.close()
            await eng.dispose()

    results = toa.run(go())
    assert sum(r.sent for r in results) == 1
    assert len(send.calls) == 1 and len(send.delivered) == 1
    assert toa._row(pg, audit_id)["status"] == "sent"


def test_pg_refused_inline_send_is_failed_deferred_and_retryable(pg):
    audit_id = toa._admin_alert(pg)
    other = toa._admin_alert(pg)
    send = toa.FakeSender(oa.SendResult(False, "http_403:validation_error"))

    async def go():
        eng = _engine()
        try:
            summary = await oa.dispatch_committed(eng, [audit_id], config=toa._config(), send=send,
                                                  schema=pg)
            async with oa.engine_store(eng, pg) as store:
                again = await store.due_for_audits([audit_id, other], max_attempts=oa.MAX_ATTEMPTS)
            return summary, again
        finally:
            await eng.dispose()

    summary, again = toa.run(go())
    assert (summary.due, summary.failed) == (1, 1)
    assert toa._row(pg, audit_id) == {"status": "failed", "attempts": 1,
                                      "last_error": "http_403:validation_error", "sent": False,
                                      "deferred": True}
    # Deferred by the usual backoff; the other audit's row was never touched.
    assert [r["audit_id"] for r in again] == [other]
    assert toa._row(pg, other)["attempts"] == 0
    assert len(send.calls) == 1
