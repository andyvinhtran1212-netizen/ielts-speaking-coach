"""ADMINIA-0074 FR-055 — revoke a code that is in use, from the danger zone.

`POST /admin/access-codes/{id}/revoke-used` needs the code retyped and a
reason. It revokes the code in one write (a revoked code grants nothing), never
touches redemption history or assignments, writes the reason and the people who
lose access to access_code_audit, and says so when that audit write fails.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from routers import admin as admin_module


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Res:
    def __init__(self, data=None):
        self.data = [] if data is None else data


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.op, self.payload, self.filters = db, table, "select", None, []

    def select(self, *a, **k):
        self.op = "select"
        return self

    def update(self, payload, *a, **k):
        self.op, self.payload = "update", payload
        return self

    def insert(self, payload, *a, **k):
        self.op, self.payload = "insert", payload
        return self

    def eq(self, col, val):
        self.filters.append((col, val))
        return self

    def limit(self, *a, **k):
        return self

    def execute(self):
        return self.db.resolve(self)


class _DB:
    def __init__(self, code, assignments=(), fail=()):
        self.code = dict(code)
        self.assignments = list(assignments)
        self.fail = set(fail)
        self.writes: list = []
        self.audits: list = []

    def table(self, name):
        return _Q(self, name)

    def resolve(self, q):
        key = f"{q.table}.{q.op}"
        if key in self.fail:
            raise RuntimeError(f"boom {key}")
        if q.table == "access_codes" and q.op == "select":
            return _Res([dict(self.code)] if ("id", self.code["id"]) in q.filters else [])
        if q.table == "access_codes" and q.op == "update":
            self.writes.append((q.table, q.payload, list(q.filters)))
            if ("is_revoked", False) in q.filters and self.code.get("is_revoked"):
                return _Res([])
            self.code.update(q.payload)
            return _Res([dict(self.code)])
        if q.table == "user_code_assignments" and q.op == "select":
            want_active = ("is_active", True) in q.filters
            return _Res([a for a in self.assignments if not want_active or a["is_active"]])
        if q.table == "access_code_audit" and q.op == "insert":
            self.audits.append(q.payload)
            return _Res([q.payload])
        if q.op != "select":
            self.writes.append((q.table, q.payload, list(q.filters)))
        return _Res([])


CODE = {
    "id": "c1", "code": "ABCD-EFGH-JKLM", "is_revoked": False, "is_active": True,
    "is_used": True, "used_by": "u1", "used_at": "2026-11-01T00:00:00Z",
}
ASSIGNMENTS = [
    {"user_id": "u1", "is_active": True},
    {"user_id": "u2", "is_active": True},
    {"user_id": "u3", "is_active": False},
]
REASON = "Học viên chuyển lớp, mã cấp nhầm"


def _wire(monkeypatch, db):
    async def _admin(_authz):
        return {"id": "admin-1"}
    step_up_calls: list = []
    monkeypatch.setattr(admin_module, "require_admin", _admin)
    monkeypatch.setattr(admin_module, "supabase_admin", db)
    monkeypatch.setattr(admin_module.staff_guard, "require_recent_mfa",
                        lambda admin, authz: step_up_calls.append(admin["id"]))
    return step_up_calls


def _call(code_id="c1", confirm="ABCD-EFGH-JKLM", reason=REASON):
    body = admin_module.RevokeUsedCodeRequest(confirm_code=confirm, reason=reason)
    return _run(admin_module.revoke_used_access_code(code_id, body, authorization="Bearer t"))


def test_revokes_in_one_write_and_audits_reason_and_affected_people(monkeypatch):
    db = _DB(CODE, ASSIGNMENTS)
    step_up = _wire(monkeypatch, db)
    out = _call(confirm="  abcd-efgh-jklm ")
    assert step_up == ["admin-1"]
    assert out == {"id": "c1", "code": "ABCD-EFGH-JKLM", "is_revoked": True,
                   "already_revoked": False, "affected_user_count": 2, "audit_recorded": True}
    # Exactly one write, to access_codes, guarded against a concurrent revoke.
    assert db.writes == [("access_codes", {"is_revoked": True, "is_active": False},
                          [("id", "c1"), ("is_revoked", False)])]
    # Redemption history is immutable.
    assert db.code["is_used"] is True and db.code["used_by"] == "u1" and db.code["used_at"]
    [audit] = db.audits
    assert audit["actor_user_id"] == "admin-1" and audit["action"] == "revoke"
    assert audit["after"]["reason"] == REASON
    assert audit["after"]["affected_user_ids"] == ["u1", "u2"]
    assert audit["after"]["source"] == "danger_zone"


def test_legacy_redeemer_without_assignment_row_counts_as_losing_access(monkeypatch):
    # access_code_permissions grants through used_by when the user has no
    # assignment row for the code, so revoking takes that access away too.
    db = _DB({**CODE, "used_by": "legacy"}, ASSIGNMENTS)
    _wire(monkeypatch, db)
    out = _call()
    assert out["affected_user_count"] == 3
    assert db.audits[0]["after"]["affected_user_ids"] == ["legacy", "u1", "u2"]


def test_used_by_with_inactive_row_is_not_counted(monkeypatch):
    # An inactive assignment row is a deliberate per-user removal: used_by
    # does not re-grant, so that person does not lose anything now.
    db = _DB({**CODE, "used_by": "u3"}, ASSIGNMENTS)
    _wire(monkeypatch, db)
    out = _call()
    assert out["affected_user_count"] == 2
    assert db.audits[0]["after"]["affected_user_ids"] == ["u1", "u2"]


def test_legacy_only_code_counts_its_redeemer(monkeypatch):
    db = _DB(CODE, [])
    _wire(monkeypatch, db)
    out = _call()
    assert out["affected_user_count"] == 1
    assert db.audits[0]["after"]["affected_user_ids"] == ["u1"]


def test_wrong_confirmation_changes_nothing(monkeypatch):
    db = _DB(CODE, ASSIGNMENTS)
    _wire(monkeypatch, db)
    with pytest.raises(HTTPException) as exc:
        _call(confirm="ABCD-EFGH-JKLX")
    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "confirm_code_mismatch"
    assert db.writes == [] and db.audits == []


@pytest.mark.parametrize("reason", ["   ", "ngắn quá", "  a b c d  "])
def test_short_reason_is_refused_before_any_read(monkeypatch, reason):
    db = _DB(CODE, ASSIGNMENTS, fail={"access_codes.select"})
    _wire(monkeypatch, db)
    with pytest.raises(HTTPException) as exc:
        _call(reason=reason)
    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "reason_too_short"


def test_empty_reason_fails_model_validation():
    with pytest.raises(Exception):
        admin_module.RevokeUsedCodeRequest(confirm_code="X", reason="")


def test_unknown_code_is_404(monkeypatch):
    db = _DB(CODE, ASSIGNMENTS)
    _wire(monkeypatch, db)
    with pytest.raises(HTTPException) as exc:
        _call(code_id="missing")
    assert exc.value.status_code == 404
    assert db.writes == []


def test_already_revoked_is_idempotent_and_writes_nothing(monkeypatch):
    db = _DB({**CODE, "is_revoked": True, "is_active": False}, ASSIGNMENTS)
    _wire(monkeypatch, db)
    out = _call()
    assert out["already_revoked"] is True and out["is_revoked"] is True
    assert db.writes == [] and db.audits == []


def test_assignment_lookup_failure_fails_closed(monkeypatch):
    db = _DB(CODE, ASSIGNMENTS, fail={"user_code_assignments.select"})
    _wire(monkeypatch, db)
    with pytest.raises(HTTPException) as exc:
        _call()
    assert exc.value.status_code == 500
    assert db.writes == [] and db.code["is_revoked"] is False


def test_concurrent_revoke_reports_already_revoked_without_audit(monkeypatch):
    db = _DB(CODE, ASSIGNMENTS)
    _wire(monkeypatch, db)
    original = db.resolve

    def racing(q):
        if q.table == "access_codes" and q.op == "update":
            db.code["is_revoked"] = True
        return original(q)
    db.resolve = racing
    out = _call()
    assert out["already_revoked"] is True
    assert db.audits == []


def test_audit_failure_is_reported_not_hidden(monkeypatch):
    db = _DB(CODE, ASSIGNMENTS, fail={"access_code_audit.insert"})
    _wire(monkeypatch, db)
    out = _call()
    assert out["is_revoked"] is True and out["audit_recorded"] is False
    assert db.code["is_revoked"] is True


def test_route_is_registered_with_step_up_responses():
    from main import app
    route = next(r for r in app.routes
                 if getattr(r, "path", "") == "/admin/access-codes/{code_id}/revoke-used")
    assert route.methods == {"POST"}
    assert 403 in route.responses or "403" in route.responses
