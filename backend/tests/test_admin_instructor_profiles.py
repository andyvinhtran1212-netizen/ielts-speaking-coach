"""ADMINIA-0074 FR-106 (G09-T40): admin Giáo viên table and profile.

* classes come from cohorts.instructor_id (active only), one teacher per class;
* Writing waiting per class = queue RPC totals for graded + reviewed + failed,
  non-mock; overdue = the queue's overdue filter;
* review speed = delivered instructor_reviews in 30 days, blank below 5;
* a failing source gives None for that field, never 0;
* the profile is admin-only and 404s for anyone who is not an instructor.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient


def _u(n): return f"00000000-0000-0000-0000-{n:012d}"


A, B, LEARNER = _u(1), _u(2), _u(3)
C1, C2, C3, C_OLD = _u(11), _u(12), _u(13), _u(14)
NOW = datetime.now(timezone.utc)


def _iso(dt): return dt.isoformat()


class _R:
    def __init__(self, data): self.data = data


class _Q:
    def __init__(self, sb, t): self.sb = sb; self.t = t; self.f = []
    def select(self, *a, **k): return self
    def eq(self, c, v): self.f.append(("eq", c, v)); return self
    def in_(self, c, vs): self.f.append(("in", c, [str(x) for x in vs])); return self
    def gte(self, c, v): self.f.append(("gte", c, v)); return self
    def limit(self, *a, **k): return self
    def _ok(self, row):
        for op, c, v in self.f:
            rv = row.get(c)
            if op == "eq" and str(rv) != str(v): return False
            if op == "in" and str(rv) not in v: return False
            if op == "gte" and (rv is None or rv < v): return False
        return True
    def execute(self):
        if self.t in self.sb.broken:
            raise RuntimeError(f"{self.t} down")
        return _R([dict(r) for r in self.sb.store.get(self.t, []) if self._ok(r)])


class _Rpc:
    def __init__(self, sb, params): self.sb = sb; self.p = params
    def execute(self):
        self.sb.calls.append(self.p)
        cohort = self.p["p_cohort_id"]
        if cohort in self.sb.broken_cohorts:
            raise RuntimeError("rpc down")
        assert self.p["p_mock"] is False and self.p["p_limit"] == 1
        key = "overdue" if self.p["p_overdue"] else self.p["p_status"]
        total = self.sb.queue.get(cohort, {}).get(key, 0)
        return _R({"essay_ids": [], "essay_rows": [], "total": total})


class _SB:
    def __init__(self):
        self.broken: set[str] = set()
        self.broken_cohorts: set[str] = set()
        self.calls: list[dict] = []
        self.store = {
            "users": [
                {"id": A, "role": "instructor", "email": "a@x", "display_name": "Cô A"},
                {"id": B, "role": "instructor", "email": "b@x", "display_name": "Thầy B"},
                {"id": LEARNER, "role": "student", "email": "l@x", "display_name": "HV"},
            ],
            "cohorts": [
                {"id": C1, "name": "IELTS 6.5 tối", "is_active": True, "instructor_id": A},
                {"id": C2, "name": "Foundation", "is_active": True, "instructor_id": A},
                {"id": C3, "name": "Writing sprint", "is_active": True, "instructor_id": B},
                {"id": C_OLD, "name": "Đã lưu trữ", "is_active": False, "instructor_id": A},
            ],
            "instructor_reviews": [],
        }
        self.queue = {
            C1: {"graded": 3, "reviewed": 1, "failed": 1, "overdue": 2},
            C2: {"graded": 0, "reviewed": 0, "failed": 0, "overdue": 0},
            C3: {"graded": 4, "reviewed": 0, "failed": 0, "overdue": 1},
        }

    def table(self, name): return _Q(self, name)
    def rpc(self, name, params):
        assert name == "fn_admin_writing_queue_page"
        return _Rpc(self, params)


def _reviews(teacher, n, hours, *, days_ago=1, status="delivered"):
    out = []
    for i in range(n):
        delivered = NOW - timedelta(days=days_ago, minutes=i)
        out.append({"claimed_by": teacher, "status": status,
                    "created_at": _iso(delivered - timedelta(hours=hours)),
                    "delivered_at": _iso(delivered) if status == "delivered" else None})
    return out


@pytest.fixture
def sb():
    fake = _SB()
    with patch("routers.admin_instructors.require_admin", new=AsyncMock(return_value={"id": "admin"})), \
         patch("routers.admin_instructors.supabase_admin", fake), \
         patch("routers.admin_instructors.instructor_owned_essay_ids", return_value=[]), \
         patch("services.staff_scope.supabase_admin", fake), \
         patch("services.admin_instructor_profiles.supabase_admin", fake), \
         patch("services.essay_service.supabase_admin", fake):
        yield fake


def _client():
    from main import app
    return TestClient(app)


def _get(path):
    return _client().get(path, headers={"Authorization": "Bearer x"})


def test_list_names_each_teachers_active_classes_and_waiting_writing(sb):
    r = _get("/admin/instructors")
    assert r.status_code == 200, r.text
    rows = {row["instructor_id"]: row for row in r.json()}
    a, b = rows[A], rows[B]
    assert [c["name"] for c in a["classes"]] == ["Foundation", "IELTS 6.5 tối"]  # archived left out
    assert [c["id"] for c in b["classes"]] == [C3]
    assert a["writing_pending"] == 5 and a["writing_overdue"] == 2
    assert b["writing_pending"] == 4 and b["writing_overdue"] == 1
    c1 = next(c for c in a["classes"] if c["id"] == C1)
    assert c1["writing_pending"] == 5 and c1["speaking_mock_pending"] is None
    # Only the queue's own statuses and non-mock essays are counted.
    assert {c["p_status"] for c in sb.calls if not c["p_overdue"]} == {"graded", "reviewed", "failed"}


def test_a_class_moved_to_another_teacher_shows_only_there(sb):
    sb.store["cohorts"][2]["instructor_id"] = A          # C3: B → A
    rows = {row["instructor_id"]: row for row in _get("/admin/instructors").json()}
    assert C3 in [c["id"] for c in rows[A]["classes"]]
    assert rows[B]["classes"] == [] and rows[B]["writing_pending"] == 0


def test_review_speed_needs_five_reviews_in_thirty_days(sb):
    sb.store["instructor_reviews"] = (
        _reviews(A, 5, hours=10)
        + _reviews(A, 3, hours=100, days_ago=40)           # outside the window
        + _reviews(A, 2, hours=1, status="claimed")
        + _reviews(B, 4, hours=2)
    )
    rows = {row["instructor_id"]: row for row in _get("/admin/instructors").json()}
    assert rows[A]["delivered_30d"] == 5 and rows[A]["avg_review_hours"] == 10.0
    assert rows[A]["in_progress"] == 2
    assert rows[B]["delivered_30d"] == 4 and rows[B]["avg_review_hours"] is None


def test_a_failing_class_count_is_none_not_zero(sb):
    sb.broken_cohorts.add(C2)
    rows = {row["instructor_id"]: row for row in _get("/admin/instructors").json()}
    c2 = next(c for c in rows[A]["classes"] if c["id"] == C2)
    assert c2["writing_pending"] is None and c2["writing_overdue"] is None
    assert rows[A]["writing_pending"] is None              # the total cannot be known
    assert rows[B]["writing_pending"] == 4                 # other teachers unaffected


@pytest.mark.parametrize("table, fields", [
    ("cohorts", ["classes", "writing_pending", "writing_overdue"]),
    ("instructor_reviews", ["delivered_30d", "in_progress", "avg_review_hours"]),
])
def test_an_unreadable_source_blanks_only_its_fields(sb, table, fields):
    sb.broken.add(table)
    r = _get("/admin/instructors")
    assert r.status_code == 200
    row = next(x for x in r.json() if x["instructor_id"] == A)
    assert all(row[f] is None for f in fields)
    assert row["students"] == 0                            # the old metrics still load


def test_profile_returns_one_teacher(sb):
    sb.store["instructor_reviews"] = _reviews(A, 6, hours=3)
    r = _get(f"/admin/instructors/{A}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["display_name"] == "Cô A"
    assert [c["id"] for c in body["classes"]] == [C2, C1]
    assert body["writing_pending"] == 5 and body["avg_review_hours"] == 3.0
    assert body["students"] == 0 and body["cost_usd"] == 0      # the W-8 Writing numbers too


@pytest.mark.parametrize("who", [LEARNER, _u(99), "not-a-uuid"])
def test_profile_404s_unless_an_instructor(sb, who):
    assert _get(f"/admin/instructors/{who}").status_code == 404


def test_profile_is_admin_only():
    with patch("routers.admin_instructors.require_admin",
               new=AsyncMock(side_effect=HTTPException(403, "admin only"))):
        assert _get(f"/admin/instructors/{A}").status_code == 403
