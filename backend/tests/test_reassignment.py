"""
tests/test_reassignment.py — Sprint 17.5 (Direction E).

Reassign / refill (admin.py) + cohort member add/remove (cohorts.py). Pins:
activate-target-before-deactivate-source ordering, audit columns, immutability
(reassign never writes access_codes), refill issues a mirrored code, cohort
add/remove, and the admin guard.
"""

import asyncio

import pytest

from routers import admin as admin_module
from routers import cohorts as cohorts_module


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Exec:
    def __init__(self, data): self.data = data


class _Q:
    def __init__(self, name, tables, ops):
        self.name, self.t, self.ops = name, tables, ops
        self.eqs, self.op, self.payload = [], "select", None

    def select(self, *a, **k): self.op = "select"; return self
    def insert(self, p): self.op = "insert"; self.payload = p; return self
    def upsert(self, p, **k): self.op = "upsert"; self.payload = p; return self
    def update(self, p): self.op = "update"; self.payload = p; return self
    def limit(self, *a, **k): return self

    def eq(self, c, v): self.eqs.append((c, v)); return self
    def in_(self, c, v): self.eqs.append((c, ("__in__", v))); return self

    def execute(self):
        self.ops.append({"table": self.name, "op": self.op, "payload": self.payload, "eqs": self.eqs})
        if self.op in ("insert", "upsert"):
            rows = self.payload if isinstance(self.payload, list) else [self.payload]
            stored = self.t.setdefault(self.name, [])
            result = []
            for row in rows:
                existing = next((r for r in stored
                                 if self.op == "upsert" and self.name == "user_code_assignments"
                                 and r.get("user_id") == row.get("user_id")
                                 and r.get("code_id") == row.get("code_id")), None)
                if existing is None:
                    existing = dict(row, id=row.get("id", f"new-{len(stored) + 1}"))
                    stored.append(existing)
                else:
                    existing.update(row)
                result.append(existing)
            return _Exec(result)
        rows = list(self.t.get(self.name, []))
        for c, v in self.eqs:
            if isinstance(v, tuple):
                continue   # in_ filter not enforced by the stub
            rows = [r for r in rows if r.get(c) == v]
        if self.op == "update":
            for row in rows:
                row.update(self.payload)
        return _Exec(rows)


class _Stub:
    def __init__(self, tables, ops): self.t, self.ops = tables, ops
    def table(self, name): return _Q(name, self.t, self.ops)


def _install(monkeypatch, tables):
    ops: list = []
    async def _ok(_authz): return {"id": "admin-1"}
    stub = _Stub(tables, ops)
    monkeypatch.setattr(admin_module, "require_admin", _ok)
    monkeypatch.setattr(admin_module, "supabase_admin", stub)
    monkeypatch.setattr(cohorts_module, "require_admin", _ok)
    monkeypatch.setattr(cohorts_module, "supabase_admin", stub)
    return ops


# ── Reassign ─────────────────────────────────────────────────────────────────

def test_reassign_activates_target_before_deactivating_source(monkeypatch):
    ops = _install(monkeypatch, {
        "access_codes": [{"id": "c1", "is_revoked": False}],
        "user_code_assignments": [{"id": "a1", "code_id": "c1", "user_id": "uA", "is_active": True}],
    })
    out = _run(admin_module.reassign_code(
        "c1", admin_module.ReassignRequest(from_user_id="uA", to_user_id="uB", reason="transfer"),
        authorization="x"))
    assert out["ok"] and out["to_user_id"] == "uB"
    uca_ops = [o for o in ops if o["table"] == "user_code_assignments"]
    upsert_i = next(i for i, o in enumerate(uca_ops) if o["op"] == "upsert")
    update_i = next(i for i, o in enumerate(uca_ops) if o["op"] == "update")
    assert upsert_i < update_i                                  # target activated first
    # audit columns written on both sides
    assert uca_ops[upsert_i]["payload"]["user_id"] == "uB"
    assert uca_ops[upsert_i]["payload"]["assigned_by"] == "admin-1"
    assert uca_ops[update_i]["payload"]["is_active"] is False
    assert "revoked_at" in uca_ops[update_i]["payload"]


