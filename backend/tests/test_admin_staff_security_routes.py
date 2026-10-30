"""ADMINAAL2-0032 T008 (route part of T006) — staff security routes.

  PATCH /admin/users/{id}/active           suspend / reactivate (FR-006)
  PATCH /admin/users/{id}/role             delegation + revocation (FR-007)
  POST  /admin/users/{id}/revoke-sessions  retry (FR-008)
  GET   /admin/users/{id}/security-audit   history (FR-015)
  GET   /admin/mfa/status                  own AAL state (FR-004)

The database is an in-memory stand-in that ports migration 332's
``fn_set_staff_privilege`` (actor re-check under the locks, self, non-staff,
last admin, marker, no-op), its suspension guard and audit trigger, and
migration 336's role freeze. The real SQL is covered by the PostgreSQL tests
(test_migration_332_*, test_migration_336_*); these tests pin how the routes
use it. GoTrue's admin API and the direct ``auth.sessions`` connection are
fakes that record calls and can be told to fail.
"""

from __future__ import annotations

import asyncio
import copy
import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

import routers.admin as admin_module
import routers.admin_staff_security as sec_module
from services import staff_security

ADMIN = "00000000-0000-4000-8000-00000000a001"      # the acting admin
ADMIN2 = "00000000-0000-4000-8000-00000000a002"
INSTRUCTOR = "00000000-0000-4000-8000-00000000b001"
LEARNER = "00000000-0000-4000-8000-00000000c001"
NEVER_ACTIVATED = "00000000-0000-4000-8000-00000000b002"
AUTH = {"Authorization": "Bearer fake.admin.jwt"}


# ── In-memory database ───────────────────────────────────────────────────────

class _Resp:
    def __init__(self, data):
        self.data = data


def _pg_error(message: str) -> APIError:
    return APIError({"code": "P0001", "message": message, "details": None, "hint": None})


