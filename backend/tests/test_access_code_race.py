"""B1 / review Mục 2 — POST /activate must not double-redeem an access code.

The old flow read access_codes.is_used (Step 1) and later wrote is_used=true
(Step 4) as a non-atomic TOCTOU pair: two concurrent activations of the SAME
code both saw is_used=false and both activated a (different) user → one code
redeemed twice.

The fix makes Step 4 an atomic compare-and-swap — UPDATE ... WHERE is_used=false
— so only the first writer claims the row. These tests pin the LOSER's path
(the request whose conditional UPDATE matched 0 rows): it must reject AND roll
back the activation it just performed, rather than leave the user active on a
code they don't own.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from routers import auth as auth_module


_USER_ID = "loser-user-uuid"
_OTHER_USER = "winner-user-uuid"
_ACCESS_CODE = "RACE123"


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _payload():
    return auth_module.ActivateRequest(access_code=_ACCESS_CODE)


# ── Stateful mock that can model the race window ──────────────────────


class _Builder:
    def __init__(self, parent, table):
        self._p = parent
        self._table = table
        self._action = None
        self._payload = None
        self._filters: list[tuple] = []

    def select(self, cols, *_a, **_k):
        self._action = "select"; return self

    def insert(self, payload, *_a, **_k):
        self._action = "insert"; self._payload = payload; return self

    def update(self, payload, *_a, **_k):
        self._action = "update"; self._payload = payload; return self

    def upsert(self, payload, *_a, **_k):
        self._action = "upsert"; self._payload = payload; return self

    def delete(self, *_a, **_k):
        self._action = "delete"; return self

    def eq(self, col, val):
        self._filters.append((col, val)); return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        rec = {"table": self._table, "action": self._action,
               "payload": self._payload, "filters": list(self._filters)}
        self._p.calls.append(rec)
        return self._p._respond(rec)


class _RaceClient:
    """`update_claims` controls whether the conditional access_codes UPDATE
    returns a row (won) or [] (lost). On a loss, the access_codes RE-READ
    reports the row owned by `reread_used_by`."""

    def __init__(self, *, update_claims, reread_used_by=None,
                 user_is_active=False, first_is_used=False, first_used_by=None,
                 reread_raises=False, cohort_id=None, students_insert_id=None):
        self.calls: list[dict] = []
        self._update_claims = update_claims
        self._reread_used_by = reread_used_by
        self._user_is_active = user_is_active
        self._first_is_used = first_is_used
        self._first_used_by = first_used_by
        self._reread_raises = reread_raises
        self._cohort_id = cohort_id              # set → code is an enroll-signal (cohort) code
        self._students_insert_id = students_insert_id
        self._ac_selects = 0

    def table(self, name):
        return _Builder(self, name)

    def _code_row(self, *, is_used, used_by):
        return {
            "id": "code-uuid", "code": _ACCESS_CODE,
            "is_used": is_used, "used_by": used_by, "is_revoked": False,
            "expires_at": None, "grants_role": None, "intended_email": None,
            "issued_by": None, "cohort_id": self._cohort_id,
            "permissions": ["practice_single", "practice_part", "practice_full"],
        }

    def _respond(self, rec):
        class _R:
            data: Any = []
        r = _R(); r.data = []
        t, a = rec["table"], rec["action"]

        if t == "access_codes" and a == "select":
            self._ac_selects += 1
            if self._ac_selects == 1:
                # Step 1 read — the (possibly stale) pre-claim view.
                r.data = [self._code_row(is_used=self._first_is_used,
                                         used_by=self._first_used_by)]
            else:
                # Step 4 re-read after a 0-row conditional UPDATE.
                if self._reread_raises:
                    raise RuntimeError("simulated PostgREST outage on claim re-read")
                r.data = [self._code_row(is_used=True, used_by=self._reread_used_by)]
        elif t == "access_codes" and a == "update":
            r.data = [self._code_row(is_used=True, used_by=_USER_ID)] if self._update_claims else []
        elif t == "users" and a == "select":
            r.data = [{"id": _USER_ID, "role": "user", "is_active": self._user_is_active}]
        elif t == "students" and a == "insert":
            r.data = [{"id": self._students_insert_id}] if self._students_insert_id else []
        # students select → [] (no target → enroll INSERT branch); every other
        # write (users update, students delete, assignments upsert) → [].
        return r


def _patch(monkeypatch, **kw):
    client = _RaceClient(**kw)

    async def _fake_user(_authz):
        return {"id": _USER_ID, "email": "loser@example.com",
                "user_metadata": {"full_name": "Loser"}}

    monkeypatch.setattr(auth_module, "get_supabase_user", _fake_user)
    monkeypatch.setattr(auth_module, "supabase_admin", client)
    return client


# ── Tests ─────────────────────────────────────────────────────────────


def test_loser_of_race_is_rejected_and_rolled_back(monkeypatch):
    """Step 1 saw is_used=false (race window), but the atomic claim matched 0
    rows and the re-read shows another user owns it → 400 + is_active rolled back."""
    client = _patch(monkeypatch, update_claims=False, reread_used_by=_OTHER_USER,
                    user_is_active=False)

    with pytest.raises(HTTPException) as ei:
        _run(auth_module.activate_account(_payload(), authorization="Bearer x"))
    assert ei.value.status_code == 400
    assert "đã được sử dụng" in ei.value.detail

    # Rollback: a users.update setting is_active=False must have been issued.
    rollbacks = [
        c for c in client.calls
        if c["table"] == "users" and c["action"] == "update"
        and isinstance(c["payload"], dict) and c["payload"].get("is_active") is False
    ]
    assert rollbacks, "loser must roll back its own is_active=True"


def test_loser_already_active_via_other_code_is_not_deactivated(monkeypatch):
    """If the loser was ALREADY active (a prior valid code), losing this race
    must reject WITHOUT deactivating them."""
    client = _patch(monkeypatch, update_claims=False, reread_used_by=_OTHER_USER,
                    user_is_active=True)

    with pytest.raises(HTTPException) as ei:
        _run(auth_module.activate_account(_payload(), authorization="Bearer x"))
    assert ei.value.status_code == 400

    deactivations = [
        c for c in client.calls
        if c["table"] == "users" and c["action"] == "update"
        and isinstance(c["payload"], dict) and c["payload"].get("is_active") is False
    ]
    assert not deactivations, "a pre-existing active user must not be deactivated"


def test_winner_claims_atomically_and_succeeds(monkeypatch):
    """The conditional UPDATE returns a row → activation completes, no rollback,
    and the claim carried the atomic is_used=false guard."""
    client = _patch(monkeypatch, update_claims=True)

    out = _run(auth_module.activate_account(_payload(), authorization="Bearer x"))
    assert out.get("success") is True

    claims = [
        c for c in client.calls
        if c["table"] == "access_codes" and c["action"] == "update"
    ]
    assert claims, "must attempt to claim the code"
    # The atomic guard: the claim filters on is_used == False.
    assert ("is_used", False) in claims[0]["filters"], \
        "the access_codes claim must be a conditional UPDATE WHERE is_used=false"

    rollbacks = [
        c for c in client.calls
        if c["table"] == "users" and c["action"] == "update"
        and isinstance(c["payload"], dict) and c["payload"].get("is_active") is False
    ]
    assert not rollbacks, "winner must not roll back"


def test_already_used_code_rejected_up_front(monkeypatch):
    """Sanity: a code already is_used at Step 1 read is rejected before any claim."""
    client = _patch(monkeypatch, update_claims=False, first_is_used=True,
                    first_used_by=_OTHER_USER)

    with pytest.raises(HTTPException) as ei:
        _run(auth_module.activate_account(_payload(), authorization="Bearer x"))
    assert ei.value.status_code == 400
    assert "đã được sử dụng" in ei.value.detail

    claims = [c for c in client.calls
              if c["table"] == "access_codes" and c["action"] == "update"]
    assert not claims, "must not attempt to claim an already-used code"


def test_indeterminate_claim_fails_closed(monkeypatch):
    """PR #589 comment 1: conditional claim matched 0 rows AND the ownership
    re-read raises → we cannot confirm ownership → FAIL CLOSED. Must reject with
    a retry (503), roll back is_active, and never reach the assignment write."""
    client = _patch(monkeypatch, update_claims=False, reread_raises=True,
                    user_is_active=False)

    with pytest.raises(HTTPException) as ei:
        _run(auth_module.activate_account(_payload(), authorization="Bearer x"))
    assert ei.value.status_code == 503  # retry, not "already used"

    assigns = [c for c in client.calls if c["table"] == "user_code_assignments"]
    assert not assigns, "indeterminate claim must NOT create an assignment row"

    rollbacks = [
        c for c in client.calls
        if c["table"] == "users" and c["action"] == "update"
        and isinstance(c["payload"], dict) and c["payload"].get("is_active") is False
    ]
    assert rollbacks, "indeterminate claim must roll back is_active"


def test_loser_enrollment_side_effects_are_undone(monkeypatch):
    """PR #589 comment 2: a cohort/enroll-signal code makes Step 3b INSERT a
    students row before the claim. If we then lose the race, that inserted row
    must be deleted — not left pointing at the rejected user."""
    client = _patch(monkeypatch, update_claims=False, reread_used_by=_OTHER_USER,
                    user_is_active=False, cohort_id="cohort-uuid",
                    students_insert_id="orphan-student-id")

    with pytest.raises(HTTPException) as ei:
        _run(auth_module.activate_account(_payload(), authorization="Bearer x"))
    assert ei.value.status_code == 400

    # The students row we inserted before losing must be deleted.
    deletes = [
        c for c in client.calls
        if c["table"] == "students" and c["action"] == "delete"
        and ("id", "orphan-student-id") in c["filters"]
    ]
    assert deletes, "the loser's inserted students row must be undone"

    assigns = [c for c in client.calls if c["table"] == "user_code_assignments"]
    assert not assigns, "loser must not create an assignment row"