def test_reassign_never_writes_access_codes_immutability(monkeypatch):
    ops = _install(monkeypatch, {
        "access_codes": [{"id": "c1", "is_revoked": False}],
        "user_code_assignments": [{"id": "a1", "code_id": "c1", "user_id": "uA", "is_active": True}],
    })
    _run(admin_module.reassign_code(
        "c1", admin_module.ReassignRequest(from_user_id="uA", to_user_id="uB"), authorization="x"))
    assert not any(o["table"] == "access_codes" and o["op"] in ("update", "insert", "upsert") for o in ops)


def test_reassign_same_user_rejected(monkeypatch):
    _install(monkeypatch, {"access_codes": [{"id": "c1", "is_revoked": False}]})
    with pytest.raises(Exception) as ei:
        _run(admin_module.reassign_code(
            "c1", admin_module.ReassignRequest(from_user_id="uA", to_user_id="uA"), authorization="x"))
    assert getattr(ei.value, "status_code", None) == 400


def test_reassign_source_without_active_assignment_404(monkeypatch):
    _install(monkeypatch, {
        "access_codes": [{"id": "c1", "is_revoked": False}],
        "user_code_assignments": [],
    })
    with pytest.raises(Exception) as ei:
        _run(admin_module.reassign_code(
            "c1", admin_module.ReassignRequest(from_user_id="uA", to_user_id="uB"), authorization="x"))
    assert getattr(ei.value, "status_code", None) == 404


# ── Refill (new code) ──────────────────────────────────────────────────────────

def test_refill_issues_mirrored_code_and_assigns(monkeypatch):
    ops = _install(monkeypatch, {
        "access_codes": [{"id": "c1", "used_by": "uA", "code_type": "direct",
                          "cohort_id": "co1", "permissions": ["all"], "session_limit": 10}],
    })
    out = _run(admin_module.refill_code("c1", admin_module.RefillRequest(reason="quota out"), authorization="x"))
    assert out["ok"] and out["user_id"] == "uA" and out["new_code"]
    ins = next(o for o in ops if o["table"] == "access_codes" and o["op"] == "insert")
    assert ins["payload"]["is_used"] is True and ins["payload"]["used_by"] == "uA"
    assert ins["payload"]["cohort_id"] == "co1" and ins["payload"]["session_limit"] == 10
    assert any(o["table"] == "user_code_assignments" and o["op"] == "upsert" for o in ops)


# ── Admin-side activation ───────────────────────────────────────────────────────

@pytest.mark.parametrize("role", ["user", "instructor", "admin"])
def test_generate_and_assign_activates_login_with_assigned_permissions(monkeypatch, role):
    from routers import auth as auth_module

    tables = {
        "users": [{"id": "uX", "role": role, "is_active": False,
                   "onboarding_completed": False}],
    }
    ops = _install(monkeypatch, tables)
    monkeypatch.setattr(auth_module, "supabase_admin", _Stub(tables, ops))

    async def current_user(_authorization):
        return {"id": "uX"}

    monkeypatch.setattr(auth_module, "get_supabase_user", current_user)
    assert _run(auth_module.check_active(authorization="x")) == {"is_active": False}
    out = _run(admin_module.generate_and_assign_code(
        admin_module.GenerateAndAssignRequest(
            user_id="uX", permissions=["practice_single"], session_limit=10,
        ), authorization="x"))

    assert out["ok"] and out["user_id"] == "uX"
    assert _run(auth_module.check_active(authorization="x")) == {"is_active": True}
    assert tables["users"][0]["role"] == role
    assert tables["users"][0]["onboarding_completed"] is False
    issued = next(o for o in ops if o["table"] == "access_codes" and o["op"] == "insert")
    activated = next(o for o in ops if o["table"] == "users" and o["op"] == "update")
    assert activated["eqs"] == [("id", "uX")]
    assert activated["payload"] == {
        "is_active": True,
        "access_code_used": issued["payload"]["code"],
        "permissions": ["practice_single"],
    }
    assignment_index = next(i for i, o in enumerate(ops)
                            if o["table"] == "user_code_assignments" and o["op"] == "upsert")
    assert assignment_index < ops.index(activated)
    # Existing code ownership/redemption is never rewritten during activation.
    assert not any(o["table"] == "access_codes" and o["op"] == "update" for o in ops)


