"""W-5 — enroll-chain: activation stamps students.instructor_id atomically.

Through POST /auth/activate (filtering fake Supabase). Value-gates:
  • issuer=instructor → students.instructor_id = issued_by; issuer=admin → NULL.
  • no student row → created (user_id + instructor_id + created_by + student_code).
  • 2nd-code cross-instructor (student owned by A, code from B) → 403 AND the code
    is NOT consumed (is_used stays false) AND owner stays A (no steal) + audit.
  • same-owner re-activation → idempotent proceed (no 403, code consumed).
  • fail-mid (students write raises) → 500 AND code NOT consumed (retry-able):
    proves stamp-runs-BEFORE-consume (seam-#4).
  • cohort folded into the same atomic write.
  • W-2 grants_role='instructor' promote path untouched.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


def _u(n): return f"00000000-0000-0000-0000-{n:012d}"

GV_A, GV_B, ADMIN = _u(1), _u(2), _u(9)
USER = _u(100)            # the activator (student)


# ── filtering fake supabase (eq / is_ / insert / update / upsert + raise inject) ─

class _R:
    def __init__(self, data): self.data = data


class _Q:
    def __init__(self, table, sb):
        self.table = table; self.sb = sb
        self._f = []; self._op = "select"; self._payload = None; self._conflict = None

    def select(self, *a, **k): self._op = "select"; return self
    def insert(self, p): self._op = "insert"; self._payload = p; return self
    def update(self, p): self._op = "update"; self._payload = p; return self
    def upsert(self, p, **k): self._op = "upsert"; self._payload = p; self._conflict = k.get("on_conflict"); return self
    def delete(self): self._op = "delete"; return self
    def eq(self, c, v): self._f.append(("eq", c, v)); return self
    def is_(self, c, v): self._f.append(("is", c, v)); return self
    def in_(self, c, vs): self._f.append(("in", c, [str(x) for x in vs])); return self
    def limit(self, *a, **k): return self
    def order(self, *a, **k): return self

    def _match(self, row):
        for op, c, v in self._f:
            rv = row.get(c)
            if op == "eq" and str(rv) != str(v): return False
            if op == "is" and v == "null" and rv is not None: return False
            if op == "in" and str(rv) not in v: return False
        return True

    def execute(self):
        if self._op in ("insert", "update", "upsert", "delete") and self.table in self.sb.write_raises:
            raise RuntimeError(f"injected write failure on {self.table}")
        rows = self.sb.store.setdefault(self.table, [])
        if self._op == "insert":
            items = self._payload if isinstance(self._payload, list) else [self._payload]
            created = [dict(it, **({"id": it["id"]} if it.get("id") else {"id": _u(500 + len(rows))})) for it in items]
            rows.extend(created); return _R([dict(r) for r in created])
        if self._op == "upsert":
            rows.append(dict(self._payload)); return _R([dict(self._payload)])
        m = [r for r in rows if self._match(r)]
        if self._op == "select": return _R([dict(r) for r in m])
        if self._op == "update":
            for r in m: r.update(self._payload)
            return _R([dict(r) for r in m])
        if self._op == "delete":
            self.sb.store[self.table] = [r for r in rows if not self._match(r)]
            return _R([dict(r) for r in m])
        return _R([])


class _FakeSB:
    def __init__(self, store, write_raises=()):
        self.store = store; self.write_raises = set(write_raises)
    def table(self, name): return _Q(name, self)


def _seed(*, issued_by, grants_role=None, intended_email=None, cohort_id=None, students=None):
    return {
        "access_codes": [{
            "id": _u(300), "code": "ENROLL1", "is_used": False, "is_revoked": False,
            "expires_at": None, "permissions": ["writing"], "grants_role": grants_role,
            "intended_email": intended_email, "issued_by": issued_by, "cohort_id": cohort_id,
        }],
        "users": [
            {"id": GV_A, "role": "instructor"}, {"id": GV_B, "role": "instructor"},
            {"id": ADMIN, "role": "admin"}, {"id": USER, "role": "user"},
        ],
        "students": students or [],
        "access_code_audit": [],
        "user_code_assignments": [],
    }


def _activate(store, *, email="student@x.com", code="ENROLL1", write_raises=()):
    fake = _FakeSB(store, write_raises=write_raises)
    auth_user = {"id": USER, "email": email, "user_metadata": {"full_name": "Học Viên"}}
    with patch("routers.auth.get_supabase_user", new=AsyncMock(return_value=auth_user)), \
         patch("routers.auth.supabase_admin", fake):
        from main import app
        return TestClient(app).post("/auth/activate", json={"access_code": code},
                                    headers={"Authorization": "Bearer x"})


def _students(store): return store["students"]
def _code(store): return store["access_codes"][0]


# ── owner stamp ──────────────────────────────────────────────────────────────

def test_instructor_issuer_stamps_owner_on_new_student():
    store = _seed(issued_by=GV_A)
    r = _activate(store)
    assert r.status_code == 200, r.text
    rows = _students(store)
    assert len(rows) == 1
    assert rows[0]["instructor_id"] == GV_A
    assert rows[0]["user_id"] == USER
    assert rows[0]["student_code"] == "ENROLL1"
    assert rows[0]["created_by"] == GV_A
    assert _code(store)["is_used"] is True       # consumed on success


def test_admin_issuer_leaves_owner_null_on_existing_student():
    # admin issuer never stamps owner — on an existing unowned student, stays NULL.
    store = _seed(issued_by=ADMIN, students=[
        {"id": _u(400), "user_id": USER, "instructor_id": None, "student_code": "OLD"},
    ])
    r = _activate(store)
    assert r.status_code == 200, r.text
    assert _students(store)[0]["instructor_id"] is None   # mass code → no owner


def test_mass_code_no_cohort_creates_no_student():
    """Anti-pollution: a plain mass/speaking code (admin, no cohort, no existing
    student) creates NO students row — speaking-only users don't enter the roster."""
    store = _seed(issued_by=ADMIN)
    r = _activate(store)
    assert r.status_code == 200, r.text
    assert _students(store) == []                          # nothing created
    assert _code(store)["is_used"] is True                 # activation still completes


