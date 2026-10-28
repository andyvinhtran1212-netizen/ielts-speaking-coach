"""A-08 — deleting a writing assignment must never destroy student work.

`writing_drafts.assignment_id` is ON DELETE CASCADE (mig 037) and
`writing_assignments.essay_id` is ON DELETE SET NULL (mig 036). Both
DELETE /instructor/assignments/{id} and DELETE /admin/writing/assignments/{id}
must therefore refuse (409, 'Học viên đã bắt đầu — không xoá được') unless
the row is pending with no started_at, no essay_id and no draft.

The fake below APPLIES eq / is-null filters on select and delete, so a
delete that drops its status/started_at/essay_id conditions would remove
the row in the race test and fail it — the tests prove the conditional
delete, not just the pre-read.
"""

from __future__ import annotations

import contextlib
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

STARTED = "Học viên đã bắt đầu — không xoá được"


def _u(n: int) -> str:
    return f"00000000-0000-0000-0000-{n:012d}"


A, B = _u(1), _u(2)            # instructors
ADMIN = _u(3)
STUDENT = _u(10)
PROMPT = _u(20)
ESSAY = _u(30)
DRAFT = _u(40)
ASSIGN = _u(50)


# ── filtering fake supabase ──────────────────────────────────────────────────

class _Result:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, sb, table):
        self.sb = sb
        self.table = table
        self._filters: list = []
        self._op = "select"

    def select(self, *c, **k): self._op = "select"; return self
    def delete(self): self._op = "delete"; return self
    def eq(self, c, v): self._filters.append(("eq", c, v)); return self
    def is_(self, c, v): self._filters.append(("is", c, v)); return self
    def limit(self, *a, **k): return self

    def _match(self, row):
        for op, c, v in self._filters:
            rv = row.get(c)
            if op == "eq" and str(rv) != str(v):
                return False
            if op == "is":
                assert v == "null", v
                if rv is not None:
                    return False
        return True

    def execute(self):
        self.sb.calls.append((self.table, self._op, list(self._filters)))
        hook = self.sb.before_execute.pop((self.table, self._op), None)
        if hook:
            hook(self.sb.store)
        rows = self.sb.store.setdefault(self.table, [])
        matched = [r for r in rows if self._match(r)]
        if self._op == "delete":
            self.sb.store[self.table] = [r for r in rows if not self._match(r)]
        return _Result([dict(r) for r in matched])


class _FakeSB:
    def __init__(self, store):
        self.store = store
        self.calls: list = []
        self.before_execute: dict = {}

    def table(self, name):
        return _Q(self, name)


def _assignment(**over):
    row = {"id": ASSIGN, "assigned_by": A, "student_id": STUDENT, "prompt_id": PROMPT,
           "status": "pending", "started_at": None, "essay_id": None}
    row.update(over)
    return row


def _store(assignment, *, draft=False, essay=False):
    return {
        "users": [{"id": A, "role": "instructor"}, {"id": B, "role": "instructor"}],
        "writing_assignments": [assignment],
        "writing_drafts": ([{"id": DRAFT, "assignment_id": ASSIGN, "student_id": STUDENT,
                             "draft_text": "my half-written essay"}] if draft else []),
        "writing_essays": ([{"id": ESSAY, "student_id": STUDENT, "status": "submitted",
                             "essay_text": "final essay"}] if essay else []),
    }


@contextlib.contextmanager
def _instructor(me, fake):
    with patch("routers.instructor.require_instructor", new=AsyncMock(return_value={"id": me})), \
         patch("routers.instructor.supabase_admin", fake), \
         patch("services.instructor_access.supabase_admin", fake):
        from main import app
        yield TestClient(app)


@contextlib.contextmanager
def _admin(fake):
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value={"id": ADMIN})), \
         patch("routers.admin_writing_assignments.supabase_admin", fake):
        from main import app
        yield TestClient(app)


_H = {"Authorization": "Bearer x"}


