"""Phase 2.1 — pin the student-linking step inside POST /activate.

The endpoint already touches 5 tables (access_codes, users, users
again for activation, access_codes again for is_used, then
user_code_assignments). Phase 2.1 adds a 6th table interaction:
look up students by student_code, and if a row matches AND has no
existing user_id, set it.

These tests focus narrowly on the linking branch — the upstream
steps are stubbed to "everything succeeded" because they're already
exercised by integration smokes elsewhere. Four shapes:

  1. Code matches a students row with NULL user_id ⇒ student is
     linked (UPDATE called with the right user_id).
  2. Code matches a students row that's ALREADY linked to the same
     or another user ⇒ NO update (don't overwrite).
  3. Code matches no students row ⇒ /activate still 200, no UPDATE
     against students.
  4. The students lookup itself raises ⇒ /activate still 200,
     warning logged (defensive: never block login on history bugs).
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from routers import auth as auth_module


_USER_ID = "user-uuid-test-2026"
_STUDENT_ID = "student-uuid-test-2026"
_ACCESS_CODE = "STUDENT123"


def _run(coro):
    """Fresh loop per call — async handler called outside FastAPI."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Smart dispatching mock for supabase_admin ────────────────────────


class _Builder:
    """Per-call builder. The DispatchClient sets `_data` (for selects)
    or `_action` (for writes) before returning self from select/insert/
    update/upsert. eq()/limit() are pass-throughs we record so the
    test can assert which student_code or user_id was queried."""

    def __init__(self, parent: "_DispatchClient", table: str):
        self._parent = parent
        self._table = table
        self._action: str | None = None
        self._select_cols: str | None = None
        self._payload: Any = None
        self._filters: list[tuple] = []

    def select(self, cols, *_a, **_kw):
        self._action = "select"
        self._select_cols = cols
        return self

    def insert(self, payload, *_a, **_kw):
        self._action = "insert"
        self._payload = payload
        return self

    def update(self, payload, *_a, **_kw):
        self._action = "update"
        self._payload = payload
        return self

    def upsert(self, payload, *_a, **_kw):
        self._action = "upsert"
        self._payload = payload
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def limit(self, *_a, **_kw):
        return self

    def execute(self):
        record = {
            "table":   self._table,
            "action":  self._action,
            "select":  self._select_cols,
            "payload": self._payload,
            "filters": list(self._filters),
        }
        self._parent.calls.append(record)
        return self._parent._respond(record)


class _DispatchClient:
    """Routes per-table behaviour. Each test passes a `students_lookup`
    fixture (the rows the students-by-student_code query should return)
    and optional `students_update_raises` to simulate DB failures."""

    def __init__(
        self,
        *,
        students_lookup: list[dict] | None = None,
        students_update_raises: Exception | None = None,
        students_lookup_raises: Exception | None = None,
        code_cohort_id: str | None = None,
    ):
        # access_codes select returns one valid, unused, unrevoked code.
        self._access_code_row = {
            "id":          "code-uuid",
            "code":        _ACCESS_CODE,
            "is_used":     False,
            "is_revoked":  False,
            "permissions": ["practice_single", "practice_part", "practice_full"],
        }
        # WF-1: a cohort-linked direct code carries access_codes.cohort_id.
        if code_cohort_id is not None:
            self._access_code_row["cohort_id"] = code_cohort_id
        # users select returns existing user (Step 2 takes the
        # already-exists path).
        self._existing_user = [{"id": _USER_ID}]
        self._students_lookup = students_lookup or []
        self._students_update_raises = students_update_raises
        self._students_lookup_raises = students_lookup_raises
        self.calls: list[dict] = []

    def table(self, name):
        return _Builder(self, name)

    def _respond(self, rec):
        class _R:
            pass
        r = _R()
        # Default: empty data.
        r.data = []

        table, action = rec["table"], rec["action"]

        if table == "access_codes" and action == "select":
            r.data = [self._access_code_row]
        elif table == "users" and action == "select":
            r.data = self._existing_user
        elif table == "students" and action == "select":
            if self._students_lookup_raises:
                raise self._students_lookup_raises
            r.data = self._students_lookup
        elif table == "students" and action == "update":
            if self._students_update_raises:
                raise self._students_update_raises
            r.data = []
        # All other writes (users update, access_codes update,
        # user_code_assignments upsert) succeed silently.
        return r


def _patch(monkeypatch, **client_kwargs):
    client = _DispatchClient(**client_kwargs)

    async def _fake_user(_authz):
        return {
            "id":             _USER_ID,
            "email":          "test@example.com",
            "user_metadata":  {"full_name": "Test Student"},
        }

    monkeypatch.setattr(auth_module, "get_supabase_user", _fake_user)
    monkeypatch.setattr(auth_module, "supabase_admin", client)
    return client


