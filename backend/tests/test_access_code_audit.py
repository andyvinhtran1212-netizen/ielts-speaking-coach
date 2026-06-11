"""Mã kích hoạt Phase B (final) — entitlement-edit audit trail.

Every entitlement mutation writes exactly one access_code_audit row capturing
actor (from auth context, not body) / action / code_id / target_user_id /
before / after. Audit is BEST-EFFORT: a logging failure must not break the
action it records.

These tests spy on admin._audit_entitlement to assert each endpoint logs the
right row, plus a direct test of the helper's insert + best-effort behaviour.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from routers import admin as admin_module


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Permissive DB stub: enough for each endpoint to reach the audit call ──────


class _Res:
    def __init__(self, data=None, count=None):
        self.data = [] if data is None else data
        self.count = count


class _Q:
    def __init__(self, db, table):
        self._db, self._t = db, table
        self._op = "select"
        self._payload = None
        self._count = False

    def select(self, *a, **k):
        self._op = "select"
        self._count = (k.get("count") == "exact")
        return self

    def insert(self, payload, *a, **k):
        self._op, self._payload = "insert", payload
        return self

    def update(self, payload, *a, **k):
        self._op, self._payload = "update", payload
        return self

    def upsert(self, payload, *a, **k):
        self._op, self._payload = "upsert", payload
        return self

    def delete(self, *a, **k):
        self._op = "delete"
        return self

    def eq(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self

    def execute(self):
        return self._db._resolve(self._t, self._op, self._payload, self._count)


class _DB:
    def __init__(self, **cfg):
        self.cfg = cfg
        self.audits: list = []

    def table(self, name):
        return _Q(self, name)

    def _resolve(self, table, op, payload, count):
        if table == "access_code_audit" and op == "insert":
            self.audits.append(payload)
            return _Res([payload])
        if table == "access_codes":
            if op == "select":
                return _Res(self.cfg.get("code_row", [{"id": "c1"}]))
            if op == "insert":
                rows = payload if isinstance(payload, list) else [payload]
                return _Res([{**r, "id": r.get("id", f"new-{i}")} for i, r in enumerate(rows)])
            if op == "update":
                return _Res([{"id": "c1", **(payload or {})}])
            if op == "delete":
                return _Res([])
        if table == "user_code_assignments":
            if op == "select":
                return _Res(self.cfg.get("asgn_rows", [{"id": "a1"}]),
                            count=self.cfg.get("asgn_count", 0))
            if op == "update":
                return _Res(self.cfg.get("asgn_update", [{"id": "a1"}]))
            return _Res([])
        if table == "users":
            return _Res([{"role": "admin"}])
        return _Res([])


def _wire(monkeypatch, **cfg):
    """Admin guard passes (actor = admin-1); DB stubbed; _audit_entitlement spied."""
    async def _admin(_authz):
        return {"id": "admin-1"}
    db = _DB(**cfg)
    spy: list = []

    def _spy(actor, action, code_id, *, target_user_id=None, before=None, after=None):
        spy.append({"actor": actor, "action": action, "code_id": code_id,
                    "target_user_id": target_user_id, "before": before, "after": after})

    monkeypatch.setattr(admin_module, "require_admin", _admin)
    monkeypatch.setattr(admin_module, "supabase_admin", db)
    monkeypatch.setattr(admin_module, "_audit_entitlement", _spy)
    return spy


# ── Per-endpoint: exactly one audit row with the right shape ──────────────────


def test_generate_audits_create_per_code(monkeypatch):
    spy = _wire(monkeypatch)
    body = admin_module.GenerateCodesRequest(count=2, permissions=["all"], code_type="mass")
    _run(admin_module.generate_access_codes(body, authorization="Bearer x"))
    creates = [s for s in spy if s["action"] == "create"]
    assert len(creates) == 2
    assert all(s["actor"] == "admin-1" and s["after"] is not None for s in creates)


def test_patch_audits_edit_with_before_after_diff(monkeypatch):
    spy = _wire(monkeypatch, code_row=[{"permissions": ["all"]}])
    body = admin_module.PatchCodeRequest(permissions=["writing"])
    _run(admin_module.patch_access_code("c1", body, authorization="Bearer x"))
    edits = [s for s in spy if s["action"] == "edit"]
    assert len(edits) == 1
    e = edits[0]
    assert e["actor"] == "admin-1" and e["code_id"] == "c1"
    assert e["before"] == {"permissions": ["all"]}      # only the changed field
    assert e["after"] == {"permissions": ["writing"]}


def test_revoke_audits_revoke(monkeypatch):
    spy = _wire(monkeypatch, code_row=[{"id": "c1", "code": "AAA-111", "is_revoked": False}],
                asgn_count=0)
    _run(admin_module.delete_access_code("c1", authorization="Bearer x"))
    revs = [s for s in spy if s["action"] == "revoke"]
    assert len(revs) == 1
    assert revs[0]["after"] == {"is_revoked": True, "is_active": False}


def test_remove_user_audits_with_target(monkeypatch):
    spy = _wire(monkeypatch, asgn_update=[{"id": "a1"}])
    _run(admin_module.remove_user_from_code("c1", "u-9", authorization="Bearer x"))
    rows = [s for s in spy if s["action"] == "remove_user"]
    assert len(rows) == 1
    assert rows[0]["target_user_id"] == "u-9" and rows[0]["code_id"] == "c1"


def test_hard_delete_audits_with_snapshot(monkeypatch):
    spy = _wire(monkeypatch,
                code_row=[{"id": "c1", "code": "AAA-111", "permissions": ["all"], "session_limit": 90}],
                asgn_count=0)
    _run(admin_module.hard_delete_access_code("c1", authorization="Bearer x"))
    dels = [s for s in spy if s["action"] == "hard_delete"]
    assert len(dels) == 1
    assert dels[0]["before"]["code"] == "AAA-111" and dels[0]["after"] is None


def test_actor_id_comes_from_auth_not_body(monkeypatch):
    # The spy records actor='admin-1' from require_admin's return, never a body field.
    spy = _wire(monkeypatch, code_row=[{"permissions": ["all"]}])
    _run(admin_module.patch_access_code("c1", admin_module.PatchCodeRequest(permissions=["writing"]),
                                        authorization="Bearer x"))
    assert all(s["actor"] == "admin-1" for s in spy)


# ── The helper itself: real insert + best-effort ─────────────────────────────


def test_audit_helper_inserts_one_row(monkeypatch):
    db = _DB()
    monkeypatch.setattr(admin_module, "supabase_admin", db)
    admin_module._audit_entitlement("admin-1", "edit", "c1",
                                    before={"x": 1}, after={"x": 2})
    assert len(db.audits) == 1
    row = db.audits[0]
    assert row["actor_user_id"] == "admin-1" and row["action"] == "edit"
    assert row["code_id"] == "c1" and row["before"] == {"x": 1} and row["after"] == {"x": 2}


def test_audit_helper_is_best_effort(monkeypatch):
    class _Boom:
        def table(self, *_a, **_k): raise RuntimeError("DB down")
    monkeypatch.setattr(admin_module, "supabase_admin", _Boom())
    # Must NOT raise — a logging failure can't break the action it records.
    admin_module._audit_entitlement("admin-1", "revoke", "c1")
