"""
Tests for the D1 session lifecycle:

  POST /api/exercises/d1/sessions          (start_d1_session)
  GET  /api/exercises/d1/sessions/{id}     (get_d1_session)
  POST /api/exercises/d1/sessions/{id}/complete  (complete_d1_session)
  POST /admin/exercises/{id}/unpublish     (admin_unpublish_exercise)
  POST /api/exercises/d1/{id}/attempt      (session_id link)

Stub the user-scoped Supabase client + auth + feature flag at the module
level so the tests run without DB or live auth. Live cross-user RLS
verification lives in test_exercise_rls.py and auto-skips without env.

Run: pytest backend/tests/test_d1_session.py -v
"""

import asyncio
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest


# ── Fake Supabase client ──────────────────────────────────────────────────────
#
# Mimics the chain of .table().select().eq().not_.in_().order().limit().execute()
# the router uses. Stores rows in dicts keyed by table name.

class _FakeRes:
    def __init__(self, data): self.data = data


class _FakeQuery:
    def __init__(self, table_name: str, store: dict[str, list[dict]]):
        self.table_name = table_name
        self.store = store
        self._select: str | None = None
        self._eq: list[tuple[str, Any]] = []
        self._in: tuple[str, list] | None = None
        self._not_in: tuple[str, list] | None = None
        self._order_col: str | None = None
        self._order_desc: bool = False
        self._limit: int | None = None
        self._update: dict | None = None
        self._insert: list[dict] | None = None
        self.not_ = self  # so .not_.in_(...) chains back to this query

    def select(self, cols):                 self._select = cols; return self
    def eq(self, col, val):                 self._eq.append((col, val)); return self
    def in_(self, col, values):
        # Distinguish positive in_ vs not.in_: when called via .not_.in_(...)
        # the chain re-enters this method on the same instance — track by
        # whether _select is None (positive in_ on a fresh query) vs already-set.
        # In our usage, both router paths set select first, so we need a flag.
        # Simpler: if there's already an _in for this query, this must be the
        # not.in_ call (Supabase chains .not_.in_ AFTER an existing .eq).
        if self._in is None and self._not_in is None and not self._eq_after_select():
            self._in = (col, list(values))
        else:
            # Heuristic: caller used `.not_.in_(...)`.  The fake's not_ alias
            # routes here; flag as not_in.
            self._not_in = (col, list(values))
        return self
    def _eq_after_select(self):
        return bool(self._eq) and self._select is not None
    def order(self, col, desc=False):       self._order_col = col; self._order_desc = desc; return self
    def limit(self, n):                     self._limit = n; return self
    def update(self, payload):              self._update = payload; return self
    def insert(self, rows):
        self._insert = list(rows) if isinstance(rows, list) else [rows]
        return self

    def execute(self):
        rows = list(self.store.get(self.table_name, []))
        # INSERT path: append to store and return the inserted rows.
        if self._insert is not None:
            inserted = []
            for r in self._insert:
                # Generate id if missing.
                if "id" not in r or r["id"] is None:
                    r = {**r, "id": f"gen-{len(self.store[self.table_name])}"}
                self.store.setdefault(self.table_name, []).append(r)
                inserted.append(r)
            return _FakeRes(inserted)

        # SELECT/UPDATE filters
        for col, val in self._eq:
            rows = [r for r in rows if r.get(col) == val]
        if self._in:
            col, values = self._in
            rows = [r for r in rows if r.get(col) in values]
        if self._not_in:
            col, values = self._not_in
            rows = [r for r in rows if r.get(col) not in values]

        if self._order_col:
            rows.sort(key=lambda r: r.get(self._order_col), reverse=self._order_desc)
        if self._limit is not None:
            rows = rows[: self._limit]

        if self._update is not None:
            for r in rows:
                r.update(self._update)
        return _FakeRes(rows)


class _FakeClient:
    def __init__(self, store: dict[str, list[dict]]):
        self.store = store

    def table(self, name):
        self.store.setdefault(name, [])
        return _FakeQuery(name, self.store)


# ── Helpers ───────────────────────────────────────────────────────────────────


USER_ID = "user-aaa"
OTHER_USER_ID = "user-zzz"


def _exercise(idx: int, status: str = "published") -> dict:
    return {
        "id": f"ex-{idx}",
        "exercise_type": "D1",
        "status": status,
        "content_payload": {
            "sentence":    f"This is sentence {idx} with ___ in it.",
            "answer":      f"answer{idx}",
            "distractors": [f"a{idx}", f"b{idx}", f"c{idx}"],
        },
    }