def _payload():
    return auth_module.ActivateRequest(access_code=_ACCESS_CODE)


# ── Tests ────────────────────────────────────────────────────────────


def test_links_student_when_code_matches_and_unlinked(monkeypatch):
    """students.student_code == access_code, user_id NULL ⇒ link."""
    client = _patch(
        monkeypatch,
        students_lookup=[{"id": _STUDENT_ID, "user_id": None}],
    )

    out = _run(auth_module.activate_account(_payload(), authorization="Bearer x"))
    assert out == {"success": True, "message": "Tài khoản đã được kích hoạt!"}

    student_updates = [
        c for c in client.calls
        if c["table"] == "students" and c["action"] == "update"
    ]
    assert len(student_updates) == 1
    assert student_updates[0]["payload"] == {"user_id": _USER_ID}
    # Filter targeted the matched student row by id.
    assert ("id", _STUDENT_ID) in student_updates[0]["filters"]


def test_cohort_linked_code_enrolls_student_into_cohort(monkeypatch):
    """WF-1 bridge — when the activated code is cohort-linked
    (access_codes.cohort_id set), the same UPDATE that links user_id also
    sets students.cohort_id, enrolling the student into the class roster."""
    client = _patch(
        monkeypatch,
        students_lookup=[{"id": _STUDENT_ID, "user_id": None}],
        code_cohort_id="cohort-xyz",
    )

    out = _run(auth_module.activate_account(_payload(), authorization="Bearer x"))
    assert out["success"] is True

    student_updates = [
        c for c in client.calls
        if c["table"] == "students" and c["action"] == "update"
    ]
    assert len(student_updates) == 1
    assert student_updates[0]["payload"] == {"user_id": _USER_ID, "cohort_id": "cohort-xyz"}
    assert ("id", _STUDENT_ID) in student_updates[0]["filters"]


def test_mass_code_no_cohort_does_not_set_cohort_id(monkeypatch):
    """Mass code (no access_codes.cohort_id) ⇒ link user_id only, never
    touch students.cohort_id."""
    client = _patch(
        monkeypatch,
        students_lookup=[{"id": _STUDENT_ID, "user_id": None}],
        # code_cohort_id omitted → no cohort on the code
    )
    _run(auth_module.activate_account(_payload(), authorization="Bearer x"))
    su = [c for c in client.calls if c["table"] == "students" and c["action"] == "update"]
    assert len(su) == 1 and su[0]["payload"] == {"user_id": _USER_ID}   # no cohort_id key


def test_does_not_overwrite_existing_link(monkeypatch):
    """Already-linked student row ⇒ no UPDATE issued. Even when the
    existing link is to a DIFFERENT user (collision case)."""
    other_user = "different-user-uuid"
    client = _patch(
        monkeypatch,
        students_lookup=[{"id": _STUDENT_ID, "user_id": other_user}],
    )

    out = _run(auth_module.activate_account(_payload(), authorization="Bearer x"))
    assert out["success"] is True

    student_updates = [
        c for c in client.calls
        if c["table"] == "students" and c["action"] == "update"
    ]
    assert student_updates == [], (
        "Student already linked — must NOT overwrite. "
        f"Got updates: {student_updates}"
    )


def test_no_match_still_completes_activation(monkeypatch):
    """Access code valid but no students row — /activate still 200,
    no student UPDATE attempted."""
    client = _patch(monkeypatch, students_lookup=[])

    out = _run(auth_module.activate_account(_payload(), authorization="Bearer x"))
    assert out["success"] is True

    student_updates = [
        c for c in client.calls
        if c["table"] == "students" and c["action"] == "update"
    ]
    assert student_updates == []


def test_linking_db_failure_does_not_block_activation(monkeypatch):
    """students lookup raises ⇒ activation still succeeds (defensive).

    Critical: a DB blip in the linking branch must NOT prevent a user
    from completing /activate — they're already past Step 3 (activated
    + permissions copied) by the time this branch runs."""
    _patch(
        monkeypatch,
        students_lookup_raises=RuntimeError("simulated students-table outage"),
    )

    out = _run(auth_module.activate_account(_payload(), authorization="Bearer x"))
    assert out == {"success": True, "message": "Tài khoản đã được kích hoạt!"}


def test_linking_update_failure_does_not_block_activation(monkeypatch):
    """students lookup succeeds but the UPDATE itself raises. Same
    defensive contract — the user keeps their activation."""
    _patch(
        monkeypatch,
        students_lookup=[{"id": _STUDENT_ID, "user_id": None}],
        students_update_raises=RuntimeError("simulated update outage"),
    )

    out = _run(auth_module.activate_account(_payload(), authorization="Bearer x"))
    assert out["success"] is True
