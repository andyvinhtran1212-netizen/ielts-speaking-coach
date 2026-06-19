"""Fix-3 — metrics completeness (D-C) + accessor membership equivalence (D3).

D-C  list_instructor_metrics now returns a per-instructor #prompts count
     (writing_prompts.created_by = X). Only the instructor's OWN prompts —
     admin- / other-authored prompts are not attributed to anyone.

D3   assert_essay_owned is now backed by `_essay_owned_by` (an EXISTS-style
     membership check) instead of materialising the full owned-set. This file
     pins that the EXISTS path returns the SAME verdict as
     `essay_id in set(instructor_owned_essay_ids(me))` for every ownership
     shape (the equivalence that keeps the 8.0 isolation backbone intact).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


# ── filtering fake supabase (eq / in_ / is_ aware) ────────────────────


class _Result:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, table, store):
        self.table = table
        self.store = store
        self._filters = []
        self._op = "select"
        self._payload = None
        self._limit = None

    def select(self, *c, **k): self._op = "select"; return self
    def insert(self, p): self._op = "insert"; self._payload = p; return self
    def update(self, p): self._op = "update"; self._payload = p; return self
    def delete(self): self._op = "delete"; return self
    def eq(self, c, v): self._filters.append(("eq", c, v)); return self
    def in_(self, c, vals): self._filters.append(("in", c, [str(x) for x in vals])); return self
    def is_(self, c, v): self._filters.append(("is", c, v)); return self
    def limit(self, n, *a, **k): self._limit = n; return self
    def order(self, *a, **k): return self
    def range(self, *a, **k): return self

    def _match(self, row):
        for op, c, v in self._filters:
            rv = row.get(c)
            if op == "eq" and str(rv) != str(v):
                return False
            if op == "in" and str(rv) not in v:
                return False
            if op == "is" and v == "null" and rv is not None:
                return False
        return True

    def execute(self):
        rows = self.store.setdefault(self.table, [])
        if self._op == "insert":
            items = self._payload if isinstance(self._payload, list) else [self._payload]
            created = [dict(it) for it in items]
            rows.extend(created)
            return _Result([dict(r) for r in created])
        matched = [dict(r) for r in rows if self._match(r)]
        if self._limit is not None:
            matched = matched[: self._limit]
        if self._op == "select":
            return _Result(matched)
        if self._op == "update":
            for r in rows:
                if self._match(r):
                    r.update(self._payload)
            return _Result(matched)
        if self._op == "delete":
            self.store[self.table] = [r for r in rows if not self._match(r)]
            return _Result(matched)
        return _Result([])


class _FakeSB:
    def __init__(self, store):
        self.store = store

    def table(self, name):
        return _Q(name, self.store)


def _patch(store):
    """Patch the fake into BOTH modules that read supabase_admin on these paths."""
    fake = _FakeSB(store)
    return patch.multiple(
        "services.instructor_access", supabase_admin=fake
    ), patch("routers.admin_instructors.supabase_admin", fake)


# ── ids ───────────────────────────────────────────────────────────────

A = "00000000-0000-0000-0000-00000000000a"   # instructor A
B = "00000000-0000-0000-0000-00000000000b"   # instructor B
ADM = "00000000-0000-0000-0000-0000000000ad" # an admin (authors a prompt)


# ── D-C — #prompts metric (created_by-scoped) ─────────────────────────


@pytest.mark.asyncio
async def test_prompts_metric_counts_only_own_created_by():
    store = {
        "users": [
            {"id": A, "email": "a@x.io", "display_name": "A", "role": "instructor"},
            {"id": B, "email": "b@x.io", "display_name": "B", "role": "instructor"},
        ],
        "students": [],
        "writing_prompts": [
            {"id": "p1", "created_by": A},
            {"id": "p2", "created_by": A},
            {"id": "p3", "created_by": B},
            {"id": "p4", "created_by": ADM},   # admin-authored → counted for NOBODY
        ],
        "writing_assignments": [],
        "writing_essays": [],
        "writing_feedback": [],
    }
    p_ia, p_ai = _patch(store)
    from routers import admin_instructors
    with p_ia, p_ai, patch.object(admin_instructors, "require_admin", new=AsyncMock(return_value={"id": ADM})):
        out = await admin_instructors.list_instructor_metrics(authorization="Bearer x")

    by_id = {r["instructor_id"]: r for r in out}
    assert by_id[A]["prompts"] == 2     # only A's two prompts
    assert by_id[B]["prompts"] == 1     # only B's one prompt
    # admin-authored prompt p4 is attributed to no instructor
    assert sum(r["prompts"] for r in out) == 3


# ── D3 — EXISTS membership ≡ materialise-then-check ───────────────────


def _equiv(store, me, essay_id):
    """Return (exists_verdict, set_verdict) for the same (me, essay) under the
    SAME fake — they MUST agree (that is the equivalence the refactor preserves)."""
    p_ia, p_ai = _patch(store)
    from services.instructor_access import _essay_owned_by, instructor_owned_essay_ids
    with p_ia, p_ai:
        exists_verdict = _essay_owned_by(me, essay_id)
        set_verdict = str(essay_id) in set(instructor_owned_essay_ids(me))
    return exists_verdict, set_verdict


def _store(*, assignments=None, students=None, essays=None):
    return {
        "writing_assignments": assignments or [],
        "students": students or [],
        "writing_essays": essays or [],
    }


def test_membership_assignment_branch_only():
    # E owned via an assignment A made; its student is NOT A's.
    store = _store(
        assignments=[{"id": "aa", "assigned_by": A, "essay_id": "E"}],
        students=[{"id": "sB", "instructor_id": B}],
        essays=[{"id": "E", "student_id": "sB"}],
    )
    ex, st = _equiv(store, A, "E")
    assert ex is True and st is True


def test_membership_student_branch_only():
    # E owned via A's student; no assignment row points to it.
    store = _store(
        assignments=[],
        students=[{"id": "sA", "instructor_id": A}],
        essays=[{"id": "E", "student_id": "sA"}],
    )
    ex, st = _equiv(store, A, "E")
    assert ex is True and st is True


def test_membership_both_branches():
    store = _store(
        assignments=[{"id": "aa", "assigned_by": A, "essay_id": "E"}],
        students=[{"id": "sA", "instructor_id": A}],
        essays=[{"id": "E", "student_id": "sA"}],
    )
    ex, st = _equiv(store, A, "E")
    assert ex is True and st is True


def test_membership_not_owned_other_instructor():
    # E belongs entirely to B → A must NOT own it (no cross-tenant leak).
    store = _store(
        assignments=[{"id": "ab", "assigned_by": B, "essay_id": "E"}],
        students=[{"id": "sB", "instructor_id": B}],
        essays=[{"id": "E", "student_id": "sB"}],
    )
    ex, st = _equiv(store, A, "E")
    assert ex is False and st is False


def test_membership_nonexistent_essay():
    store = _store(assignments=[], students=[{"id": "sA", "instructor_id": A}], essays=[])
    ex, st = _equiv(store, A, "E-missing")
    assert ex is False and st is False


def test_membership_null_essay_id_assignment_ignored():
    # An assignment with no linked essay must not make a same-id lookup pass.
    store = _store(
        assignments=[{"id": "aa", "assigned_by": A, "essay_id": None}],
        students=[{"id": "sB", "instructor_id": B}],
        essays=[{"id": "E", "student_id": "sB"}],
    )
    ex, st = _equiv(store, A, "E")
    assert ex is False and st is False


def test_membership_soft_deleted_essay_still_owned():
    # NEITHER branch filters soft-deleted — membership must mirror the accessor,
    # which also includes deleted essays. (Route-level code applies its own
    # deleted_at filter separately.)
    store = _store(
        assignments=[],
        students=[{"id": "sA", "instructor_id": A}],
        essays=[{"id": "E", "student_id": "sA", "deleted_at": "2026-01-01T00:00:00Z"}],
    )
    ex, st = _equiv(store, A, "E")
    assert ex is True and st is True