class _Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.op, self.payload, self.filters = "select", None, []
        self._order, self._limit, self.upsert_conflict = None, None, None

    def select(self, *_a, **_k):
        self.op = "select"
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def upsert(self, payload, on_conflict=None, **_k):
        self.op, self.payload, self.upsert_conflict = "upsert", payload, on_conflict
        return self

    def eq(self, col, val):
        if col == "permissions" and isinstance(val, str):
            val = json.loads(val)
        self.filters.append(lambda r, c=col, v=val: str(r.get(c)) == str(v) if v is not None else r.get(c) is None)
        return self

    def is_(self, col, val):
        assert val == "null"
        self.filters.append(lambda r, c=col: r.get(c) is None)
        return self

    def in_(self, col, vals):
        vals = {str(v) for v in vals}
        self.filters.append(lambda r, c=col: str(r.get(c)) in vals)
        return self

    def order(self, col, desc=False):
        self._order = (col, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def _rows(self):
        return [r for r in self.db.tables.setdefault(self.name, []) if all(f(r) for f in self.filters)]

    def execute(self):
        self.db.ops.append((self.name, self.op))
        if self.db.on_execute is not None:
            self.db.on_execute(self.name, self.op)
        if self.name in self.db.fail_tables:
            raise RuntimeError(f"{self.name} unavailable")
        table = self.db.tables.setdefault(self.name, [])
        if self.op == "insert":
            rows = self.payload if isinstance(self.payload, list) else [self.payload]
            rows = [{"id": str(uuid.uuid4()), **copy.deepcopy(r)} for r in rows]
            for r in rows:
                r.setdefault("occurred_at", self.db.tick())
                if self.name == "owner_alert_outbox":
                    r.setdefault("status", "pending")
            table.extend(rows)
            return _Resp(rows)
        if self.op == "upsert":
            rows = self.payload if isinstance(self.payload, list) else [self.payload]
            keys = (self.upsert_conflict or "id").split(",")
            out = []
            for r in rows:
                hit = next((t for t in table if all(t.get(k) == r.get(k) for k in keys)), None)
                if hit:
                    hit.update(r)
                    out.append(hit)
                else:
                    new = {"id": str(uuid.uuid4()), **r}
                    table.append(new)
                    out.append(new)
            return _Resp(out)
        if self.op == "update":
            matched = self._rows()
            if self.name == "users":
                for r in matched:
                    self.db.users_update(r, self.payload)
                return _Resp([dict(r) for r in matched])
            for r in matched:
                r.update(self.payload)
            return _Resp([dict(r) for r in matched])
        rows = [dict(r) for r in self._rows()]
        if self._order:
            col, desc = self._order
            rows.sort(key=lambda r: str(r.get(col) or ""), reverse=desc)
        if self._limit is not None:
            rows = rows[: self._limit]
        return _Resp(rows)


class _Rpc:
    def __init__(self, fn):
        self.fn = fn

    def execute(self):
        return _Resp(self.fn())


class FakeDB:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {
            "users": [], "staff_security_audit": [], "owner_alert_outbox": [],
        }
        self.ops: list = []
        self.fail_tables: set[str] = set()
        self.rpc_calls: list[dict] = []
        self.rpc_override: str | None = None   # force a P0001 code
        self.on_execute = None                  # (table, op) hook, e.g. a concurrent write
        self._clock = datetime(2026, 10, 29, 1, 0, tzinfo=timezone.utc)
        self.auth = type("Auth", (), {})()
        self.auth.admin = FakeAuthAdmin()

    def tick(self) -> str:
        self._clock += timedelta(seconds=1)
        return self._clock.isoformat()

    def table(self, name):
        return _Query(self, name)

    def user(self, uid):
        return next((r for r in self.tables["users"] if r["id"] == uid), None)

    def seed(self, uid, role, *, is_active=True, suspended_at=None, email=None):
        self.tables["users"].append({
            "id": uid, "email": email or f"{role}-{uid[-4:]}@example.test", "role": role,
            "is_active": is_active, "suspended_at": suspended_at,
            "suspended_by": None, "suspension_reason": None,
        })

    def audits(self, event=None):
        return [a for a in self.tables["staff_security_audit"] if event in (None, a["event"])]

    # Migration 332 suspension guard + 336 role freeze + 332 audit trigger.
    def users_update(self, row, payload, *, privilege=None):
        new = {**row, **payload}
        if privilege is None:
            if new.get("is_active") and not row.get("is_active") and row.get("suspended_at"):
                raise _pg_error("account_suspended")
            marker = ("suspended_at", "suspended_by", "suspension_reason")
            if any(new.get(k) != row.get(k) for k in marker):
                raise _pg_error("account_suspended_marker_protected")
        if new.get("role") != row.get("role") and row.get("suspended_at"):
            raise _pg_error("account_suspended_role_change")
        state = lambda r: {"role": r.get("role"), "is_active": r.get("is_active"),  # noqa: E731
                           "suspended_at": r.get("suspended_at")}
        before, after = state(row), state(new)
        row.update(payload)
        if before == after:
            return
        audit_id = (privilege or {}).get("audit_id") or str(uuid.uuid4())
        event = "role_changed" if before["role"] != after["role"] else "active_changed"
        actor = (privilege or {}).get("actor")
        self.tables["staff_security_audit"].append({
            "id": audit_id, "occurred_at": self.tick(), "event": event,
            "target_user_id": row["id"], "actor_user_id": actor,
            "source": "admin_api" if actor else "service", "before": before, "after": after,
            "reason": (privilege or {}).get("reason"), "request_id": (privilege or {}).get("request_id"),
            "detail": {},
        })
        if "admin" in (before["role"], after["role"]):
            self.tables["owner_alert_outbox"].append({
                "id": str(uuid.uuid4()), "audit_id": audit_id, "event": event,
                "payload": {"event": event, "target_user_id": row["id"]}, "status": "pending",
            })

    def rpc(self, name, params):
        assert name == "fn_set_staff_privilege", name
        self.rpc_calls.append(dict(params))
        return _Rpc(lambda: self._set_staff_privilege(**params))

    def _set_staff_privilege(self, p_actor, p_target, p_role, p_is_active, p_reason, p_request_id):
        if self.rpc_override:
            raise _pg_error(self.rpc_override)
        if p_role is None and p_is_active is None:
            raise _pg_error("invalid_privilege_change")
        if p_role is not None and p_role not in ("admin", "instructor", "student"):
            raise _pg_error("invalid_role")
        if p_is_active is not None and (p_reason is None or not 3 <= len(p_reason.strip()) <= 500):
            raise _pg_error("invalid_reason")
        if p_actor is None:
            raise _pg_error("actor_not_admin")
        if p_actor == p_target:
            raise _pg_error("self_change_forbidden")
        old = self.user(p_target)
        if old is None:
            raise _pg_error("target_not_found")
        actor = self.user(p_actor)
        if not actor or actor["role"] != "admin" or not actor["is_active"] or actor.get("suspended_at"):
            raise _pg_error("actor_not_admin")
        if p_is_active is not None and old["role"] not in ("admin", "instructor"):
            raise _pg_error("target_not_staff")
        role = p_role if p_role is not None else old["role"]
        active = p_is_active if p_is_active is not None else old["is_active"]
        suspend = p_is_active is False and old.get("suspended_at") is None
        clear = p_is_active is True and old.get("suspended_at") is not None
        before = {"role": old["role"], "is_active": old["is_active"], "suspended_at": old.get("suspended_at")}
        if role == old["role"] and active == old["is_active"] and not suspend and not clear:
            return [{"changed": False, "audit_id": None, "before": before, "after": before}]
        if (old["role"] == "admin" and old["is_active"] and not (role == "admin" and active)
                and not any(u["role"] == "admin" and u["is_active"] and u["id"] != p_target
                            for u in self.tables["users"])):
            raise _pg_error("last_admin")
        payload = {"role": role, "is_active": active}
        if suspend:
            payload.update(suspended_at=self.tick(), suspended_by=p_actor, suspension_reason=p_reason.strip())
        if clear:
            payload.update(suspended_at=None, suspended_by=None, suspension_reason=None)
        audit_id = str(uuid.uuid4())
        self.users_update(old, payload, privilege={
            "actor": p_actor, "audit_id": audit_id, "reason": (p_reason or "").strip() or None,
            "request_id": p_request_id})
        after = {"role": old["role"], "is_active": old["is_active"], "suspended_at": old.get("suspended_at")}
        return [{"changed": True, "audit_id": audit_id, "before": before, "after": after}]


class FakeAuthAdmin:
    """``supabase_admin.auth.admin``: records bans; can be told to fail."""

    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.banned: set[str] = set()
        self.fail_ban = False
        self.fail_unban = False

    def update_user_by_id(self, uid, attrs):
        duration = attrs["ban_duration"]
        self.calls.append((uid, duration))
        if duration == "none":
            if self.fail_unban:
                raise RuntimeError("gotrue down")
            self.banned.discard(uid)
        else:
            if self.fail_ban:
                raise RuntimeError("gotrue down")
            self.banned.add(uid)
        return {"user": {"id": uid}}


class FakeEngine:
    """The direct ``postgres`` connection: ``auth.sessions`` per user, and
    the per-target transaction advisory lock (one asyncio lock per key, which
    stands in for PostgreSQL serializing the backend's workers)."""

    def __init__(self, sessions=None):
        self.sessions: dict[str, int] = dict(sessions or {})
        self.statements: list[tuple[str, dict]] = []
        self.fail = False
        self.lock_statements: list[tuple[str, dict]] = []
        self.lock_fail = False
        self._locks: dict[str, asyncio.Lock] = {}

    def held(self) -> list[str]:
        return [k for k, lock in self._locks.items() if lock.locked()]

    async def connect(self):
        engine = self

        class _LockConn:
            def __init__(self):
                self.held: list[asyncio.Lock] = []

            async def begin(self):
                return self

            async def execute(self, sql, params=None):
                engine.lock_statements.append((str(sql), dict(params or {})))
                if engine.lock_fail:
                    raise RuntimeError("connection refused")
                if "pg_advisory_xact_lock" in str(sql):
                    lock = engine._locks.setdefault(params["key"], asyncio.Lock())
                    await lock.acquire()
                    self.held.append(lock)

            async def close(self):
                # Ending the transaction releases its advisory locks.
                while self.held:
                    self.held.pop().release()

        return _LockConn()

    def begin(self):
        engine = self

        class _Conn:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def execute(self, sql, params):
                engine.statements.append((str(sql), dict(params)))
                if engine.fail:
                    raise RuntimeError("connection refused")
                assert str(sql).startswith("DELETE FROM auth.sessions WHERE user_id")
                n = engine.sessions.pop(params["uid"], 0)
                return type("R", (), {"rowcount": n})()

        return _Conn()


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    fake.seed(ADMIN, "admin")
    fake.seed(ADMIN2, "admin")
    fake.seed(INSTRUCTOR, "instructor")
    fake.seed(LEARNER, "student")
    fake.seed(NEVER_ACTIVATED, "instructor", is_active=False)
    monkeypatch.setattr(admin_module, "supabase_admin", fake)
    return fake


@pytest.fixture
def engine(monkeypatch):
    eng = FakeEngine({ADMIN2: 2, INSTRUCTOR: 3, LEARNER: 1})
    monkeypatch.setattr(admin_module, "_db_engine", eng)
    return eng


@pytest.fixture
def client(db, engine):
    from main import app

    guard = AsyncMock(return_value={"id": ADMIN, "email": "admin@example.test"})
    with patch.object(sec_module, "require_admin", new=guard), \
            patch.object(admin_module, "require_admin", new=guard):
        with TestClient(app, raise_server_exceptions=False) as c:
            yield c


def _active(client, uid, is_active, reason="tài khoản bị lộ mật khẩu"):
    return client.patch(f"/admin/users/{uid}/active", json={"is_active": is_active, "reason": reason},
                        headers=AUTH)


# ── Suspend / reactivate (FR-006) ────────────────────────────────────────────

class TestSuspend:
    def test_suspend_instructor_marks_bans_revokes_and_audits_once(self, client, db, engine):
        r = _active(client, INSTRUCTOR, False)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True and body["id"] == INSTRUCTOR and body["is_active"] is False
        assert body["changed"] is True and body["suspended_at"]
        assert body["sessions_revoked"] is True and body["revoke_error"] is None
        assert body["sign_in_restored"] is None
        row = db.user(INSTRUCTOR)
        assert row["is_active"] is False and row["suspended_at"] and row["suspended_by"] == ADMIN
        # Ban first (Q3), then every session deleted (research.md §9.2).
        assert db.auth.admin.calls == [(INSTRUCTOR, staff_security.BAN_DURATION)]
        assert INSTRUCTOR not in engine.sessions
        assert engine.statements[0][1] == {"uid": INSTRUCTOR}
        audits = db.audits()
        assert len(audits) == 1 and audits[0]["id"] == body["audit_id"]
        assert audits[0]["event"] == "active_changed" and audits[0]["actor_user_id"] == ADMIN
        assert audits[0]["reason"] == "tài khoản bị lộ mật khẩu"
        # Q4: instructor events are audit-only.
        assert db.tables["owner_alert_outbox"] == []
        call = db.rpc_calls[0]
        assert (call["p_actor"], call["p_target"], call["p_is_active"], call["p_role"]) == (
            ADMIN, INSTRUCTOR, False, None)

    def test_suspend_second_admin_enqueues_owner_alert(self, client, db):
        r = _active(client, ADMIN2, False)
        assert r.status_code == 200, r.text
        assert [o["audit_id"] for o in db.tables["owner_alert_outbox"]] == [r.json()["audit_id"]]

    def test_repeat_is_idempotent_one_audit_row_and_ban_reasserted(self, client, db, engine):
        first = _active(client, INSTRUCTOR, False)
        engine.sessions[INSTRUCTOR] = 1   # a session that slipped in
        again = _active(client, INSTRUCTOR, False)
        assert again.status_code == 200, again.text
        assert again.json()["changed"] is False and again.json()["audit_id"] is None
        assert again.json()["suspended_at"] == first.json()["suspended_at"]
        assert again.json()["sessions_revoked"] is True
        assert INSTRUCTOR not in engine.sessions
        assert len(db.audits()) == 1

    def test_never_activated_instructor_gets_the_marker(self, client, db):
        r = _active(client, NEVER_ACTIVATED, False)
        assert r.status_code == 200 and r.json()["changed"] is True
        assert db.user(NEVER_ACTIVATED)["suspended_at"]

    def test_self_is_400_and_calls_nothing(self, client, db):
        r = _active(client, ADMIN, False)
        assert r.status_code == 400
        assert db.rpc_calls == [] and db.auth.admin.calls == []

    def test_non_staff_target_is_422(self, client, db):
        r = _active(client, LEARNER, False)
        assert r.status_code == 422
        assert db.user(LEARNER)["is_active"] is True and db.auth.admin.calls == []

    def test_unknown_or_malformed_user_is_404(self, client, db):
        assert _active(client, str(uuid.uuid4()), False).status_code == 404
        assert _active(client, "not-a-uuid", False).status_code == 404
        assert db.auth.admin.calls == []

    @pytest.mark.parametrize("reason", ["", "ab", "   ", "x" * 501])
    def test_reason_must_be_3_to_500_chars(self, client, db, reason):
        r = _active(client, INSTRUCTOR, False, reason=reason)
        assert r.status_code == 422
        assert db.user(INSTRUCTOR)["suspended_at"] is None

    def test_last_admin_is_409(self, client, db):
        # Unreachable through the real RPC's actor rule (the actor is another
        # active admin); pinned here as the route's mapping of the code.
        db.rpc_override = "last_admin"
        r = _active(client, ADMIN2, False)
        assert r.status_code == 409
        assert r.json()["detail"]["code"] == "last_admin"
        assert db.auth.admin.calls == []

    def test_actor_suspended_mid_request_cannot_complete(self, client, db):
        # The guard passed, then another admin suspended the actor before the
        # RPC took its locks: the RPC re-reads the actor and refuses.
        actor = db.user(ADMIN)
        actor.update(is_active=False, suspended_at="2026-10-29T00:59:00+00:00")
        r = _active(client, INSTRUCTOR, False)
        assert r.status_code == 403
        assert r.json()["detail"]["code"] == "actor_not_admin"
        assert db.user(INSTRUCTOR)["suspended_at"] is None
        assert db.audits() == [] and db.auth.admin.calls == []

    def test_unknown_database_error_is_500_without_internals(self, client, db):
        db.rpc_override = "something_new"
        r = _active(client, INSTRUCTOR, False)
        assert r.status_code == 500
        assert "something_new" not in r.text


class TestReactivate:
    def test_reactivate_clears_marker_and_unbans(self, client, db):
        _active(client, INSTRUCTOR, False)
        r = _active(client, INSTRUCTOR, True, reason="đã đổi mật khẩu")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["is_active"] is True and body["suspended_at"] is None and body["changed"] is True
        assert body["sign_in_restored"] is True and body["sessions_revoked"] is None
        assert db.user(INSTRUCTOR)["suspended_at"] is None and db.user(INSTRUCTOR)["is_active"] is True
        assert db.auth.admin.calls[-1] == (INSTRUCTOR, "none")
        assert INSTRUCTOR not in db.auth.admin.banned
        assert [a["event"] for a in db.audits()] == ["active_changed", "active_changed"]

    def test_unban_failure_changes_nothing_and_a_repeat_retries(self, client, db):
        _active(client, INSTRUCTOR, False)
        db.auth.admin.fail_unban = True
        r = _active(client, INSTRUCTOR, True)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is False and body["changed"] is False and body["sign_in_restored"] is False
        assert body["audit_id"] is None and body["is_active"] is False and body["suspended_at"]
        # Still suspended, so its role stays frozen: no demotion can strand a
        # ban this route could no longer lift (Codex P2 on #1885).
        assert db.user(INSTRUCTOR)["suspended_at"] and db.user(INSTRUCTOR)["is_active"] is False
        assert INSTRUCTOR in db.auth.admin.banned
        demote = client.patch(f"/admin/users/{INSTRUCTOR}/role", json={"role": "student"}, headers=AUTH)
        assert demote.status_code == 409
        assert demote.json()["detail"]["code"] == "account_suspended_role_change"
        assert len(db.audits()) == 1
        db.auth.admin.fail_unban = False
        retry = _active(client, INSTRUCTOR, True)
        assert retry.json()["ok"] is True and retry.json()["changed"] is True
        assert retry.json()["sign_in_restored"] is True
        assert INSTRUCTOR not in db.auth.admin.banned and db.user(INSTRUCTOR)["suspended_at"] is None
        assert len(db.audits()) == 2   # suspend + reactivate, none for the failed attempt
        again = _active(client, INSTRUCTOR, True)
        assert again.json()["changed"] is False and again.json()["sign_in_restored"] is None

    def test_unban_happens_before_the_marker_is_cleared(self, client, db):
        _active(client, INSTRUCTOR, False)
        seen = []
        original = db._set_staff_privilege

        def spy(**params):
            seen.append(INSTRUCTOR in db.auth.admin.banned)
            return original(**params)

        db._set_staff_privilege = spy
        assert _active(client, INSTRUCTOR, True).json()["sign_in_restored"] is True
        assert seen == [False]

    def test_refused_reactivation_puts_the_ban_back(self, client, db):
        _active(client, INSTRUCTOR, False)
        db.user(ADMIN).update(is_active=False, suspended_at="2026-10-29T00:59:00+00:00")
        r = _active(client, INSTRUCTOR, True)
        assert r.status_code == 403 and r.json()["detail"]["code"] == "actor_not_admin"
        assert INSTRUCTOR in db.auth.admin.banned and db.user(INSTRUCTOR)["suspended_at"]

    def test_lost_rpc_response_after_commit_does_not_reban(self, client, db):
        # The RPC commits the reactivation, then its HTTP response is lost
        # (Codex P2 on #1885): the marker is cleared, so no ban goes back.
        _active(client, INSTRUCTOR, False)
        original = db._set_staff_privilege

        def committed_then_lost(**params):
            original(**params)
            raise RuntimeError("read timed out")

        db._set_staff_privilege = committed_then_lost
        r = _active(client, INSTRUCTOR, True)
        assert r.status_code == 500
        assert db.user(INSTRUCTOR)["suspended_at"] is None and db.user(INSTRUCTOR)["is_active"] is True
        assert INSTRUCTOR not in db.auth.admin.banned
        assert db.auth.admin.calls[-1] == (INSTRUCTOR, "none")
        db._set_staff_privilege = original
        again = _active(client, INSTRUCTOR, True)
        assert again.status_code == 200 and again.json()["ok"] is True and again.json()["changed"] is False
        assert INSTRUCTOR not in db.auth.admin.banned

    def test_lost_rpc_request_before_commit_puts_the_ban_back(self, client, db):
        _active(client, INSTRUCTOR, False)

        def lost(**_params):
            raise RuntimeError("connection reset")

        db._set_staff_privilege = lost
        assert _active(client, INSTRUCTOR, True).status_code == 500
        assert db.user(INSTRUCTOR)["suspended_at"] and INSTRUCTOR in db.auth.admin.banned

    def test_unreadable_marker_after_rpc_error_is_not_rebanned_and_retry_rebans(self, client, db, engine):
        # A ban must never outlive the marker, so an unconfirmed marker is not
        # re-banned; the still-suspended account is re-banned by the retry route.
        _active(client, INSTRUCTOR, False)
        original = db._set_staff_privilege

        def lost_and_db_down(**_params):
            db.fail_tables.add("users")
            raise RuntimeError("connection reset")

        db._set_staff_privilege = lost_and_db_down
        assert _active(client, INSTRUCTOR, True).status_code == 500
        assert INSTRUCTOR not in db.auth.admin.banned and db.user(INSTRUCTOR)["suspended_at"]
        db.fail_tables.discard("users")
        db._set_staff_privilege = original
        retry = client.post(f"/admin/users/{INSTRUCTOR}/revoke-sessions", json={}, headers=AUTH)
        assert retry.status_code == 200 and retry.json()["sessions_revoked"] is True
        assert INSTRUCTOR in db.auth.admin.banned

    def test_reactivating_a_never_suspended_account_does_not_touch_gotrue(self, client, db):
        r = _active(client, NEVER_ACTIVATED, True)
        assert r.status_code == 200 and r.json()["changed"] is True
        assert r.json()["sign_in_restored"] is None and db.auth.admin.calls == []

    def test_reactivation_target_read_failure_is_503(self, client, db):
        db.fail_tables.add("users")
        assert _active(client, INSTRUCTOR, True).status_code == 503
        assert db.rpc_calls == [] and db.auth.admin.calls == []

    def test_successful_suspension_then_reactivation_writes_no_revocation_row(self, client, db, engine):
        _active(client, INSTRUCTOR, False)
        r = _active(client, INSTRUCTOR, True, reason="đã đổi mật khẩu")
        assert r.json()["ok"] is True and r.json()["sign_in_restored"] is True
        assert r.json()["sessions_revoked"] is None and r.json()["revoke_error"] is None
        assert [a["event"] for a in db.audits()] == ["active_changed", "active_changed"]


# ── Reactivation after a failed revocation (PC-J66 F01) ──────────────────────

def _unban_spy(db, engine, target):
    """Record ``target``'s live session count at each unban call."""
    seen: list[int] = []
    original = db.auth.admin.update_user_by_id

    def spy(uid, attrs):
        if uid == target and attrs["ban_duration"] == "none":
            seen.append(engine.sessions.get(target, 0))
        return original(uid, attrs)

    db.auth.admin.update_user_by_id = spy
    return seen


@pytest.mark.parametrize("target", [INSTRUCTOR, ADMIN2], ids=["instructor", "admin"])
class TestReactivateAfterFailedRevocation:
    def _suspend_with_failed_delete(self, client, db, engine, target):
        engine.fail = True
        r = _active(client, target, False)
        assert r.json()["sessions_revoked"] is False
        assert r.json()["revoke_error"] == "session_delete_failed"
        assert target in db.auth.admin.banned and engine.sessions[target] > 0

    def test_database_still_down_keeps_the_account_locked(self, client, db, engine, target):
        self._suspend_with_failed_delete(client, db, engine, target)
        left = engine.sessions[target]
        r = _active(client, target, True, reason="đã đổi mật khẩu")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is False and body["changed"] is False and body["audit_id"] is None
        assert body["sessions_revoked"] is False and body["revoke_error"] == "session_delete_failed"
        assert body["sign_in_restored"] is False
        assert body["is_active"] is False and body["suspended_at"]
        # Still banned, still suspended, the old sessions untouched, no unban.
        assert target in db.auth.admin.banned and engine.sessions[target] == left
        assert (target, "none") not in db.auth.admin.calls
        row = db.user(target)
        assert row["is_active"] is False and row["suspended_at"]
        # Never silent (FR-008): audited and alerted like any revocation failure.
        failed = db.audits("sessions_revoke_failed")
        assert [a["detail"]["trigger"] for a in failed] == ["suspend", "reactivate"]
        assert failed[1]["detail"] == {"trigger": "reactivate", "ban": True,
                                       "revoke_error": "session_delete_failed"}
        assert any(o["audit_id"] == failed[1]["id"] for o in db.tables["owner_alert_outbox"])
        assert len(db.audits("active_changed")) == 1

    def test_database_back_deletes_sessions_before_the_unban(self, client, db, engine, target):
        self._suspend_with_failed_delete(client, db, engine, target)
        engine.fail = False
        seen = _unban_spy(db, engine, target)
        r = _active(client, target, True, reason="đã đổi mật khẩu")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True and body["changed"] is True and body["sign_in_restored"] is True
        assert body["is_active"] is True and body["suspended_at"] is None
        assert seen == [0], "the ban was lifted while old sessions still existed"
        assert engine.sessions.get(target, 0) == 0
        assert target not in db.auth.admin.banned
        assert db.user(target)["is_active"] is True and db.user(target)["suspended_at"] is None
        # A confirmed revocation adds no row; only the suspension's failure stays.
        assert [a["detail"]["trigger"] for a in db.audits("sessions_revoke_failed")] == ["suspend"]
        assert db.audits("sessions_revoked") == []

    def test_failed_ban_is_reasserted_before_the_delete(self, client, db, engine, target):
        # The suspension's ban failed, so a sign-in during the suspension
        # could mint a fresh session; reactivation bans before it deletes.
        db.auth.admin.fail_ban = True
        _active(client, target, False)
        db.auth.admin.fail_ban = False
        engine.sessions[target] = 1
        seen = _unban_spy(db, engine, target)
        r = _active(client, target, True, reason="đã đổi mật khẩu")
        assert r.json()["ok"] is True and r.json()["sign_in_restored"] is True
        durations = [d for uid, d in db.auth.admin.calls if uid == target]
        assert durations[-2:] == [staff_security.BAN_DURATION, "none"]
        assert seen == [0] and target not in engine.sessions

    def test_ban_still_failing_keeps_the_account_locked(self, client, db, engine, target):
        db.auth.admin.fail_ban = True
        _active(client, target, False)
        r = _active(client, target, True, reason="đã đổi mật khẩu")
        body = r.json()
        assert body["ok"] is False and body["sign_in_restored"] is False
        assert body["sessions_revoked"] is False and body["revoke_error"] == "ban_failed"
        assert (target, "none") not in db.auth.admin.calls
        assert db.user(target)["suspended_at"]

    def test_no_database_url_keeps_the_account_locked(self, client, db, engine, monkeypatch, target):
        _active(client, target, False)
        monkeypatch.setattr(admin_module, "_db_engine", None)
        r = _active(client, target, True, reason="đã đổi mật khẩu")
        body = r.json()
        assert body["ok"] is False and body["sign_in_restored"] is False
        assert body["revoke_error"] == "revocation_unavailable"
        assert target in db.auth.admin.banned and db.user(target)["suspended_at"]


# ── Revocation failure (FR-008) ──────────────────────────────────────────────

class TestRevocationFailure:
    def test_ban_and_delete_failure_keeps_suspension_audits_and_alerts(self, client, db, engine):
        db.auth.admin.fail_ban = True
        engine.fail = True
        r = _active(client, INSTRUCTOR, False)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["sessions_revoked"] is False and body["revoke_error"] == "ban_failed"
        # The committed suspension stands.
        assert db.user(INSTRUCTOR)["suspended_at"] and db.user(INSTRUCTOR)["is_active"] is False
        # The delete is still attempted after the ban failed.
        assert engine.statements
        failed = db.audits("sessions_revoke_failed")
        assert len(failed) == 1
        assert failed[0]["detail"] == {"trigger": "suspend", "ban": True, "revoke_error": "ban_failed"}
        assert failed[0]["actor_user_id"] == ADMIN and failed[0]["target_user_id"] == INSTRUCTOR
        alerts = [o for o in db.tables["owner_alert_outbox"] if o["audit_id"] == failed[0]["id"]]
        assert len(alerts) == 1
        payload = alerts[0]["payload"]
        assert payload["event"] == "sessions_revoke_failed"
        assert payload["target_email"] == db.user(INSTRUCTOR)["email"]
        assert payload["actor_email"] == db.user(ADMIN)["email"]
        # Email-safe: no reason text, token or request body.
        assert "reason" not in payload and "lộ mật khẩu" not in str(payload)
        assert "Bearer" not in str(payload)

    def test_delete_failure_alone_is_session_delete_failed(self, client, db, engine):
        engine.fail = True
        r = _active(client, INSTRUCTOR, False)
        assert r.json()["sessions_revoked"] is False
        assert r.json()["revoke_error"] == "session_delete_failed"
        assert INSTRUCTOR in db.auth.admin.banned

    def test_no_database_url_is_revocation_unavailable(self, client, db, monkeypatch):
        monkeypatch.setattr(admin_module, "_db_engine", None)
        r = _active(client, INSTRUCTOR, False)
        assert r.json()["sessions_revoked"] is False
        assert r.json()["revoke_error"] == "revocation_unavailable"
        assert len(db.audits("sessions_revoke_failed")) == 1

    def test_failure_audit_write_failing_still_answers_the_committed_change(self, client, db, engine):
        engine.fail = True
        db.fail_tables.add("owner_alert_outbox")
        r = _active(client, INSTRUCTOR, False)
        assert r.status_code == 200 and r.json()["sessions_revoked"] is False
        assert len(db.audits("sessions_revoke_failed")) == 1


class TestRetry:
    def _retry(self, client, uid, **body):
        return client.post(f"/admin/users/{uid}/revoke-sessions", json=body or None, headers=AUTH)

    def test_retry_of_a_failed_suspension_bans_and_deletes(self, client, db, engine):
        engine.fail = True
        _active(client, INSTRUCTOR, False)
        engine.fail = False
        engine.sessions[INSTRUCTOR] = 1
        r = self._retry(client, INSTRUCTOR, reason="thử lại")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body == {"ok": True, "sessions_revoked": True, "revoke_error": None,
                        "audit_id": body["audit_id"]}
        assert INSTRUCTOR not in engine.sessions and INSTRUCTOR in db.auth.admin.banned
        ok = db.audits("sessions_revoked")
        assert [a["id"] for a in ok] == [body["audit_id"]]
        assert ok[0]["detail"] == {"trigger": "retry", "ban": True} and ok[0]["reason"] == "thử lại"

    def test_retry_is_idempotent(self, client, db, engine):
        _active(client, INSTRUCTOR, False)
        first = self._retry(client, INSTRUCTOR)
        second = self._retry(client, INSTRUCTOR)
        assert first.json()["sessions_revoked"] is True and second.json()["sessions_revoked"] is True
        assert db.user(INSTRUCTOR)["suspended_at"]

    def test_retry_of_a_demoted_account_never_bans(self, client, db, engine):
        engine.fail = True
        client.patch(f"/admin/users/{INSTRUCTOR}/role", json={"role": "student"}, headers=AUTH)
        engine.fail = False
        r = self._retry(client, INSTRUCTOR)
        assert r.json()["sessions_revoked"] is True
        assert db.auth.admin.calls == []

    def test_retry_of_a_reactivated_account_never_rebans(self, client, db):
        _active(client, INSTRUCTOR, False)
        _active(client, INSTRUCTOR, True)
        before = list(db.auth.admin.calls)
        r = self._retry(client, INSTRUCTOR)
        assert r.json()["sessions_revoked"] is True and db.auth.admin.calls == before

    def test_retry_failure_is_audited_and_alerted(self, client, db, engine):
        engine.fail = True
        r = self._retry(client, LEARNER)
        assert r.status_code == 200
        assert r.json()["ok"] is False and r.json()["revoke_error"] == "session_delete_failed"
        failed = db.audits("sessions_revoke_failed")
        assert [a["id"] for a in failed] == [r.json()["audit_id"]]
        assert [o["audit_id"] for o in db.tables["owner_alert_outbox"]] == [r.json()["audit_id"]]

    def test_retry_unknown_user_is_404(self, client, db, engine):
        assert self._retry(client, str(uuid.uuid4())).status_code == 404
        assert engine.statements == []

    def test_retry_target_read_failure_is_503(self, client, db, engine):
        db.fail_tables.add("users")
        assert self._retry(client, INSTRUCTOR).status_code == 503
        assert engine.statements == []


# ── Serialization per target (Codex P2 on #1885) ─────────────────────────────

def _overlap(first, second, *, pause_trigger):
    """Run ``first`` until it has committed its privilege change and is about
    to revoke (the ban), start ``second`` while it is paused there, then
    release ``first``. Returns both responses and whether ``second`` was
    still waiting when ``first`` was released."""
    app = FastAPI()
    app.include_router(sec_module.router)
    guard = AsyncMock(return_value={"id": ADMIN, "email": "admin@example.test"})

    async def scenario():
        paused, release = asyncio.Event(), asyncio.Event()
        original = staff_security.revoke_and_record

        async def gated(*args, **kwargs):
            if kwargs.get("trigger") == pause_trigger and not paused.is_set():
                paused.set()
                await release.wait()
            return await original(*args, **kwargs)

        with patch.object(sec_module, "require_admin", new=guard), \
                patch.object(staff_security, "revoke_and_record", new=gated):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://admin.test") as c:
                a = asyncio.create_task(first(c))
                await asyncio.wait_for(paused.wait(), 5)
                b = asyncio.create_task(second(c))
                done, _ = await asyncio.wait({b}, timeout=0.3)
                release.set()
                ra, rb = await asyncio.wait_for(asyncio.gather(a, b), 5)
        return ra, rb, not done

    return asyncio.run(scenario())


def _patch_active(uid, is_active, reason="tài khoản bị lộ mật khẩu"):
    return lambda c: c.patch(f"/admin/users/{uid}/active",
                             json={"is_active": is_active, "reason": reason}, headers=AUTH)


class TestSerialization:
    def test_reactivation_waits_for_an_in_flight_suspension(self, db, engine):
        # Codex: the suspension commits its RPC and pauses before the ban; a
        # reactivation unbans and clears the marker; the suspension resumes
        # and bans an active account no route could then unban.
        sus, rea, waited = _overlap(_patch_active(INSTRUCTOR, False),
                                    _patch_active(INSTRUCTOR, True, reason="đã đổi mật khẩu"),
                                    pause_trigger="suspend")
        assert waited, "the reactivation ran inside the suspension's ban window"
        assert sus.status_code == 200 and rea.status_code == 200, (sus.text, rea.text)
        assert sus.json()["sessions_revoked"] is True
        assert rea.json()["changed"] is True and rea.json()["sign_in_restored"] is True
        assert db.user(INSTRUCTOR)["is_active"] is True and db.user(INSTRUCTOR)["suspended_at"] is None
        assert INSTRUCTOR not in db.auth.admin.banned
        # Suspension ban, the reactivation's re-ban before its delete
        # (PC-J66 F01), then the unban.
        assert [d for _, d in db.auth.admin.calls] == ["876000h", "876000h", "none"]
        assert engine.held() == []

    def test_reactivation_waits_for_an_in_flight_retry(self, db, engine):
        # A retry that read the suspended row must not ban after a
        # reactivation has unbanned and cleared the marker.
        db.user(INSTRUCTOR).update(is_active=False, suspended_at="2026-10-29T00:59:00+00:00")
        db.auth.admin.banned.add(INSTRUCTOR)
        retry = lambda c: c.post(f"/admin/users/{INSTRUCTOR}/revoke-sessions", json=None, headers=AUTH)  # noqa: E731
        ret, rea, waited = _overlap(retry, _patch_active(INSTRUCTOR, True), pause_trigger="retry")
        assert waited, "the reactivation ran inside the retry's ban window"
        assert ret.json()["sessions_revoked"] is True and rea.json()["sign_in_restored"] is True
        assert db.user(INSTRUCTOR)["is_active"] is True and INSTRUCTOR not in db.auth.admin.banned
        assert engine.held() == []

    def test_other_targets_are_not_serialized(self, db, engine):
        sus, other, waited = _overlap(_patch_active(INSTRUCTOR, False), _patch_active(ADMIN2, False),
                                      pause_trigger="suspend")
        assert not waited
        assert sus.status_code == 200 and other.status_code == 200
        keys = {p["key"] for sql, p in engine.lock_statements if "pg_advisory_xact_lock" in sql}
        assert keys == {f"staff-security:{INSTRUCTOR}", f"staff-security:{ADMIN2}"}

    def test_lock_is_a_transaction_lock_with_a_timeout(self, client, engine):
        assert _active(client, INSTRUCTOR, False).status_code == 200
        sqls = [sql for sql, _ in engine.lock_statements]
        assert sqls[0].startswith("SET LOCAL lock_timeout")
        assert "pg_advisory_xact_lock(hashtextextended(:key, 0))" in sqls[1]
        assert engine.held() == []

    @pytest.mark.parametrize("call", [
        lambda c: _active(c, INSTRUCTOR, False),
        lambda c: _active(c, INSTRUCTOR, True),
        lambda c: c.post(f"/admin/users/{INSTRUCTOR}/revoke-sessions", json=None, headers=AUTH),
    ], ids=["suspend", "reactivate", "retry"])
    def test_lock_failure_is_503_and_changes_nothing(self, client, db, engine, call):
        db.user(INSTRUCTOR).update(is_active=False, suspended_at="2026-10-29T00:59:00+00:00")
        engine.lock_fail = True
        r = call(client)
        assert r.status_code == 503, r.text
        assert r.json()["detail"]["error_code"] == "target_busy"
        assert db.rpc_calls == [] and db.auth.admin.calls == [] and engine.statements == []
        assert db.audits() == []


# ── Role change delegation (FR-007) ──────────────────────────────────────────

class TestRoleChange:
    def _role(self, client, uid, role):
        return client.patch(f"/admin/users/{uid}/role", json={"role": role}, headers=AUTH)

    @pytest.mark.parametrize("target,new_role", [
        (ADMIN2, "student"), (ADMIN2, "instructor"), (INSTRUCTOR, "student")])
    def test_removing_privilege_revokes_sessions_without_a_ban(self, client, db, engine, target, new_role):
        r = self._role(client, target, new_role)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True and body["role"] == new_role and body["changed"] is True
        assert body["sessions_revoked"] is True and body["revoke_error"] is None
        assert target not in engine.sessions
        assert db.auth.admin.calls == []          # demotion = delete only
        audits = db.audits()
        assert [a["id"] for a in audits] == [body["audit_id"]] and audits[0]["event"] == "role_changed"
        assert audits[0]["source"] == "admin_api" and audits[0]["actor_user_id"] == ADMIN

    @pytest.mark.parametrize("target,new_role", [(INSTRUCTOR, "admin"), (LEARNER, "instructor")])
    def test_gaining_privilege_does_not_revoke(self, client, db, engine, target, new_role):
        r = self._role(client, target, new_role)
        assert r.status_code == 200 and r.json()["sessions_revoked"] is None
        assert engine.statements == []

    def test_same_role_is_a_no_op(self, client, db, engine):
        r = self._role(client, INSTRUCTOR, "instructor")
        assert r.json()["changed"] is False and r.json()["audit_id"] is None
        assert r.json()["sessions_revoked"] is None and db.audits() == []

    def test_demotion_revoke_failure_keeps_the_change_and_alerts(self, client, db, engine):
        engine.fail = True
        r = self._role(client, ADMIN2, "student")
        assert r.status_code == 200
        assert r.json()["sessions_revoked"] is False and r.json()["revoke_error"] == "session_delete_failed"
        assert db.user(ADMIN2)["role"] == "student"
        failed = db.audits("sessions_revoke_failed")
        assert len(failed) == 1 and failed[0]["detail"]["trigger"] == "role_change"
        assert any(o["audit_id"] == failed[0]["id"] for o in db.tables["owner_alert_outbox"])

    def test_last_admin_is_409(self, client, db):
        db.rpc_override = "last_admin"
        r = self._role(client, ADMIN2, "student")
        assert r.status_code == 409 and r.json()["detail"]["code"] == "last_admin"

    def test_suspended_account_role_change_is_409(self, client, db, engine):
        _active(client, INSTRUCTOR, False)
        r = self._role(client, INSTRUCTOR, "student")
        assert r.status_code == 409
        assert r.json()["detail"]["code"] == "account_suspended_role_change"
        assert db.user(INSTRUCTOR)["role"] == "instructor"

    def test_actor_suspended_mid_request_is_403(self, client, db):
        db.user(ADMIN).update(is_active=False, suspended_at="2026-10-29T00:59:00+00:00")
        r = self._role(client, ADMIN2, "student")
        assert r.status_code == 403 and db.user(ADMIN2)["role"] == "admin"


# ── Security history (FR-015) ────────────────────────────────────────────────

class TestSecurityAudit:
    def _history(self, client, uid, **params):
        return client.get(f"/admin/users/{uid}/security-audit", params=params, headers=AUTH)

    def test_rows_newest_first_with_actor_email_and_alert_status(self, client, db, engine):
        _active(client, ADMIN2, False)                     # admin event → alert
        engine.fail = True
        client.post(f"/admin/users/{ADMIN2}/revoke-sessions", headers=AUTH)  # failure → alert
        db.tables["owner_alert_outbox"][0]["status"] = "sent"
        r = self._history(client, ADMIN2)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["lookup_failed"] is False
        events = [row["event"] for row in body["rows"]]
        assert events == ["sessions_revoke_failed", "active_changed"]
        newest, oldest = body["rows"]
        assert oldest["actor_email"] == db.user(ADMIN)["email"]
        assert oldest["before"]["is_active"] is True and oldest["after"]["is_active"] is False
        assert oldest["alert_status"] == "sent" and newest["alert_status"] == "pending"
        assert oldest["source"] == "admin_api"

    def test_out_of_band_row_has_no_actor_and_instructor_rows_no_alert(self, client, db):
        db.tables["staff_security_audit"].append({
            "id": str(uuid.uuid4()), "occurred_at": "2026-10-28T10:00:00+00:00",
            "event": "role_changed", "target_user_id": INSTRUCTOR, "actor_user_id": None,
            "source": "out_of_band", "before": {"role": "student"}, "after": {"role": "instructor"},
            "reason": None, "detail": {},
        })
        rows = self._history(client, INSTRUCTOR).json()["rows"]
        assert rows[0]["actor_user_id"] is None and rows[0]["actor_email"] is None
        assert rows[0]["alert_status"] is None and rows[0]["source"] == "out_of_band"

    def test_empty_history_is_an_empty_list(self, client):
        r = self._history(client, LEARNER)
        assert r.status_code == 200 and r.json() == {"rows": [], "lookup_failed": False}

    def test_limit_applies_and_is_bounded(self, client, db):
        for _ in range(3):
            _active(client, INSTRUCTOR, False)
            _active(client, INSTRUCTOR, True)
        assert len(self._history(client, INSTRUCTOR, limit=2).json()["rows"]) == 2
        assert self._history(client, INSTRUCTOR, limit=0).status_code == 422
        assert self._history(client, INSTRUCTOR, limit=201).status_code == 422

    @pytest.mark.parametrize("table", ["staff_security_audit", "users", "owner_alert_outbox"])
    def test_lookup_failure_is_503_never_an_empty_list(self, client, db, table):
        _active(client, ADMIN2, False)
        db.fail_tables.add(table)
        r = self._history(client, ADMIN2)
        assert r.status_code == 503
        assert r.json()["detail"] == {"error_code": "lookup_failed",
                                      "message": "⚠ không tải được lịch sử"}


# ── The routes are admin-only ────────────────────────────────────────────────

@pytest.mark.parametrize("method,path,body", [
    ("PATCH", f"/admin/users/{INSTRUCTOR}/active", {"is_active": False, "reason": "abc"}),
    ("POST", f"/admin/users/{INSTRUCTOR}/revoke-sessions", None),
    ("GET", f"/admin/users/{INSTRUCTOR}/security-audit", None),
])
def test_non_admin_is_refused_before_any_work(db, engine, method, path, body):
    from fastapi import HTTPException
    from main import app

    guard = AsyncMock(side_effect=HTTPException(403, "Bạn không có quyền truy cập trang này"))
    with patch.object(sec_module, "require_admin", new=guard):
        with TestClient(app) as c:
            r = c.request(method, path, json=body, headers=AUTH)
    assert r.status_code == 403
    assert db.rpc_calls == [] and engine.statements == [] and db.ops == []


# ── GET /admin/mfa/status (FR-004) through the real guard ────────────────────

class TestMfaStatus:
    @pytest.fixture
    def harness(self, live_activation_gate, monkeypatch):
        from config import settings
        from services import activation_gate
        import routers.auth as auth_module
        from tests.test_staff_guard import TOKENS, _AuthClient, _DB

        TOKENS.clear()
        guard_db = _DB()
        for module in (admin_module, activation_gate):
            monkeypatch.setattr(module, "supabase_admin", guard_db)
        monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _AuthClient([]))
        monkeypatch.setattr(settings, "ADMIN_AAL2_ENFORCE", True)
        from main import app
        return TestClient(app, raise_server_exceptions=False), guard_db

    def _get(self, api, token):
        return api.get("/admin/mfa/status", headers={"Authorization": f"Bearer {token}"})

    def test_aal1_admin_with_factor_is_told_to_challenge(self, harness):
        from tests.test_staff_guard import VERIFIED, aal1_claims, accept

        api, guard_db = harness
        r = self._get(api, accept("admin-active", aal1_claims("admin-active"), factors=VERIFIED))
        assert r.status_code == 200, r.text
        assert r.json() == {"aal": "aal1", "enforce": True, "verified_factor_count": 1,
                            "next_step": "challenge"}
        assert guard_db.touched == []

    def test_aal1_admin_without_factor_is_told_to_enroll(self, harness):
        from tests.test_staff_guard import aal1_claims, accept

        api, _ = harness
        r = self._get(api, accept("admin-active", aal1_claims("admin-active")))
        assert r.json()["next_step"] == "enroll" and r.json()["verified_factor_count"] == 0

    def test_aal2_admin_needs_nothing(self, harness):
        from tests.test_staff_guard import VERIFIED, aal2_claims, accept

        api, _ = harness
        r = self._get(api, accept("admin-active", aal2_claims("admin-active"), factors=VERIFIED))
        assert r.json() == {"aal": "aal2", "enforce": True, "verified_factor_count": 1,
                            "next_step": "none"}

    @pytest.mark.parametrize("uid,status", [
        ("instructor-active", 403), ("learner-active", 403), ("admin-inactive", 403)])
    def test_non_admin_or_inactive_is_refused(self, harness, uid, status):
        from tests.test_staff_guard import aal1_claims, accept

        api, _ = harness
        assert self._get(api, accept(uid, aal1_claims(uid))).status_code == status

    def test_signed_out_is_401(self, harness):
        api, _ = harness
        assert api.get("/admin/mfa/status").status_code == 401