def _instructor_delete(fake, me=A):
    with _instructor(me, fake) as c:
        return c.delete(f"/instructor/assignments/{ASSIGN}", headers=_H)


def _admin_delete(fake):
    with _admin(fake) as c:
        return c.delete(f"/admin/writing/assignments/{ASSIGN}", headers=_H)


def _ids(store, table):
    return [r["id"] for r in store[table]]


# ── started work is protected ────────────────────────────────────────────────

def test_instructor_delete_in_progress_with_draft_409_and_draft_kept():
    store = _store(_assignment(status="in_progress"), draft=True)
    fake = _FakeSB(store)
    r = _instructor_delete(fake)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == STARTED
    assert _ids(store, "writing_assignments") == [ASSIGN]
    assert store["writing_drafts"][0]["draft_text"] == "my half-written essay"
    assert not [c for c in fake.calls if c[1] == "delete"]


def test_admin_delete_pending_with_draft_409():
    """The student draft PATCH upserts the draft BEFORE pending→in_progress
    (non-fatally), so a 'pending' row can already own a draft."""
    store = _store(_assignment(status="pending"), draft=True)
    fake = _FakeSB(store)
    r = _admin_delete(fake)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == STARTED
    assert _ids(store, "writing_assignments") == [ASSIGN]
    assert _ids(store, "writing_drafts") == [DRAFT]


def test_instructor_delete_pending_with_draft_409():
    store = _store(_assignment(status="pending"), draft=True)
    r = _instructor_delete(_FakeSB(store))
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == STARTED
    assert _ids(store, "writing_drafts") == [DRAFT]


def test_pending_with_started_at_409_both_endpoints():
    for call in (_instructor_delete, _admin_delete):
        store = _store(_assignment(started_at="2026-10-27T00:00:00Z"))
        r = call(_FakeSB(store))
        assert r.status_code == 409, (call.__name__, r.text)
        assert r.json()["detail"] == STARTED
        assert _ids(store, "writing_assignments") == [ASSIGN]


def test_submitted_assignment_keeps_its_essay_both_endpoints():
    for call in (_instructor_delete, _admin_delete):
        store = _store(_assignment(status="submitted", essay_id=ESSAY), essay=True)
        r = call(_FakeSB(store))
        assert r.status_code == 409, (call.__name__, r.text)
        assert r.json()["detail"] == STARTED
        assert store["writing_assignments"][0]["essay_id"] == ESSAY
        assert store["writing_essays"] == [{"id": ESSAY, "student_id": STUDENT,
                                            "status": "submitted", "essay_text": "final essay"}]


# ── clean pending deletes ────────────────────────────────────────────────────

def test_instructor_delete_clean_pending_204():
    store = _store(_assignment())
    fake = _FakeSB(store)
    r = _instructor_delete(fake)
    assert r.status_code == 204, r.text
    assert store["writing_assignments"] == []
    # The DELETE itself carries owner + unstarted conditions.
    [(_, _, filters)] = [c for c in fake.calls if c[:2] == ("writing_assignments", "delete")]
    assert ("eq", "assigned_by", A) in filters
    assert ("eq", "status", "pending") in filters
    assert ("is", "started_at", "null") in filters
    assert ("is", "essay_id", "null") in filters


def test_admin_delete_clean_pending_200():
    store = _store(_assignment())
    fake = _FakeSB(store)
    r = _admin_delete(fake)
    assert r.status_code == 200, r.text
    assert r.json() == {"message": "Assignment deleted", "assignment_id": ASSIGN}
    assert store["writing_assignments"] == []


# ── race: student starts between the pre-read and the delete ────────────────

def _start_concurrently(store):
    store["writing_assignments"][0].update(status="in_progress", started_at="2026-10-27T00:00:00Z")


def test_concurrent_start_after_checks_is_caught_by_conditional_delete():
    """The pre-read saw an unstarted row; the student started before the
    DELETE ran. Only the filters inside the DELETE can catch this."""
    for call in (_instructor_delete, _admin_delete):
        store = _store(_assignment())
        fake = _FakeSB(store)
        fake.before_execute[("writing_assignments", "delete")] = _start_concurrently
        r = call(fake)
        assert r.status_code == 409, (call.__name__, r.text)
        assert r.json()["detail"] == STARTED
        assert _ids(store, "writing_assignments") == [ASSIGN]


