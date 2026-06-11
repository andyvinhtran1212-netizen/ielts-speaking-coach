"""PR1 read-path fix — legacy `used_by` fallback must not defeat per-user revoke.

Root cause (post-#441): `get_user_access_code_permissions` unioned the legacy
`access_codes.used_by` permissions UNCONDITIONALLY. `/activate` sets
`used_by = user` for every code (modern included) AND upserts an assignment, so
nearly every user has both. Per-user revoke (`remove_user_from_code`) only flips
`user_code_assignments.is_active=false` — it never clears the immutable
`used_by` — so the unconditional `used_by` union kept granting after a revoke.
Speaking access survived a per-user revoke.

Fix: the `used_by` fallback now applies ONLY to codes the user has NO assignment
row for (active or inactive). An inactive assignment row means a deliberate
revoke → the modern path is authoritative → deny. A code with no assignment row
at all is a TRUE legacy code → fallback still applies (PR3 backfills those).

These six cases pin the fix's contract. They drive the REAL live query through
an in-memory fake Supabase so a revoke (flip assignment is_active) is reflected
on re-query — the instant-revoke behaviour the fix restores.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import services.access_code_permissions as perms_mod
from services.access_code_permissions import (
    get_user_access_code_permissions,
    get_user_permissions_summary,
)


# ── In-memory fake Supabase (models the two tables the live query touches) ────


class _Builder:
    def __init__(self, rows):
        self._rows = rows
        self._preds = []

    def select(self, *_a, **_kw):
        return self

    def eq(self, col, val):
        self._preds.append((col, val, "eq"))
        return self

    def in_(self, col, vals):
        self._preds.append((col, set(vals), "in"))
        return self

    def execute(self):
        out = []
        for row in self._rows:
            ok = True
            for col, val, op in self._preds:
                if op == "eq" and row.get(col) != val:
                    ok = False
                    break
                if op == "in" and row.get(col) not in val:
                    ok = False
                    break
            if ok:
                out.append(dict(row))

        class _R:
            pass

        r = _R()
        r.data = out
        return r


class _FakeSupabase:
    def __init__(self, assignments, codes):
        self._tables = {
            "user_code_assignments": assignments,
            "access_codes": codes,
        }

    def table(self, name):
        return _Builder(self._tables.get(name, []))


def _install(monkeypatch, assignments, codes):
    monkeypatch.setattr(perms_mod, "supabase_admin", _FakeSupabase(assignments, codes))


def _future():
    return (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()


def _code(code_id, permissions, used_by, *, is_revoked=False, is_active=True):
    return {
        "id": code_id,
        "permissions": list(permissions),
        "is_revoked": is_revoked,
        "is_active": is_active,
        "expires_at": _future(),
        "used_by": used_by,
    }


def _assign(user_id, code_id, *, is_active=True):
    return {"user_id": user_id, "code_id": code_id, "is_active": is_active}


# ── 1. active assignment + used_by=self → granted ────────────────────────────


def test_active_assignment_with_self_usedby_grants(monkeypatch):
    _install(
        monkeypatch,
        [_assign("u1", "c1", is_active=True)],
        [_code("c1", ["practice_single"], used_by="u1")],
    )
    assert get_user_access_code_permissions("u1") == ["practice_single"]


# ── 2. per-user revoke (assignment inactive) + used_by=self → CUT NOW ─────────
# The keystone: this is exactly the bug. used_by still points at the user, but
# the inactive assignment means a deliberate revoke → fallback must be suppressed.


def test_revoked_assignment_with_self_usedby_is_cut(monkeypatch):
    _install(
        monkeypatch,
        [_assign("u1", "c1", is_active=False)],  # admin ran remove-user
        [_code("c1", ["practice_single"], used_by="u1")],  # used_by NOT cleared
    )
    assert get_user_access_code_permissions("u1") == []


# ── 3. true legacy used_by (NO assignment row) → still granted (PR3 backfills) ─


def test_legacy_usedby_without_assignment_still_grants(monkeypatch):
    _install(
        monkeypatch,
        [],  # no assignment row at all
        [_code("c1", ["practice_part"], used_by="legacy-user")],
    )
    assert get_user_access_code_permissions("legacy-user") == ["practice_part"]


# ── 4. per-code revoke (is_revoked) cuts both paths ──────────────────────────


def test_per_code_revoke_cuts_both_paths(monkeypatch):
    _install(
        monkeypatch,
        [_assign("u1", "c1", is_active=False)],
        [_code("c1", ["practice_full"], used_by="u1", is_revoked=True)],
    )
    assert get_user_access_code_permissions("u1") == []


# ── 5. revoking user A doesn't affect user B on the same code ────────────────


def test_per_user_revoke_is_scoped_to_one_user(monkeypatch):
    # Code's single redeemer is A (used_by=A). B is a cohort-mate via assignment.
    codes = [_code("shared", ["practice_part"], used_by="A")]
    assignments = [
        _assign("A", "shared", is_active=False),  # A revoked
        _assign("B", "shared", is_active=True),   # B still active
    ]
    _install(monkeypatch, assignments, codes)

    assert get_user_access_code_permissions("A") == []  # cut (used_by suppressed)
    assert get_user_access_code_permissions("B") == ["practice_part"]  # unaffected


# ── 6. /auth/me ↔ /api/student/permissions consistent after per-user revoke ──


def test_auth_me_and_student_permissions_consistent_after_revoke(monkeypatch):
    """Both endpoints derive from get_user_access_code_permissions(_cached) — the
    single source. After a per-user revoke they must agree (both empty)."""
    _install(
        monkeypatch,
        [_assign("u1", "c1", is_active=False)],
        [_code("c1", ["practice_single", "writing"], used_by="u1")],
    )
    # /auth/me uses the cached wrapper; no request memo active → direct passthrough.
    me_perms = perms_mod.get_user_access_code_permissions_cached("u1")
    summary = get_user_permissions_summary(get_user_access_code_permissions("u1"))

    assert me_perms == []
    assert summary["writing"] is False
    for perm, flag in [
        ("practice_single", "speaking_practice_single"),
        ("practice_part", "speaking_practice_part"),
        ("practice_full", "speaking_practice_full"),
    ]:
        assert summary[flag] == (perm in me_perms)