@pytest.mark.parametrize("failure", ["exception", "no_rows"])
def test_generate_and_assign_compensates_failed_activation_before_retry(monkeypatch, failure):
    from fastapi import HTTPException

    old_code = {"id": "prior", "code": "PRIOR-CODE", "is_active": True,
                "is_used": True, "used_by": "uX", "used_at": "2026-10-01"}
    old_assignment = {"id": "prior-assignment", "code_id": "prior", "user_id": "uX",
                      "is_active": True}
    tables = {"users": [{"id": "uX", "is_active": False}],
              "access_codes": [dict(old_code)],
              "user_code_assignments": [dict(old_assignment)]}
    ops = _install(monkeypatch, tables)
    original_execute = _Q.execute

    def fail_activation(query):
        if query.name == "users" and query.op == "update":
            if failure == "no_rows":
                return _Exec([])
            raise RuntimeError("activation write failed")
        return original_execute(query)

    monkeypatch.setattr(_Q, "execute", fail_activation)
    with pytest.raises((RuntimeError, HTTPException)) as exc:
        _run(admin_module.generate_and_assign_code(
            admin_module.GenerateAndAssignRequest(user_id="uX"), authorization="x"))
    if failure == "no_rows":
        assert exc.value.status_code == 404
    else:
        assert str(exc.value) == "activation write failed"
    assert not any(o["table"] == "access_code_audit" for o in ops)
    failed_code = tables["access_codes"][-1]
    assert failed_code["is_active"] is False and failed_code["is_revoked"] is True
    assert failed_code["is_used"] is True and failed_code["used_by"] == "uX"
    assert tables["user_code_assignments"][-1]["is_active"] is False
    assert tables["users"][0]["is_active"] is False
    assert tables["access_codes"][0] == old_code
    assert tables["user_code_assignments"][0] == old_assignment

    monkeypatch.setattr(_Q, "execute", original_execute)
    out = _run(admin_module.generate_and_assign_code(
        admin_module.GenerateAndAssignRequest(user_id="uX"), authorization="x"))
    assert out["ok"] and tables["users"][0]["is_active"] is True
    assert [r["id"] for r in tables["access_codes"]
            if r.get("is_active") and not r.get("is_revoked")
            and r["id"] != "prior"] == [out["code_id"]]
    assert [r["code_id"] for r in tables["user_code_assignments"]
            if r["is_active"] and r["code_id"] != "prior"] == [out["code_id"]]


def test_generate_and_assign_missing_user_does_not_issue_code(monkeypatch):
    from fastapi import HTTPException
    ops = _install(monkeypatch, {"users": []})
    with pytest.raises(HTTPException) as exc:
        _run(admin_module.generate_and_assign_code(
            admin_module.GenerateAndAssignRequest(user_id="missing"), authorization="x"))
    assert exc.value.status_code == 404
    assert not any(o["op"] in ("insert", "upsert", "update") for o in ops)

# ── Cohort add / remove member ───────────────────────────────────────────────────

def test_cohort_add_member_issues_direct_code(monkeypatch):
    ops = _install(monkeypatch, {"cohorts": [{"id": "co1"}]})
    out = _run(cohorts_module.add_cohort_member(
        "co1", cohorts_module.AddMemberRequest(user_id="uX"), authorization="x"))
    assert out["ok"] and out["user_id"] == "uX" and out["new_code"]
    ins = next(o for o in ops if o["table"] == "access_codes" and o["op"] == "insert")
    assert ins["payload"]["cohort_id"] == "co1" and ins["payload"]["code_type"] == "direct"
    assert ins["payload"]["used_by"] == "uX"


def test_cohort_remove_member_deactivates_assignments(monkeypatch):
    ops = _install(monkeypatch, {
        "cohorts": [{"id": "co1"}],
        "access_codes": [{"id": "c1", "cohort_id": "co1"}, {"id": "c2", "cohort_id": "co1"}],
    })
    _run(cohorts_module.remove_cohort_member("co1", "uX", authorization="x"))
    upd = next(o for o in ops if o["table"] == "user_code_assignments" and o["op"] == "update")
    assert upd["payload"]["is_active"] is False and "revoked_at" in upd["payload"]
    assert ("user_id", "uX") in upd["eqs"]


def test_reassign_admin_guarded(monkeypatch):
    from fastapi import HTTPException
    async def _deny(_authz): raise HTTPException(403, "forbidden")
    monkeypatch.setattr(admin_module, "require_admin", _deny)
    with pytest.raises(HTTPException) as ei:
        _run(admin_module.reassign_code(
            "c1", admin_module.ReassignRequest(from_user_id="uA", to_user_id="uB"), authorization="x"))
    assert ei.value.status_code == 403
