"""tests/test_feedback.py — Feedback foundation (PR-1).

POST /api/feedback (rating | report | flag; authed + reading-anon; double-rating
409; ownership), GET /api/admin/feedback (filter + group-by-test, require_admin),
PATCH /api/admin/feedback/{id} (status, require_admin). DB mocked.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from routers import feedback as F


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _R:
    def __init__(self, data): self.data = data


class _Q:
    def __init__(self, db, table):
        self._db = db; self._t = table; self._op = "select"
        self._filters = {}; self._payload = None
    def select(self, *a, **k): self._op = "select"; return self
    def insert(self, row, *a, **k): self._op = "insert"; self._payload = row; return self
    def update(self, patch, *a, **k): self._op = "update"; self._payload = patch; return self
    def eq(self, col, val): self._filters[col] = val; return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def execute(self): return self._db.handle(self._t, self._op, self._filters, self._payload)


class _DB:
    def __init__(self, attempt=None, test_id="ILR-X", existing_rating=False,
                 feedback_rows=None, update_found=True):
        self._attempt = attempt
        self._test_id = test_id
        self._existing = existing_rating
        self._feedback_rows = feedback_rows or []
        self._update_found = update_found
        self.inserted = []
        self.updated = []
    def table(self, n): return _Q(self, n)
    def handle(self, table, op, filters, payload):
        if table in ("reading_test_attempts", "listening_test_attempts"):
            return _R([self._attempt] if self._attempt else [])
        if table in ("reading_tests", "listening_tests"):
            return _R([{"test_id": self._test_id}] if self._test_id else [])
        if table == "user_feedback":
            if op == "insert":
                self.inserted.append(payload); return _R([payload])
            if op == "update":
                self.updated.append((dict(filters), dict(payload)))
                return _R([{"id": filters.get("id")}] if self._update_found else [])
            # select: rating pre-check (attempt_id + type=rating) vs admin list
            if "attempt_id" in filters and filters.get("type") == "rating":
                return _R([{"id": "existing"}] if self._existing else [])
            return _R(self._feedback_rows)
        return _R([])


def _as_user(monkeypatch, uid="U1"):
    async def _u(_a): return {"id": uid, "email": "u@x"}
    monkeypatch.setattr(F, "get_supabase_user", _u)


def _as_admin(monkeypatch, aid="A1"):
    async def _a(_a): return {"id": aid}
    monkeypatch.setattr(F, "require_admin", _a)


def _deny_admin(monkeypatch):
    async def _a(_a): raise HTTPException(403, "no")
    monkeypatch.setattr(F, "require_admin", _a)


_AUTHED_LISTENING_ATTEMPT = {"id": "att-L", "user_id": "U1", "test_id": "tu-L"}
_AUTHED_READING_ATTEMPT = {"id": "att-R", "user_id": "U1", "test_id": "tu-R"}
_ANON_READING_ATTEMPT = {"id": "att-A", "user_id": None, "anon_id": "secret-tok", "test_id": "tu-R"}


# ── POST: the three types ─────────────────────────────────────────────────────

def test_post_rating_listening(monkeypatch):
    _as_user(monkeypatch)
    db = _DB(attempt=_AUTHED_LISTENING_ATTEMPT, test_id="ILR-LIS-01")
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="rating", skill="listening", attempt_id="att-L",
                        rating_de=5, rating_audio=4, note="hay")
    out = _run(F.submit_feedback(body, authorization="x", x_reading_anon=None))
    assert out["status"] == "new"
    row = db.inserted[0]
    assert row["type"] == "rating" and row["skill"] == "listening"
    assert row["rating_de"] == 5 and row["rating_audio"] == 4
    assert row["test_id"] == "ILR-LIS-01" and row["created_by"] == "U1"
    assert row["anon_id"] is None and row["q_num"] is None


def test_post_report_reading(monkeypatch):
    _as_user(monkeypatch)
    db = _DB(attempt=_AUTHED_READING_ATTEMPT, test_id="ILR-RD-01")
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="report", skill="reading", attempt_id="att-R",
                        category="wrong_answer", note="Q3 sai đáp án", q_num=3)
    out = _run(F.submit_feedback(body, authorization="x", x_reading_anon=None))
    assert out["status"] == "new"
    row = db.inserted[0]
    assert row["type"] == "report" and row["category"] == "wrong_answer"
    assert row["q_num"] == 3 and row["rating_de"] is None


def test_post_flag_listening(monkeypatch):
    _as_user(monkeypatch)
    db = _DB(attempt=_AUTHED_LISTENING_ATTEMPT, test_id="ILR-LIS-01")
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="flag", skill="listening", attempt_id="att-L", q_num=7,
                        note="giải khó hiểu")
    out = _run(F.submit_feedback(body, authorization="x", x_reading_anon=None))
    row = db.inserted[0]
    assert row["type"] == "flag" and row["q_num"] == 7 and row["rating_de"] is None


# ── POST: anonymous reading path ──────────────────────────────────────────────

def test_post_anon_reading_rating(monkeypatch):
    # no authorization header → anonymous; ownership via X-Reading-Anon
    db = _DB(attempt=_ANON_READING_ATTEMPT, test_id="ILR-RD-01")
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="rating", skill="reading", attempt_id="att-A", rating_de=4)
    out = _run(F.submit_feedback(body, authorization=None, x_reading_anon="secret-tok"))
    assert out["status"] == "new"
    row = db.inserted[0]
    assert row["created_by"] is None and row["anon_id"] == "secret-tok"


def test_post_anon_wrong_token_403(monkeypatch):
    db = _DB(attempt=_ANON_READING_ATTEMPT)
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="rating", skill="reading", attempt_id="att-A", rating_de=4)
    with pytest.raises(HTTPException) as e:
        _run(F.submit_feedback(body, authorization=None, x_reading_anon="wrong"))
    assert e.value.status_code == 403


def test_post_no_credentials_401(monkeypatch):
    db = _DB(attempt=_ANON_READING_ATTEMPT)
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="rating", skill="reading", attempt_id="att-A", rating_de=4)
    with pytest.raises(HTTPException) as e:
        _run(F.submit_feedback(body, authorization=None, x_reading_anon=None))
    assert e.value.status_code == 401


def test_post_foreign_attempt_403(monkeypatch):
    _as_user(monkeypatch, uid="U2")  # caller U2, attempt owned by U1
    db = _DB(attempt=_AUTHED_LISTENING_ATTEMPT)
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="rating", skill="listening", attempt_id="att-L", rating_de=5)
    with pytest.raises(HTTPException) as e:
        _run(F.submit_feedback(body, authorization="x", x_reading_anon=None))
    assert e.value.status_code == 403


# ── POST: validation + anti-spam ──────────────────────────────────────────────

def test_post_double_rating_409(monkeypatch):
    _as_user(monkeypatch)
    db = _DB(attempt=_AUTHED_LISTENING_ATTEMPT, existing_rating=True)
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="rating", skill="listening", attempt_id="att-L", rating_de=5)
    with pytest.raises(HTTPException) as e:
        _run(F.submit_feedback(body, authorization="x", x_reading_anon=None))
    assert e.value.status_code == 409


def test_post_reading_rating_audio_rejected_422(monkeypatch):
    _as_user(monkeypatch)
    db = _DB(attempt=_AUTHED_READING_ATTEMPT)
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="rating", skill="reading", attempt_id="att-R",
                        rating_de=5, rating_audio=4)
    with pytest.raises(HTTPException) as e:
        _run(F.submit_feedback(body, authorization="x", x_reading_anon=None))
    assert e.value.status_code == 422


def test_post_rating_out_of_range_422(monkeypatch):
    _as_user(monkeypatch)
    db = _DB(attempt=_AUTHED_LISTENING_ATTEMPT)
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="rating", skill="listening", attempt_id="att-L", rating_de=9)
    with pytest.raises(HTTPException) as e:
        _run(F.submit_feedback(body, authorization="x", x_reading_anon=None))
    assert e.value.status_code == 422


def test_post_flag_without_qnum_422(monkeypatch):
    _as_user(monkeypatch)
    db = _DB(attempt=_AUTHED_LISTENING_ATTEMPT)
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="flag", skill="listening", attempt_id="att-L")
    with pytest.raises(HTTPException) as e:
        _run(F.submit_feedback(body, authorization="x", x_reading_anon=None))
    assert e.value.status_code == 422


def test_post_bad_type_422(monkeypatch):
    _as_user(monkeypatch)
    monkeypatch.setattr(F, "supabase_admin", _DB(attempt=_AUTHED_LISTENING_ATTEMPT))
    body = F.FeedbackIn(type="bogus", skill="listening", attempt_id="att-L", rating_de=5)
    with pytest.raises(HTTPException) as e:
        _run(F.submit_feedback(body, authorization="x", x_reading_anon=None))
    assert e.value.status_code == 422


# ── GET admin list: filter + group-by-test + guard ────────────────────────────

_FEEDBACK_ROWS = [
    {"id": "f1", "skill": "listening", "type": "rating", "status": "new",
     "test_id": "ILR-LIS-01", "rating_de": 5, "created_at": "2026-06-13T03:00:00Z"},
    {"id": "f2", "skill": "listening", "type": "flag", "status": "new",
     "test_id": "ILR-LIS-01", "q_num": 3, "created_at": "2026-06-13T02:00:00Z"},
    {"id": "f3", "skill": "listening", "type": "report", "status": "resolved",
     "test_id": "ILR-LIS-02", "category": "typo", "created_at": "2026-06-13T01:00:00Z"},
]


def test_admin_list_groups_by_test(monkeypatch):
    _as_admin(monkeypatch)
    monkeypatch.setattr(F, "supabase_admin", _DB(feedback_rows=_FEEDBACK_ROWS))
    out = _run(F.admin_list_feedback(skill=None, type=None, status=None, test_id=None,
                                     authorization="x"))
    assert out["count"] == 3
    groups = {g["test_id"]: g for g in out["groups"]}
    assert set(groups) == {"ILR-LIS-01", "ILR-LIS-02"}
    assert len(groups["ILR-LIS-01"]["items"]) == 2
    assert groups["ILR-LIS-01"]["new_count"] == 2      # f1 + f2 are new
    assert groups["ILR-LIS-02"]["new_count"] == 0      # f3 resolved


def test_admin_list_bad_filter_422(monkeypatch):
    _as_admin(monkeypatch)
    monkeypatch.setattr(F, "supabase_admin", _DB(feedback_rows=[]))
    with pytest.raises(HTTPException) as e:
        _run(F.admin_list_feedback(skill="speaking", type=None, status=None, test_id=None,
                                   authorization="x"))
    assert e.value.status_code == 422


def test_admin_list_requires_admin(monkeypatch):
    _deny_admin(monkeypatch)
    monkeypatch.setattr(F, "supabase_admin", _DB(feedback_rows=[]))
    with pytest.raises(HTTPException) as e:
        _run(F.admin_list_feedback(skill=None, type=None, status=None, test_id=None,
                                   authorization="x"))
    assert e.value.status_code == 403


# ── PATCH status + guard ──────────────────────────────────────────────────────

def test_patch_status_resolved_then_new(monkeypatch):
    _as_admin(monkeypatch, aid="A9")
    db = _DB(update_found=True)
    monkeypatch.setattr(F, "supabase_admin", db)
    out = _run(F.admin_patch_feedback_status("f1", F.StatusIn(status="resolved"), authorization="x"))
    assert out["status"] == "resolved"
    _, patch = db.updated[0]
    assert patch["status"] == "resolved" and patch["resolved_by"] == "A9"
    assert patch["resolved_at"] is not None
    # back to new clears resolution
    _run(F.admin_patch_feedback_status("f1", F.StatusIn(status="new"), authorization="x"))
    _, patch2 = db.updated[1]
    assert patch2["status"] == "new" and patch2["resolved_by"] is None and patch2["resolved_at"] is None


def test_patch_unknown_id_404(monkeypatch):
    _as_admin(monkeypatch)
    monkeypatch.setattr(F, "supabase_admin", _DB(update_found=False))
    with pytest.raises(HTTPException) as e:
        _run(F.admin_patch_feedback_status("nope", F.StatusIn(status="resolved"), authorization="x"))
    assert e.value.status_code == 404


def test_patch_bad_status_422(monkeypatch):
    _as_admin(monkeypatch)
    monkeypatch.setattr(F, "supabase_admin", _DB())
    with pytest.raises(HTTPException) as e:
        _run(F.admin_patch_feedback_status("f1", F.StatusIn(status="bogus"), authorization="x"))
    assert e.value.status_code == 422


def test_patch_requires_admin(monkeypatch):
    _deny_admin(monkeypatch)
    monkeypatch.setattr(F, "supabase_admin", _DB())
    with pytest.raises(HTTPException) as e:
        _run(F.admin_patch_feedback_status("f1", F.StatusIn(status="resolved"), authorization="x"))
    assert e.value.status_code == 403