def _patch_user_route(monkeypatch, store: dict, user_id: str = USER_ID):
    from routers import exercises as exr

    async def _fake_auth(_authorization):
        return {"id": user_id}

    fake = _FakeClient(store)
    monkeypatch.setattr("routers.auth.get_supabase_user", _fake_auth)
    monkeypatch.setattr(exr, "get_supabase_user", _fake_auth)
    monkeypatch.setattr(exr, "is_d1_enabled", lambda *_a, **_k: True)
    monkeypatch.setattr(exr, "_user_sb", lambda _token: fake)
    monkeypatch.setattr(exr, "_bearer_token", lambda _h: "fake-token")
    return fake


def _patch_admin(monkeypatch, store: dict):
    from routers import exercises as exr

    async def _fake_admin(_authorization):
        return {"id": "admin-1", "email": "admin@example.com"}

    monkeypatch.setattr(exr, "require_admin", _fake_admin)
    monkeypatch.setattr(exr, "supabase_admin", _FakeClient(store))


# ── start_d1_session ──────────────────────────────────────────────────────────


def test_start_session_creates_record(monkeypatch):
    from routers import exercises as exr
    from routers.exercises import StartSessionRequest

    store = {
        "vocabulary_exercises": [_exercise(i) for i in range(15)],
        "vocabulary_exercise_attempts": [],
        "d1_sessions": [],
    }
    _patch_user_route(monkeypatch, store)

    out = asyncio.run(exr.start_d1_session(
        StartSessionRequest(size=10), authorization="Bearer x",
    ))

    assert "session_id" in out and out["session_id"]
    assert out["total"] == 10
    assert len(out["exercises"]) == 10
    # Exactly one row was inserted into d1_sessions.
    assert len(store["d1_sessions"]) == 1
    saved = store["d1_sessions"][0]
    assert saved["user_id"]      == USER_ID
    assert saved["total_count"]  == 10
    assert len(saved["exercise_ids"]) == 10


def test_start_session_returns_exercises_with_answer(monkeypatch):
    """Local grading needs the answer field on every exercise — that's the
    whole point of going through /sessions instead of /d1 (which strips it)."""
    from routers import exercises as exr
    from routers.exercises import StartSessionRequest

    store = {
        "vocabulary_exercises": [_exercise(i) for i in range(10)],
        "vocabulary_exercise_attempts": [],
        "d1_sessions": [],
    }
    _patch_user_route(monkeypatch, store)

    out = asyncio.run(exr.start_d1_session(
        StartSessionRequest(size=10), authorization="Bearer x",
    ))

    for ex in out["exercises"]:
        assert "answer"   in ex and ex["answer"]
        assert "options"  in ex and len(ex["options"]) == 4
        assert "sentence" in ex
        assert ex["answer"] in ex["options"]


def test_start_session_picks_unattempted_first(monkeypatch):
    """When there are 5 unattempted + 5 attempted and size=5, the
    unattempted ones should fill the session."""
    from routers import exercises as exr
    from routers.exercises import StartSessionRequest

    store = {
        "vocabulary_exercises": [_exercise(i) for i in range(10)],
        "vocabulary_exercise_attempts": [
            {"user_id": USER_ID, "exercise_id": f"ex-{i}",
             "exercise_type": "D1"}
            for i in range(5)  # ex-0..ex-4 already attempted
        ],
        "d1_sessions": [],
    }
    _patch_user_route(monkeypatch, store)

    out = asyncio.run(exr.start_d1_session(
        StartSessionRequest(size=5), authorization="Bearer x",
    ))

    chosen_ids = {e["id"] for e in out["exercises"]}
    attempted_ids = {f"ex-{i}" for i in range(5)}
    assert chosen_ids.isdisjoint(attempted_ids), (
        f"unattempted-first failed; got {chosen_ids}"
    )


def test_start_session_fallback_to_attempted(monkeypatch):
    """When unattempted < size, the response still has `size` items,
    pulled from the broader pool (repetition is intentional for review)."""
    from routers import exercises as exr
    from routers.exercises import StartSessionRequest

    # 8 published; user has attempted all 8 → unattempted pool is empty.
    store = {
        "vocabulary_exercises": [_exercise(i) for i in range(8)],
        "vocabulary_exercise_attempts": [
            {"user_id": USER_ID, "exercise_id": f"ex-{i}",
             "exercise_type": "D1"}
            for i in range(8)
        ],
        "d1_sessions": [],
    }
    _patch_user_route(monkeypatch, store)

    # Ask for 5 — fallback should fill from already-attempted.
    out = asyncio.run(exr.start_d1_session(
        StartSessionRequest(size=5), authorization="Bearer x",
    ))

    assert len(out["exercises"]) == 5  # all from fallback


# ── Attempt session linkage ──────────────────────────────────────────────────


