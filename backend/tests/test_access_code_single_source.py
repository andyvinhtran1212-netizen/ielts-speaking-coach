"""PR1 single-live-source cutover — contract tests.

Speaking (`sessions._require_permission`) and `/auth/me` used to gate on the
denormalised `users.permissions` snapshot copied at /activate, while Writing and
`/api/student/permissions` already gated on the LIVE access-code query. That
split meant a revoke blocked Writing instantly but never blocked Speaking, and
`/auth/me` disagreed with `/api/student/permissions`.

The cutover routes ALL gates through one source:
`get_user_access_code_permissions(user_id)` — the live query over
`user_code_assignments` (is_active) → `access_codes` (honouring
is_revoked / is_active / expires_at), with the legacy `used_by` fallback.

These six cases pin the cutover's observable contract:

  1. revoke an assignment → speaking blocked on the NEXT request
  2. per-user revoke cuts exactly that user; a cohort-mate on the same code stays
  3. expired / inactive / revoked code grants nothing, even with an active row
  4. /auth/me and /api/student/permissions agree after a revoke (one source)
  5. a live ["all"] user keeps every speaking mode (Andy's case — no grandfather)
  6. a live [] user is cut from speaking (letanphat's case)

They drive the REAL live query through an in-memory fake Supabase so mutations
(flip is_active, set expires_at) are reflected on re-query — exactly the
instant-revoke behaviour the cutover promises. No per-request memo is active in
these tests, so every call re-reads the (mutated) fake.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

import services.access_code_permissions as perms_mod
from routers import sessions as sessions_module
from services.access_code_permissions import (
    get_user_access_code_permissions,
    get_user_permissions_summary,
    has_permission,
)


# ── In-memory fake Supabase ──────────────────────────────────────────────────
# Models just the two tables the live query touches. Rows are mutable dicts the
# tests flip between calls; the builder applies the accumulated eq()/in_()
# predicates on execute(), so a revoke set BETWEEN two queries shows up on the
# second — the whole point of the cutover.


class _Builder:
    def __init__(self, rows):
        self._rows = rows
        self._preds = []  # list of (col, value, op)

    def select(self, *_a, **_kw):
        return self

    def eq(self, col, val):
        self._preds.append((col, val, "eq"))
        return self

    def in_(self, col, vals):
        self._preds.append((col, set(vals), "in"))
        return self

    def gte(self, *_a, **_kw):
        return self

    def limit(self, *_a, **_kw):
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
    """Point the live query at a fresh fake; return it so tests can mutate rows
    and re-query to observe instant revoke."""
    fake = _FakeSupabase(assignments, codes)
    monkeypatch.setattr(perms_mod, "supabase_admin", fake)
    return fake


def _future():
    return (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()


def _past():
    return (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()


def _code(code_id, permissions, *, is_revoked=False, is_active=True, expires_at=None):
    return {
        "id": code_id,
        "permissions": list(permissions),
        "is_revoked": is_revoked,
        "is_active": is_active,
        "expires_at": expires_at,
        "used_by": None,
    }


def _assign(user_id, code_id, *, is_active=True):
    return {"user_id": user_id, "code_id": code_id, "is_active": is_active}


# ── 1. revoke assignment → speaking blocked on the next request ──────────────


def test_revoke_assignment_blocks_speaking_immediately(monkeypatch):
    assignment = _assign("u1", "c1")
    _install(monkeypatch, [assignment], [_code("c1", ["practice_single"], expires_at=_future())])

    # Before revoke: gate passes.
    assert get_user_access_code_permissions("u1") == ["practice_single"]
    sessions_module._require_permission("u1", "practice")  # no raise

    # Admin revokes the assignment (admin.py:1550 sets is_active=False).
    assignment["is_active"] = False

    # Next request re-reads the live source → cut NOW, no snapshot survival.
    assert get_user_access_code_permissions("u1") == []
    with pytest.raises(HTTPException) as exc:
        sessions_module._require_permission("u1", "practice")
    assert exc.value.status_code == 403


# ── 2. per-user revoke cuts one user; cohort-mate on same code stays ─────────


def test_per_user_revoke_is_scoped_to_one_user(monkeypatch):
    a1 = _assign("u1", "shared")
    a2 = _assign("u2", "shared")
    _install(monkeypatch, [a1, a2], [_code("shared", ["practice_part"], expires_at=_future())])

    assert get_user_access_code_permissions("u1") == ["practice_part"]
    assert get_user_access_code_permissions("u2") == ["practice_part"]

    # Per-user revoke flips only u1's assignment row, not the code.
    a1["is_active"] = False

    assert get_user_access_code_permissions("u1") == []  # cut
    assert get_user_access_code_permissions("u2") == ["practice_part"]  # cohort-mate stays
    sessions_module._require_permission("u2", "test_part")  # u2 still passes
    with pytest.raises(HTTPException):
        sessions_module._require_permission("u1", "test_part")


# ── 3. expired / inactive / revoked code grants nothing ──────────────────────


@pytest.mark.parametrize(
    "mutation",
    [
        {"expires_at": _past()},
        {"is_active": False},
        {"is_revoked": True},
    ],
    ids=["expired", "inactive", "revoked"],
)
def test_dead_code_grants_nothing_even_with_active_assignment(monkeypatch, mutation):
    code = _code("c1", ["practice_full"], expires_at=_future())
    code.update(mutation)
    _install(monkeypatch, [_assign("u1", "c1")], [code])

    # Active assignment, but the code itself is dead → no permissions live.
    assert get_user_access_code_permissions("u1") == []
    with pytest.raises(HTTPException):
        sessions_module._require_permission("u1", "test_full")


# ── 4. /auth/me and /api/student/permissions agree after a revoke ────────────


def test_auth_me_and_student_permissions_consistent_after_revoke(monkeypatch):
    """Both endpoints derive from get_user_access_code_permissions — the single
    source. /auth/me returns the raw list; /api/student/permissions returns the
    summary flags. They must describe the SAME grants, before and after revoke.
    """
    assignment = _assign("u1", "c1")
    _install(monkeypatch, [assignment], [_code("c1", ["practice_single", "writing"], expires_at=_future())])

    def snapshot():
        # /auth/me uses the (cached wrapper over the) same function; with no
        # request memo active the cached wrapper is a direct passthrough.
        me_perms = perms_mod.get_user_access_code_permissions_cached("u1")
        # /api/student/permissions = summary over the same source.
        summary = get_user_permissions_summary(get_user_access_code_permissions("u1"))
        return me_perms, summary

    me_perms, summary = snapshot()
    assert "writing" in me_perms and summary["writing"] is True
    assert "practice_single" in me_perms and summary["speaking_practice_single"] is True
    # Each speaking flag agrees with membership in the /auth/me list.
    for perm, flag in [
        ("practice_single", "speaking_practice_single"),
        ("practice_part", "speaking_practice_part"),
        ("practice_full", "speaking_practice_full"),
    ]:
        assert summary[flag] == (perm in me_perms)

    # Revoke → both reflect the cut, still agreeing.
    assignment["is_active"] = False
    me_perms, summary = snapshot()
    assert me_perms == []
    assert summary["writing"] is False
    assert summary["speaking_practice_single"] is False
    for perm, flag in [
        ("practice_single", "speaking_practice_single"),
        ("practice_part", "speaking_practice_part"),
        ("practice_full", "speaking_practice_full"),
    ]:
        assert summary[flag] == (perm in me_perms)


# ── 5. live ["all"] keeps every speaking mode (Andy — no grandfather) ────────


def test_all_permission_keeps_every_speaking_mode(monkeypatch):
    _install(monkeypatch, [_assign("andy", "c-all")], [_code("c-all", ["all"], expires_at=_future())])

    perms = get_user_access_code_permissions("andy")
    assert perms == ["all"]
    # "all" is the wildcard — every speaking mode passes.
    for mode in ("practice", "test_part", "test_full"):
        sessions_module._require_permission("andy", mode)  # no raise
    assert has_permission(perms, "practice_full") is True


# ── 6. live [] user is cut from speaking (letanphat) ─────────────────────────


def test_empty_live_permissions_is_cut_from_speaking(monkeypatch):
    # A live "[]" code (assigned, active, not expired — but grants nothing).
    _install(monkeypatch, [_assign("letanphat", "c-empty")], [_code("c-empty", [], expires_at=_future())])

    assert get_user_access_code_permissions("letanphat") == []
    assert has_permission([], "practice_single") is False
    with pytest.raises(HTTPException) as exc:
        sessions_module._require_permission("letanphat", "practice")
    assert exc.value.status_code == 403
