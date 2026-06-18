"""W-4 — /instructor/* cross-tenant isolation MATRIX + meta-gate + grep-test.

The merge-gate against OWASP #1 (cross-tenant leak). Two instructors A and B each
own a full resource set; authed-as-B must NOT read or write ANY of A's objects.

  • MATRIX: every /instructor/* route, B-on-A → 403 / 404 / empty (read + write).
  • META-GATE: every /instructor/* route in the live app MUST appear in the
    ROUTES registry (⇒ has isolation coverage) — a new untested route fails CI.
  • GREP-TEST: routers/instructor.py never touches a registry owner-table via
    supabase_admin directly (must go through the accessor).
  • Plus: claim-time essay-owner check, essay-ownership-scoped queue, write-leaves-
    A-unchanged, PermissionError→403 (generic), require_instructor gate.

A *filtering* fake Supabase is used so .eq/.in_/.is_ actually scope rows — an
accessor that forgot its owner filter would FAIL these tests.
"""

from __future__ import annotations

import contextlib
import re
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


# ── valid-UUID fixtures (routes type ids as UUID — keep that strong typing) ───

def _u(n: int) -> str:
    return f"00000000-0000-0000-0000-{n:012d}"

A, B = _u(1), _u(2)
PA, PB = _u(11), _u(12)        # prompts
AA, AB = _u(21), _u(22)        # assignments
CA, CB = _u(31), _u(32)        # cohorts
SA, SB = _u(41), _u(42)        # students
EA, EB = _u(51), _u(52)        # essays
RA, RB = _u(61), _u(62)        # reviews


# ── filtering fake supabase ──────────────────────────────────────────────────

class _Result:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, table, store):
        self.table = table
        self.store = store
        self._filters: list = []
        self._op = "select"
        self._payload = None

    def select(self, *c, **k): self._op = "select"; return self
    def insert(self, p): self._op = "insert"; self._payload = p; return self
    def update(self, p): self._op = "update"; self._payload = p; return self
    def delete(self): self._op = "delete"; return self
    def eq(self, c, v): self._filters.append(("eq", c, v)); return self
    def neq(self, c, v): self._filters.append(("neq", c, v)); return self
    def in_(self, c, vals): self._filters.append(("in", c, [str(x) for x in vals])); return self
    def is_(self, c, v): self._filters.append(("is", c, v)); return self
    def limit(self, *a, **k): return self
    def order(self, *a, **k): return self
    def range(self, *a, **k): return self

    def _match(self, row):
        for op, c, v in self._filters:
            rv = row.get(c)
            if op == "eq" and str(rv) != str(v): return False
            if op == "neq" and str(rv) == str(v): return False
            if op == "in" and str(rv) not in v: return False
            if op == "is" and v == "null" and rv is not None: return False
        return True

    def execute(self):
        rows = self.store.setdefault(self.table, [])
        if self._op == "insert":
            items = self._payload if isinstance(self._payload, list) else [self._payload]
            created = []
            for it in items:
                r = dict(it)
                r.setdefault("id", _u(900 + len(rows) + len(created)))
                created.append(r)
            rows.extend(created)
            return _Result([dict(r) for r in created])
        matched = [r for r in rows if self._match(r)]
        if self._op == "select":
            return _Result([dict(r) for r in matched])
        if self._op == "update":
            for r in matched:
                r.update(self._payload)
            return _Result([dict(r) for r in matched])
        if self._op == "delete":
            self.store[self.table] = [r for r in rows if not self._match(r)]
            return _Result([dict(r) for r in matched])
        return _Result([])


class _FakeSB:
    def __init__(self, store):
        self.store = store

    def table(self, name):
        return _Q(name, self.store)


def _seed():
    return {
        "users": [{"id": A, "role": "instructor"}, {"id": B, "role": "instructor"}],
        "writing_prompts": [
            {"id": PA, "created_by": A, "title": "A", "task_type": "task2", "prompt_text": "x"},
            {"id": PB, "created_by": B, "title": "B", "task_type": "task2", "prompt_text": "y"},
        ],
        "writing_assignments": [
            {"id": AA, "assigned_by": A, "essay_id": EA, "student_id": SA, "prompt_id": PA},
            {"id": AB, "assigned_by": B, "essay_id": EB, "student_id": SB, "prompt_id": PB},
        ],
        "cohorts": [
            {"id": CA, "created_by": A, "name": "Lop A"},
            {"id": CB, "created_by": B, "name": "Lop B"},
        ],
        "students": [
            {"id": SA, "instructor_id": A, "cohort_id": CA, "full_name": "SA", "student_code": "SA", "user_id": None},
            {"id": SB, "instructor_id": B, "cohort_id": CB, "full_name": "SB", "student_code": "SB", "user_id": None},
        ],
        "writing_essays": [
            {"id": EA, "student_id": SA, "status": "graded", "deleted_at": None,
             "analysis_level": 3, "task_type": "task2", "created_at": "2026-01-01T00:00:00Z"},
            {"id": EB, "student_id": SB, "status": "graded", "deleted_at": None,
             "analysis_level": 3, "task_type": "task2", "created_at": "2026-01-01T00:00:00Z"},
        ],
        "writing_feedback": [],
        "instructor_reviews": [
            {"id": RA, "essay_id": EA, "status": "queued", "claimed_by": None,
             "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"},
            {"id": RB, "essay_id": EB, "status": "queued", "claimed_by": None,
             "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"},
        ],
    }