def test_attempt_links_to_session(monkeypatch):
    """POST /attempt with a valid session_id stamps session_id on the row."""
    from routers import exercises as exr
    from routers.exercises import D1AttemptRequest

    store = {
        "vocabulary_exercises": [_exercise(0)],
        "vocabulary_exercise_attempts": [],
        "d1_sessions": [{
            "id": "sess-1", "user_id": USER_ID,
            "exercise_ids": ["ex-0"], "total_count": 1, "status": "active",
        }],
    }
    _patch_user_route(monkeypatch, store)

    # Bypass the rate-limit decorator's auth call too.
    async def _fake_auth(_authorization): return {"id": USER_ID}
    monkeypatch.setattr("routers.auth.get_supabase_user", _fake_auth)

    asyncio.run(exr.submit_d1_attempt(
        exercise_id="ex-0",
        body=D1AttemptRequest(user_answer="answer0", session_id="sess-1"),
        authorization="Bearer x",
    ))

    assert len(store["vocabulary_exercise_attempts"]) == 1
    assert store["vocabulary_exercise_attempts"][0]["session_id"] == "sess-1"


def test_attempt_drops_invalid_session_link(monkeypatch):
    """A session_id that doesn't list the exercise_id in its snapshot
    must not pollute the link — drop it but still log the attempt."""
    from routers import exercises as exr
    from routers.exercises import D1AttemptRequest

    store = {
        "vocabulary_exercises": [_exercise(0), _exercise(99)],
        "vocabulary_exercise_attempts": [],
        # Session lists ex-99 only — submitting an attempt for ex-0 with
        # this session_id is a forged or stale link.
        "d1_sessions": [{
            "id": "sess-1", "user_id": USER_ID,
            "exercise_ids": ["ex-99"], "total_count": 1, "status": "active",
        }],
    }
    _patch_user_route(monkeypatch, store)

    async def _fake_auth(_authorization): return {"id": USER_ID}
    monkeypatch.setattr("routers.auth.get_supabase_user", _fake_auth)

    asyncio.run(exr.submit_d1_attempt(
        exercise_id="ex-0",
        body=D1AttemptRequest(user_answer="answer0", session_id="sess-1"),
        authorization="Bearer x",
    ))

    # Attempt logged but session_id dropped to None.
    assert len(store["vocabulary_exercise_attempts"]) == 1
    assert store["vocabulary_exercise_attempts"][0]["session_id"] is None


# ── complete_d1_session ──────────────────────────────────────────────────────


def test_complete_session_returns_summary_and_updates_status(monkeypatch):
    from routers import exercises as exr

    store = {
        "vocabulary_exercises": [_exercise(0), _exercise(1), _exercise(2)],
        "d1_sessions": [{
            "id": "sess-1", "user_id": USER_ID,
            "exercise_ids": ["ex-0", "ex-1", "ex-2"],
            "total_count": 3, "status": "active",
        }],
        "vocabulary_exercise_attempts": [
            {"exercise_id": "ex-0", "user_answer": "answer0", "is_correct": True,
             "session_id": "sess-1", "user_id": USER_ID, "exercise_type": "D1"},
            {"exercise_id": "ex-1", "user_answer": "wrong",   "is_correct": False,
             "session_id": "sess-1", "user_id": USER_ID, "exercise_type": "D1"},
            # ex-2 skipped — not attempted
        ],
    }
    _patch_user_route(monkeypatch, store)

    out = asyncio.run(exr.complete_d1_session(
        session_id="sess-1", authorization="Bearer x",
    ))

    assert out["correct_count"]  == 1
    assert out["total_count"]    == 3
    assert len(out["correct"])   == 1 and out["correct"][0]["exercise_id"] == "ex-0"
    assert len(out["wrong"])     == 1 and out["wrong"][0]["exercise_id"]   == "ex-1"
    assert out["wrong"][0]["user_answer"]    == "wrong"
    assert out["wrong"][0]["correct_answer"] == "answer1"

    # Session row stamped completed.
    sess = store["d1_sessions"][0]
    assert sess["status"]        == "completed"
    assert sess["correct_count"] == 1
    assert sess.get("completed_at")


def test_complete_session_404_when_not_found(monkeypatch):
    from fastapi import HTTPException
    from routers import exercises as exr

    store = {"vocabulary_exercises": [], "d1_sessions": [], "vocabulary_exercise_attempts": []}
    _patch_user_route(monkeypatch, store)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(exr.complete_d1_session(
            session_id="missing", authorization="Bearer x",
        ))
    assert exc.value.status_code == 404


# ── Admin unpublish ──────────────────────────────────────────────────────────


def test_unpublish_moves_published_to_draft(monkeypatch):
    from routers import exercises as exr

    store = {
        "vocabulary_exercises": [{"id": "ex-1", "status": "published"}],
    }
    _patch_admin(monkeypatch, store)

    out = asyncio.run(exr.admin_unpublish_exercise(
        exercise_id="ex-1", authorization="Bearer admin",
    ))

    assert out["status"] == "draft"
    assert store["vocabulary_exercises"][0]["status"] == "draft"