def test_concurrent_delete_keeps_404():
    def _vanish(store):
        store["writing_assignments"].clear()
    for call in (_instructor_delete, _admin_delete):
        store = _store(_assignment())
        fake = _FakeSB(store)
        fake.before_execute[("writing_assignments", "delete")] = _vanish
        r = call(fake)
        assert r.status_code == 404, (call.__name__, r.text)


# ── auth / 404 semantics unchanged ──────────────────────────────────────────

def test_instructor_cannot_delete_other_instructors_assignment_404():
    store = _store(_assignment())
    r = _instructor_delete(_FakeSB(store), me=B)
    assert r.status_code == 404, r.text
    assert _ids(store, "writing_assignments") == [ASSIGN]


def test_missing_assignment_404_both_endpoints():
    for call in (_instructor_delete, _admin_delete):
        store = _store(_assignment())
        store["writing_assignments"] = []
        r = call(_FakeSB(store))
        assert r.status_code == 404, (call.__name__, r.text)


# ── A-08B: the NO ACTION FK (mig 324) refuses a delete that would erase a draft ─

def _fk_violation():
    from postgrest.exceptions import APIError
    return APIError({
        "code": "23503",
        "message": 'update or delete on table "writing_assignments" violates foreign key '
                   'constraint "writing_drafts_assignment_id_fkey" on table "writing_drafts"',
        "details": f"Key (id)=({ASSIGN}) is still referenced from table \"writing_drafts\".",
        "hint": None,
    })


def _draft_commits_then_fk_refuses(store):
    """The learner's draft insert commits after the guard's draft check; the
    DELETE then fails on the FK and deletes nothing."""
    store["writing_drafts"].append({"id": DRAFT, "assignment_id": ASSIGN, "student_id": STUDENT,
                                    "draft_text": "my half-written essay"})
    raise _fk_violation()


def test_fk_violation_on_final_delete_maps_to_409_both_endpoints():
    for call in (_instructor_delete, _admin_delete):
        store = _store(_assignment())
        fake = _FakeSB(store)
        fake.before_execute[("writing_assignments", "delete")] = _draft_commits_then_fk_refuses
        r = call(fake)
        assert r.status_code == 409, (call.__name__, r.text)
        assert r.json()["detail"] == STARTED
        assert _ids(store, "writing_assignments") == [ASSIGN]
        assert store["writing_drafts"][0]["draft_text"] == "my half-written essay"


def test_fk_violation_recognized_by_sqlstate_in_every_client_shape():
    from services.writing_assignment_delete_guard import _is_foreign_key_violation

    assert _is_foreign_key_violation(_fk_violation())
    assert _is_foreign_key_violation(Exception({"code": "23503", "message": "fk"}))
    assert _is_foreign_key_violation(RuntimeError("SQLSTATE 23503 foreign key"))
    assert not _is_foreign_key_violation(Exception({"code": "23505", "message": "dup"}))
    # Prose alone is not a SQLSTATE.
    assert not _is_foreign_key_violation(RuntimeError("violates foreign key constraint"))


def test_other_delete_errors_are_not_masked_as_409():
    from postgrest.exceptions import APIError

    def _timeout(store):
        raise APIError({"code": "57014", "message": "canceling statement due to statement timeout",
                        "details": None, "hint": None})

    for call in (_instructor_delete, _admin_delete):
        store = _store(_assignment())
        fake = _FakeSB(store)
        fake.before_execute[("writing_assignments", "delete")] = _timeout
        try:
            r = call(fake)
        except APIError as exc:
            assert exc.code == "57014"
        else:
            assert r.status_code == 500, (call.__name__, r.text)
        assert _ids(store, "writing_assignments") == [ASSIGN]