# ── route registry (drives matrix + meta-gate) ───────────────────────────────
# (method, path, kind, a_id, body, a_marker)
ROUTES = [
    ("GET",    "/instructor/prompts",                  "list",   None, None, PA),
    ("POST",   "/instructor/prompts",                  "create", None, {"title": "t", "task_type": "task2", "prompt_text": "p"}, None),
    ("GET",    "/instructor/prompts/{id}",             "read1",  PA, None, None),
    ("PATCH",  "/instructor/prompts/{id}",             "write1", PA, {"title": "hacked"}, None),
    ("DELETE", "/instructor/prompts/{id}",             "write1", PA, None, None),
    ("GET",    "/instructor/assignments",              "list",   None, None, AA),
    ("GET",    "/instructor/assignments/{id}",         "read1",  AA, None, None),
    ("PATCH",  "/instructor/assignments/{id}",         "write1", AA, {"instructions": "hacked"}, None),
    ("DELETE", "/instructor/assignments/{id}",         "write1", AA, None, None),
    ("POST",   "/instructor/assignments/fan-out",      "action", None, {"prompt_ids": [PA], "cohort_id": CA}, None),
    ("GET",    "/instructor/essays",                   "list",   None, None, EA),
    ("GET",    "/instructor/essays/{id}",              "read1",  EA, None, None),
    ("PATCH",  "/instructor/essays/{id}/feedback",     "write1", EA, {"overall_band": 6}, None),
    ("GET",    "/instructor/cohorts",                  "list",   None, None, CA),
    ("POST",   "/instructor/cohorts",                  "create", None, {"name": "newlop"}, None),
    ("GET",    "/instructor/cohorts/{id}",             "read1",  CA, None, None),
    ("GET",    "/instructor/students",                 "list",   None, None, SA),
    ("GET",    "/instructor/students/{id}",            "read1",  SA, None, None),
    ("GET",    "/instructor/reviews/queue",            "list",   None, None, RA),
    ("POST",   "/instructor/reviews/{id}/claim",       "action", RA, None, None),
    ("POST",   "/instructor/reviews/{id}/release",     "action", RA, None, None),
    ("POST",   "/instructor/reviews/{id}/deliver",     "action", RA, None, None),
]


def _norm(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "{}", path)


@contextlib.contextmanager
def _as(me, store):
    fake = _FakeSB(store)
    targets = [
        "routers.instructor.supabase_admin",
        "services.instructor_access.supabase_admin",
        "services.essay_service.supabase_admin",
        "services.instructor_workflow.supabase_admin",
    ]
    with contextlib.ExitStack() as es:
        es.enter_context(patch("routers.instructor.require_instructor",
                               new=AsyncMock(return_value={"id": me})))
        for t in targets:
            es.enter_context(patch(t, fake))
        from main import app
        yield TestClient(app), store


def _call(client, method, path, a_id, body):
    if a_id and "{id}" in path:
        path = path.replace("{id}", a_id)
    return client.request(method, path, json=body, headers={"Authorization": "Bearer x"})


# ── META-GATE ────────────────────────────────────────────────────────────────

def test_meta_gate_every_instructor_route_has_isolation_coverage():
    from main import app
    registry = {(m, _norm(p)) for (m, p, *_rest) in ROUTES}
    live = set()
    for r in app.routes:
        path = getattr(r, "path", "")
        if not path.startswith("/instructor"):
            continue
        for m in (getattr(r, "methods", None) or set()):
            if m in ("HEAD", "OPTIONS"):
                continue
            live.add((m, _norm(path)))
    missing = live - registry
    assert not missing, f"/instructor routes WITHOUT isolation coverage (add to ROUTES + matrix): {missing}"
    stale = registry - live
    assert not stale, f"ROUTES entries with no live route (stale): {stale}"


# ── GREP-TEST ────────────────────────────────────────────────────────────────