def test_unpublish_admin_only(monkeypatch):
    """Non-admin caller → 403 from require_admin."""
    from fastapi import HTTPException
    from routers import exercises as exr

    async def _deny_admin(_authorization):
        raise HTTPException(403, "not admin")

    monkeypatch.setattr(exr, "require_admin", _deny_admin)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(exr.admin_unpublish_exercise(
            exercise_id="ex-1", authorization="Bearer not-admin",
        ))
    assert exc.value.status_code == 403


# ── Live 2-JWT RLS isolation for d1_sessions ─────────────────────────────────
#
# Mirrors test_exercise_rls.py: requires 2 real Supabase test users provisioned
# by backend/scripts/setup_phase_d_test_env.sh. Auto-skipped when env vars are
# absent so the unit-test block above still runs in any environment.

import os  # noqa: E402  (imports here to keep top-of-file unit-test stubs intact)

_RLS_REQUIRED_VARS = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "RLS_TEST_USER_A_EMAIL",
    "RLS_TEST_USER_A_PASSWORD",
    "RLS_TEST_USER_B_EMAIL",
    "RLS_TEST_USER_B_PASSWORD",
]


def _rls_get_user_client(email: str, password: str):
    from supabase import create_client

    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
    client.auth.sign_in_with_password({"email": email, "password": password})
    return client


@pytest.mark.skipif(
    not all(os.getenv(k) for k in _RLS_REQUIRED_VARS),
    reason="Live RLS tests require 2 test users — set all RLS_TEST_USER_* env vars",
)
def test_session_rls_isolation():
    """User A's d1_sessions row must be invisible + immutable to User B, and
    User A must not be able to reassign user_id to User B (WITH CHECK)."""
    client_a = _rls_get_user_client(
        os.environ["RLS_TEST_USER_A_EMAIL"],
        os.environ["RLS_TEST_USER_A_PASSWORD"],
    )
    client_b = _rls_get_user_client(
        os.environ["RLS_TEST_USER_B_EMAIL"],
        os.environ["RLS_TEST_USER_B_PASSWORD"],
    )

    user_a_id = client_a.auth.get_user().user.id
    user_b_id = client_b.auth.get_user().user.id

    # Need at least one published exercise to populate exercise_ids realistically.
    pub = client_a.table("vocabulary_exercises").select("id").eq("status", "published").limit(1).execute()
    if not pub.data:
        pytest.skip("Need at least one published exercise — run setup_phase_d_test_env.sh first.")
    exercise_id = pub.data[0]["id"]

    inserted = client_a.table("d1_sessions").insert({
        "user_id":      user_a_id,
        "exercise_ids": [exercise_id],
        "total_count":  1,
        "status":       "active",
    }).execute()
    assert inserted.data, "User A should be able to insert their own d1_sessions row"
    row_id = inserted.data[0]["id"]

    try:
        # 1) User B SELECT must return 0 rows.
        sel_b = client_b.table("d1_sessions").select("*").eq("id", row_id).execute()
        assert len(sel_b.data) == 0, (
            f"RLS SELECT FAIL: User B saw User A's session {row_id}: {sel_b.data!r}"
        )

        # 2) User B UPDATE must affect 0 rows (silent no-op under PostgREST).
        upd_b = (
            client_b.table("d1_sessions")
            .update({"status": "completed"})
            .eq("id", row_id)
            .execute()
        )
        assert len(upd_b.data) == 0, (
            f"RLS UPDATE FAIL: User B updated User A's session {row_id}: {upd_b.data!r}"
        )
        # Row should still belong to User A and still be active.
        verify = client_a.table("d1_sessions").select("user_id,status").eq("id", row_id).execute()
        assert verify.data and verify.data[0]["user_id"] == user_a_id
        assert verify.data[0]["status"] == "active", (
            "RLS UPDATE FAIL: User B's update somehow took effect"
        )

        # 3) User A trying to reassign user_id → User B must be blocked by WITH CHECK.
        blocked = False
        try:
            res = (
                client_a.table("d1_sessions")
                .update({"user_id": user_b_id})
                .eq("id", row_id)
                .execute()
            )
            # PostgREST may return empty data instead of raising when WITH CHECK fails.
            blocked = not res.data
        except Exception:
            blocked = True
        assert blocked, "RLS WITH CHECK FAIL: User A reassigned user_id to User B"

        # And the row must still be owned by User A after the attempted reassignment.
        verify2 = client_a.table("d1_sessions").select("user_id").eq("id", row_id).execute()
        assert verify2.data and verify2.data[0]["user_id"] == user_a_id, (
            "RLS WITH CHECK FAIL: row's user_id was changed despite policy"
        )
    finally:
        client_a.table("d1_sessions").delete().eq("id", row_id).execute()
