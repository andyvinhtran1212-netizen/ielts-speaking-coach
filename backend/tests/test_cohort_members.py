"""
tests/test_cohort_members.py — WF-1 (class roster).

GET /admin/cohorts/{id}/members — CLASS ROSTER from `students.cohort_id` (the
single source of truth writing fan-out + grade-matrix also read), with per-member
usage joined via students.user_id (Sprint 17.2 aggregation). Pins: roster =
students in the cohort, students without a linked user show zero usage, other
cohorts excluded, 404, guard.
"""

import asyncio

import pytest

from routers import cohorts as cohorts_module
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
    def __init__(self, name, tables, sink=None):
        self._name, self._t, self._eqs = name, tables, []
        self._sink, self._upd = sink, None

    def select(self, *a, **k): return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def gte(self, *a, **k): return self
    def lte(self, *a, **k): return self

    def update(self, payload):
        self._upd = payload
        return self

    def eq(self, col, val):
        self._eqs.append((col, val))
        return self

    def execute(self):
        rows = list(self._t.get(self._name, []))
        for col, val in self._eqs:
            rows = [r for r in rows if r.get(col) == val]
        if self._upd is not None and self._sink is not None:
            self._sink.append({"table": self._name, "payload": self._upd, "eqs": list(self._eqs)})
        return _Exec(rows)


class _Stub:
    def __init__(self, tables):
        self._t = tables
        self.writes = []   # records update() calls for assertions

    def table(self, name):
        return _B(name, self._t, self.writes)


def _install(monkeypatch, tables):
    async def _ok(_authz):
        return {"id": "admin"}
    stub = _Stub(tables)
    monkeypatch.setattr(cohorts_module, "require_admin", _ok)
    # The cohort endpoint queries via cohorts' client; the reused aggregator queries
    # via admin's client — patch BOTH to the same stub.
    monkeypatch.setattr(cohorts_module, "supabase_admin", stub)
    monkeypatch.setattr(admin_module, "supabase_admin", stub)
    return stub


def test_members_roster_from_students_cohort_id_with_usage(monkeypatch):
    _install(monkeypatch, {
        "cohorts": [{"id": "co1", "name": "Lớp A", "is_active": True, "description": "x"}],
        "students": [
            {"id": "s1", "student_code": "S001", "full_name": "An",   "cohort_id": "co1", "user_id": "u1"},
            {"id": "s2", "student_code": "S002", "full_name": "Bình", "cohort_id": "co1", "user_id": None},  # not activated → zero usage
            {"id": "s3", "student_code": "S003", "full_name": "Khác", "cohort_id": "other"},                 # other cohort → excluded
        ],
        "sessions": [{"user_id": "u1", "started_at": "2026-01-02T00:00:00Z"},
                     {"user_id": "u1", "started_at": "2026-01-09T00:00:00Z"}],
        "ai_usage_logs": [{"user_id": "u1", "cost_usd_est": 0.05}],
    })
    out = _run(cohorts_module.cohort_members("co1", authorization="x"))
    assert out["member_count"] == 2   # s1 + s2, NOT s3 (other cohort)
    by_code = {m["student_code"]: m for m in out["members"]}
    assert set(by_code) == {"S001", "S002"}
    assert by_code["S001"]["user_id"] == "u1"
    assert by_code["S001"]["sessions"] == 2 and by_code["S001"]["ai_cost_usd"] == 0.05
    assert by_code["S001"]["last_active"] == "2026-01-09T00:00:00Z"
    # student with no linked user → zero usage, never crashes
    assert by_code["S002"]["user_id"] is None
    assert by_code["S002"]["sessions"] == 0 and by_code["S002"]["ai_cost_usd"] == 0.0


def test_members_empty_when_cohort_has_no_students(monkeypatch):
    _install(monkeypatch, {
        "cohorts": [{"id": "co1", "name": "Lớp A", "is_active": True}],
        "students": [],   # no students assigned to this cohort
    })
    out = _run(cohorts_module.cohort_members("co1", authorization="x"))
    assert out["member_count"] == 0 and out["members"] == []


def test_members_404_when_cohort_missing(monkeypatch):
    from fastapi import HTTPException
    _install(monkeypatch, {"cohorts": []})
    with pytest.raises(HTTPException) as ei:
        _run(cohorts_module.cohort_members("nope", authorization="x"))
    assert ei.value.status_code == 404


def test_members_admin_guarded(monkeypatch):
    from fastapi import HTTPException

    async def _deny(_authz):
        raise HTTPException(403, "forbidden")
    monkeypatch.setattr(cohorts_module, "require_admin", _deny)
    monkeypatch.setattr(cohorts_module, "supabase_admin", _Stub({}))
    with pytest.raises(HTTPException) as ei:
        _run(cohorts_module.cohort_members("co1", authorization="x"))
    assert ei.value.status_code == 403


# ── WF-1 roster assign / remove (students.cohort_id; NO code issued) ──────────

def test_assign_student_sets_cohort_id_no_code(monkeypatch):
    stub = _install(monkeypatch, {
        "cohorts":  [{"id": "co1", "name": "Lớp A"}],
        "students": [{"id": "s1", "student_code": "S001", "full_name": "An", "cohort_id": None}],
    })
    body = cohorts_module.AssignStudentRequest(student_id="s1")
    out = _run(cohorts_module.assign_student_to_cohort("co1", body, authorization="x"))
    assert out["ok"] and out["cohort_id"] == "co1"
    # exactly one write: students.cohort_id = co1 for s1 (NO user_code_assignments touched)
    sw = [w for w in stub.writes if w["table"] == "students"]
    assert len(sw) == 1 and sw[0]["payload"] == {"cohort_id": "co1"}
    assert ("id", "s1") in sw[0]["eqs"]
    assert not [w for w in stub.writes if w["table"] in ("user_code_assignments", "access_codes")]


def test_assign_student_404_when_student_missing(monkeypatch):
    from fastapi import HTTPException
    _install(monkeypatch, {"cohorts": [{"id": "co1"}], "students": []})
    body = cohorts_module.AssignStudentRequest(student_id="ghost")
    with pytest.raises(HTTPException) as ei:
        _run(cohorts_module.assign_student_to_cohort("co1", body, authorization="x"))
    assert ei.value.status_code == 404


def test_remove_student_clears_cohort_id(monkeypatch):
    stub = _install(monkeypatch, {
        "students": [{"id": "s1", "cohort_id": "co1"}],
    })
    _run(cohorts_module.remove_student_from_cohort("co1", "s1", authorization="x"))
    sw = [w for w in stub.writes if w["table"] == "students"]
    assert len(sw) == 1 and sw[0]["payload"] == {"cohort_id": None}


def test_remove_student_noop_when_in_other_cohort(monkeypatch):
    # student is in a DIFFERENT cohort → request must NOT yank them out
    stub = _install(monkeypatch, {
        "students": [{"id": "s1", "cohort_id": "other"}],
    })
    _run(cohorts_module.remove_student_from_cohort("co1", "s1", authorization="x"))
    assert not [w for w in stub.writes if w["table"] == "students"]