def test_grep_no_direct_supabase_admin_on_owner_tables():
    from services.instructor_access import _OWNER_COLUMNS
    src = (Path(__file__).parent.parent / "routers" / "instructor.py").read_text(encoding="utf-8")
    for table in _OWNER_COLUMNS:
        bad = re.search(rf"supabase_admin\s*\.\s*table\(\s*['\"]{re.escape(table)}['\"]", src)
        assert not bad, f"routers/instructor.py touches owner-table {table!r} via supabase_admin — use the accessor"


# ── MATRIX: B-on-A → 403 / 404 / empty (read + write) ───────────────────────

@pytest.mark.parametrize("method,path,kind,a_id,body,a_marker", ROUTES,
                         ids=[f"{m}:{p}" for (m, p, *_r) in ROUTES])
def test_matrix_B_cannot_touch_A(method, path, kind, a_id, body, a_marker):
    store = _seed()
    with _as(B, store) as (client, st):
        resp = _call(client, method, path, a_id, body)

    if kind == "create":
        assert resp.status_code in (200, 201), resp.text   # self-owned creation
        return

    if kind == "list":
        assert resp.status_code == 200, resp.text
        ids = {row.get("id") for row in resp.json()}
        assert a_marker not in ids, f"LEAK: B's {path} returned A's object {a_marker}"
        return

    # read1 / write1 / action on an A-owned object → blocked.
    assert resp.status_code in (403, 404), f"{method} {path} on A-object returned {resp.status_code}: {resp.text}"

    if kind in ("write1", "action") and a_id in (PA, AA, CA):
        table = {PA: "writing_prompts", AA: "writing_assignments", CA: "cohorts"}[a_id]
        still = [r for r in store[table] if r["id"] == a_id]
        assert still, f"LEAK: B's {method} {path} deleted A's row"
        assert "hacked" not in str(still[0]), f"LEAK: B mutated A's row"


def test_matrix_B_sees_own_objects():
    """Sanity: scoping isn't 'block everything' — B sees B's own list rows."""
    store = _seed()
    with _as(B, store) as (client, _st):
        for path, marker in [("/instructor/prompts", PB), ("/instructor/cohorts", CB),
                             ("/instructor/students", SB), ("/instructor/assignments", AB)]:
            r = client.get(path, headers={"Authorization": "Bearer x"})
            assert r.status_code == 200, r.text
            assert marker in {row.get("id") for row in r.json()}, f"{path} missing B's own"


# ── focused: queue scoping + claim-time essay-owner + 403 shape ──────────────

def test_reviews_queue_scoped_to_owned_essays():
    store = _seed()
    with _as(B, store) as (client, _st):
        r = client.get("/instructor/reviews/queue", headers={"Authorization": "Bearer x"})
    assert r.status_code == 200, r.text
    ids = {(item.get("review_id") or item.get("id")) for item in r.json()}
    assert RA not in ids, "LEAK: B's queue shows A's review (essay eA)"


def test_claim_non_owned_review_is_403_and_not_claimed():
    store = _seed()
    with _as(B, store) as (client, st):
        r = client.post(f"/instructor/reviews/{RA}/claim", headers={"Authorization": "Bearer x"})
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == "Bạn không có quyền với tài nguyên này."   # generic, no object name
    assert st["instructor_reviews"][0]["claimed_by"] is None                 # A's review untouched


def test_claim_owned_review_succeeds():
    store = _seed()
    with _as(B, store) as (client, st):
        r = client.post(f"/instructor/reviews/{RB}/claim", headers={"Authorization": "Bearer x"})
    assert r.status_code == 200, r.text
    assert st["instructor_reviews"][1]["claimed_by"] == B


def test_fan_out_cross_owner_prompt_is_403():
    store = _seed()
    with _as(B, store) as (client, _st):
        r = client.post("/instructor/assignments/fan-out",
                        json={"prompt_ids": [PA], "cohort_id": CA},
                        headers={"Authorization": "Bearer x"})
    assert r.status_code == 403, r.text


# ── require_instructor gate (defense — W-2 covers depth) ─────────────────────

def test_non_instructor_blocked():
    import asyncio
    from fastapi import HTTPException
    from routers.admin import require_instructor

    fake = _FakeSB({"users": [{"id": "u", "role": "student"}]})
    with patch("routers.admin.get_supabase_user", new=AsyncMock(return_value={"id": "u"})), \
         patch("routers.admin.supabase_admin", fake):
        with pytest.raises(HTTPException) as ei:
            asyncio.new_event_loop().run_until_complete(require_instructor("Bearer x"))
    assert ei.value.status_code == 403
