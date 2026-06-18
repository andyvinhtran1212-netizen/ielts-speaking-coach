"""W-8-core — GET /admin/instructors per-instructor oversight metrics.

Asserts the 4 metrics against a fixture, with owner-derivation matching the
accessor (assignment.assigned_by ∪ student.instructor_id) and cost sourced from
writing_feedback (NOT ai_usage_logs).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


def _u(n): return f"00000000-0000-0000-0000-{n:012d}"
X, Y = _u(1), _u(2)                  # X = the instructor under test; Y = another GV
SX1, SX2, SY = _u(11), _u(12), _u(13)
EX1, EX2 = _u(21), _u(22)


class _R:
    def __init__(self, data): self.data = data


class _Q:
    def __init__(self, t, store): self.t = t; self.s = store; self.f = []; self.op = "select"
    def select(self, *a, **k): self.op = "select"; return self
    def eq(self, c, v): self.f.append(("eq", c, v)); return self
    def in_(self, c, vs): self.f.append(("in", c, [str(x) for x in vs])); return self
    def is_(self, c, v): self.f.append(("is", c, v)); return self
    def limit(self, *a, **k): return self
    def order(self, *a, **k): return self
    def _match(self, row):
        for op, c, v in self.f:
            rv = row.get(c)
            if op == "eq" and str(rv) != str(v): return False
            if op == "in" and str(rv) not in v: return False
            if op == "is" and v == "null" and rv is not None: return False
        return True
    def execute(self):
        return _R([dict(r) for r in self.s.get(self.t, []) if self._match(r)])


class _SB:
    def __init__(self, store): self.store = store
    def table(self, name): return _Q(name, self.store)


def _store():
    return {
        "users": [{"id": X, "role": "instructor", "email": "x@x", "display_name": "GV X"},
                  {"id": Y, "role": "instructor", "email": "y@y", "display_name": "GV Y"}],
        "students": [
            {"id": SX1, "instructor_id": X}, {"id": SX2, "instructor_id": X},
            {"id": SY, "instructor_id": Y},
        ],
        "writing_assignments": [
            {"id": _u(31), "assigned_by": X, "essay_id": EX1},   # assignment branch → EX1
        ],
        "writing_essays": [
            {"id": EX1, "student_id": SX1, "status": "delivered", "regrade_count": 2},
            {"id": EX2, "student_id": SX2, "status": "graded",    "regrade_count": 0},
        ],
        "writing_feedback": [
            {"essay_id": EX1, "tokens_input": 100, "tokens_output": 50, "cost_usd": 0.1},
            {"essay_id": EX2, "tokens_input": 200, "tokens_output": 100, "cost_usd": 0.2},
        ],
    }


def _client():
    from main import app
    return TestClient(app)


def test_instructor_metrics_aggregate():
    store = _store()
    fake = _SB(store)
    with patch("routers.admin_instructors.require_admin", new=AsyncMock(return_value={"id": "admin"})), \
         patch("routers.admin_instructors.supabase_admin", fake), \
         patch("services.instructor_access.supabase_admin", fake):
        r = _client().get("/admin/instructors", headers={"Authorization": "Bearer x"})
    assert r.status_code == 200, r.text
    rows = {row["instructor_id"]: row for row in r.json()}
    gx = rows[X]
    assert gx["students"] == 2                 # SX1, SX2 (SY belongs to Y)
    assert gx["graded"] == 1                   # EX1 delivered (EX2 only graded)
    assert gx["regraded"] == 1                 # EX1 has regrade_count>0
    assert gx["regrade_events"] == 2           # sum(regrade_count)
    assert gx["tokens"] == 450                 # 150 + 300, from writing_feedback
    assert abs(gx["cost_usd"] - 0.3) < 1e-6    # 0.1 + 0.2
    # Y is listed but owns nothing → zeros (no cross-attribution of X's data)
    assert rows[Y]["students"] == 1 and rows[Y]["graded"] == 0 and rows[Y]["tokens"] == 0