def test_existing_unowned_student_gets_stamped():
    store = _seed(issued_by=GV_A, students=[
        {"id": _u(400), "user_id": USER, "instructor_id": None, "student_code": "OLD"},
    ])
    r = _activate(store)
    assert r.status_code == 200, r.text
    assert _students(store)[0]["instructor_id"] == GV_A      # stamped (was NULL)
    assert len(_students(store)) == 1                         # updated, not duplicated


# ── 2nd-code cross-instructor block ──────────────────────────────────────────

def test_second_code_from_other_instructor_rejected_and_not_consumed():
    store = _seed(issued_by=GV_B, students=[
        {"id": _u(400), "user_id": USER, "instructor_id": GV_A, "student_code": "OLD"},
    ])
    r = _activate(store)
    assert r.status_code == 403, r.text
    assert _students(store)[0]["instructor_id"] == GV_A       # NOT stolen
    assert _code(store)["is_used"] is False                   # code NOT burned → retry-able
    audit = [a for a in store["access_code_audit"] if a["action"] == "enroll_reassign_rejected"]
    assert len(audit) == 1


def test_same_owner_reactivation_is_idempotent():
    store = _seed(issued_by=GV_A, students=[
        {"id": _u(400), "user_id": USER, "instructor_id": GV_A, "student_code": "OLD"},
    ])
    r = _activate(store)
    assert r.status_code == 200, r.text
    assert _students(store)[0]["instructor_id"] == GV_A       # unchanged
    assert _code(store)["is_used"] is True


def test_admin_code_on_owned_student_proceeds_without_touching_owner():
    """Mass code (owner NULL) on a GV-A student → proceed, owner stays A (no conflict)."""
    store = _seed(issued_by=ADMIN, students=[
        {"id": _u(400), "user_id": USER, "instructor_id": GV_A, "student_code": "OLD"},
    ])
    r = _activate(store)
    assert r.status_code == 200, r.text
    assert _students(store)[0]["instructor_id"] == GV_A
    assert _code(store)["is_used"] is True


# ── atomicity: stamp BEFORE consume ──────────────────────────────────────────

def test_failmid_student_write_does_not_consume_code():
    store = _seed(issued_by=GV_A)
    r = _activate(store, write_raises=("students",))         # students insert raises
    assert r.status_code == 500, r.text
    assert _code(store)["is_used"] is False                   # NOT consumed → retry-able
    assert _students(store) == []                             # no half-written student


# ── cohort fold ──────────────────────────────────────────────────────────────

def test_cohort_code_alone_creates_student_owner_null():
    """Cohort/class code from admin (no instructor owner) still creates+enrolls the
    student (cohort is an enroll signal), with owner NULL + cohort set — one write."""
    store = _seed(issued_by=ADMIN, cohort_id=_u(700))
    r = _activate(store)
    assert r.status_code == 200, r.text
    assert _students(store)[0]["cohort_id"] == _u(700)
    assert _students(store)[0]["instructor_id"] is None       # admin → no owner


def test_instructor_cohort_code_folds_owner_and_cohort():
    store = _seed(issued_by=GV_A, cohort_id=_u(700))
    r = _activate(store)
    assert r.status_code == 200, r.text
    row = _students(store)[0]
    assert row["instructor_id"] == GV_A and row["cohort_id"] == _u(700)   # same atomic write


# ── W-2 promote path untouched ───────────────────────────────────────────────

def test_w2_instructor_grant_promote_still_works():
    """grants_role='instructor' + matching email → user promoted (W-2), enroll runs
    too but issuer=admin → owner NULL (disjoint paths, no regression)."""
    store = _seed(issued_by=ADMIN, grants_role="instructor", intended_email="gv@x.com")
    r = _activate(store, email="GV@x.com")                    # case-insensitive match
    assert r.status_code == 200, r.text
    user = [u for u in store["users"] if u["id"] == USER][0]
    assert user["role"] == "instructor"                       # W-2 promote happened
    assert _code(store)["is_used"] is True
