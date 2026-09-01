"""tests/test_feedback.py — Feedback foundation (PR-1).

POST /api/feedback (rating | report | flag; authed + reading-anon; double-rating
409; ownership), GET /api/admin/feedback (filter + group-by-test, require_admin),
PATCH /api/admin/feedback/{id} (status, require_admin). DB mocked.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi import HTTPException

from routers import feedback as F


_MIGRATION_199 = Path(__file__).parents[1] / "migrations" / "199_user_feedback_vocabulary.sql"


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
        self._filters = {}; self._payload = None; self._limit = None
    def select(self, *a, **k): self._op = "select"; return self
    def insert(self, row, *a, **k): self._op = "insert"; self._payload = row; return self
    def update(self, patch, *a, **k): self._op = "update"; self._payload = patch; return self
    def eq(self, col, val): self._filters[col] = val; return self
    def lte(self, col, val): self._filters[f"{col}__lte"] = val; return self
    def or_(self, value): self._filters["__cursor"] = value; return self
    def in_(self, col, vals): self._filters[col] = tuple(vals); return self
    def order(self, *a, **k): return self
    def limit(self, value, *a, **k): self._limit = value; return self
    def execute(self): return self._db.handle(self._t, self._op, self._filters, self._payload, self._limit)


class _StuckQ(_Q):
    def or_(self, _value): return self


class _DB:
    def __init__(self, attempt=None, test_id="ILR-X", existing_rating=False,
                 feedback_rows=None, update_found=True,
                 passage_exists=False, content_exists=False,
                 server_cap=None, fail_feedback_select_after=None):
        self._attempt = attempt
        self._test_id = test_id
        self._existing = existing_rating
        self._feedback_rows = feedback_rows or []
        self._update_found = update_found
        self._passage_exists = passage_exists
        self._content_exists = content_exists
        self._server_cap = server_cap
        self._fail_feedback_select_after = fail_feedback_select_after
        self._feedback_selects = 0
        self.inserted = []
        self.updated = []
    def table(self, n): return _Q(self, n)
    def handle(self, table, op, filters, payload, limit=None):
        if table in ("reading_test_attempts", "listening_test_attempts"):
            return _R([self._attempt] if self._attempt else [])
        if table in ("reading_tests", "listening_tests"):
            return _R([{"test_id": self._test_id}] if self._test_id else [])
        if table == "reading_passages":
            return _R([{"id": "p-uuid"}] if self._passage_exists else [])
        if table == "listening_content":
            return _R([{"id": filters.get("id")}] if self._content_exists else [])
        if table == "user_feedback":
            if op == "insert":
                if payload.get("anonymous_dedupe_key") and any(
                    row.get("anonymous_dedupe_key") == payload["anonymous_dedupe_key"]
                    for row in self.inserted
                ):
                    raise RuntimeError(
                        'duplicate key value violates unique constraint '
                        '"uq_feedback_anon_vocab_daily"'
                    )
                self.inserted.append(payload); return _R([payload])
            if op == "update":
                self.updated.append((dict(filters), dict(payload)))
                return _R([{"id": filters.get("id")}] if self._update_found else [])
            # select: rating pre-check (attempt_id + type=rating) vs admin list
            if "attempt_id" in filters and filters.get("type") == "rating":
                return _R([{"id": "existing"}] if self._existing else [])
            self._feedback_selects += 1
            if (
                self._fail_feedback_select_after is not None
                and self._feedback_selects > self._fail_feedback_select_after
            ):
                raise RuntimeError("feedback page unavailable")
            rows = list(self._feedback_rows)
            for key in ("skill", "type", "status", "test_id"):
                if key in filters:
                    rows = [row for row in rows if row.get(key) == filters[key]]
            upper = filters.get("created_at__lte")
            if upper is not None:
                rows = [row for row in rows if not row.get("created_at") or row.get("created_at") <= upper]
            cursor = filters.get("__cursor")
            if cursor:
                prefix = "created_at.lt."
                middle = ",and(created_at.eq."
                suffix = ",id.lt."
                first, rest = cursor[len(prefix):].split(middle, 1)
                second, raw_id = rest[:-1].split(suffix, 1)
                assert first == second
                rows = [row for row in rows if (
                    row.get("created_at", "") < first
                    or (row.get("created_at", "") == first and str(row.get("id", "")) < raw_id)
                )]
            rows.sort(key=lambda row: (row.get("created_at", ""), str(row.get("id", ""))), reverse=True)
            effective_limit = limit
            if self._server_cap is not None:
                effective_limit = min(effective_limit, self._server_cap) if effective_limit is not None else self._server_cap
            return _R(rows[:effective_limit] if effective_limit is not None else rows)
        return _R([])


class _NonAdvancingDB(_DB):
    def table(self, n): return _StuckQ(self, n)


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
     "test_id": "ILR-LIS-01", "rating_de": 5, "created_by": "U1",
     "created_at": "2026-06-13T03:00:00Z"},
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
    assert out["data_status"] == "complete"
    assert out["truncated"] is False
    assert out["malformed_count"] == 0
    assert all(row["anon_id"] in (None, "redacted") for row in out["items"])
    assert "secret-tok" not in str(out)
    assert "created_by" not in out["items"][0]
    assert out["items"][0]["identity_kind"] == "user"


def test_admin_list_does_not_merge_same_test_id_across_skills(monkeypatch):
    _as_admin(monkeypatch)
    rows = [
        {"id": "r1", "skill": "reading", "type": "report", "status": "new",
         "test_id": "SHARED-01", "created_at": "2026-06-13T03:00:00Z"},
        {"id": "l1", "skill": "listening", "type": "flag", "status": "new",
         "test_id": "SHARED-01", "created_at": "2026-06-13T02:00:00Z"},
    ]
    monkeypatch.setattr(F, "supabase_admin", _DB(feedback_rows=rows))
    out = _run(F.admin_list_feedback(skill=None, type=None, status=None, test_id=None,
                                     authorization="x"))
    assert [(g["skill"], g["test_id"]) for g in out["groups"]] == [
        ("reading", "SHARED-01"), ("listening", "SHARED-01")
    ]


def test_admin_list_pages_past_postgrest_cap(monkeypatch):
    _as_admin(monkeypatch)
    monkeypatch.setattr(F, "FEEDBACK_PAGE", 2)
    rows = [
        {"id": f"f{i}", "skill": "reading", "type": "report", "status": "new",
         "test_id": "RD", "created_at": f"2026-06-13T0{5-i}:00:00Z"}
        for i in range(5)
    ]
    monkeypatch.setattr(F, "supabase_admin", _DB(feedback_rows=rows))
    out = _run(F.admin_list_feedback(skill=None, type=None, status=None, test_id=None,
                                     authorization="x"))
    assert out["data_status"] == "complete"
    assert out["count"] == 5
    assert [row["id"] for row in out["items"]] == ["f0", "f1", "f2", "f3", "f4"]


def test_admin_list_continues_when_server_caps_below_requested_page(monkeypatch):
    _as_admin(monkeypatch)
    rows = [
        {"id": f"f{i}", "skill": "reading", "type": "report", "status": "new",
         "test_id": "RD", "created_at": f"2026-06-13T0{5-i}:00:00Z"}
        for i in range(5)
    ]
    monkeypatch.setattr(F, "supabase_admin", _DB(feedback_rows=rows, server_cap=2))
    out = _run(F.admin_list_feedback(skill=None, type=None, status=None, test_id=None,
                                     authorization="x"))
    assert out["data_status"] == "complete"
    assert [row["id"] for row in out["items"]] == ["f0", "f1", "f2", "f3", "f4"]


def test_admin_list_reports_partial_when_later_page_fails(monkeypatch):
    _as_admin(monkeypatch)
    monkeypatch.setattr(F, "FEEDBACK_PAGE", 2)
    rows = [
        {"id": f"f{i}", "skill": "reading", "type": "report", "status": "new",
         "test_id": "RD", "created_at": f"2026-06-13T0{5-i}:00:00Z"}
        for i in range(5)
    ]
    monkeypatch.setattr(
        F,
        "supabase_admin",
        _DB(feedback_rows=rows, fail_feedback_select_after=1),
    )
    out = _run(F.admin_list_feedback(skill=None, type=None, status=None, test_id=None,
                                     authorization="x"))
    assert out["data_status"] == "partial"
    assert out["truncated"] is True
    assert out["count"] == 2


def test_admin_list_marks_safety_ceiling_as_partial(monkeypatch):
    _as_admin(monkeypatch)
    monkeypatch.setattr(F, "FEEDBACK_PAGE", 2)
    monkeypatch.setattr(F, "FEEDBACK_MAX_ROWS", 3)
    rows = [
        {"id": f"f{i}", "skill": "reading", "type": "report", "status": "new",
         "test_id": "RD", "created_at": f"2026-06-13T0{5-i}:00:00Z"}
        for i in range(5)
    ]
    monkeypatch.setattr(F, "supabase_admin", _DB(feedback_rows=rows))
    out = _run(F.admin_list_feedback(skill=None, type=None, status=None, test_id=None,
                                     authorization="x"))
    assert out["data_status"] == "partial"
    assert out["truncated"] is True
    assert out["count"] == 3


def test_admin_list_stops_when_pagination_cursor_does_not_advance(monkeypatch):
    _as_admin(monkeypatch)
    monkeypatch.setattr(F, "FEEDBACK_PAGE", 2)
    rows = [
        {"id": f"f{i}", "skill": "reading", "type": "report", "status": "new",
         "test_id": "RD", "created_at": f"2026-06-13T0{5-i}:00:00Z"}
        for i in range(5)
    ]
    monkeypatch.setattr(F, "supabase_admin", _NonAdvancingDB(feedback_rows=rows))
    out = _run(F.admin_list_feedback(skill=None, type=None, status=None, test_id=None,
                                     authorization="x"))
    assert out["data_status"] == "partial"
    assert out["truncated"] is True
    assert [row["id"] for row in out["items"]] == ["f0", "f1"]


def test_admin_list_query_failure_is_unavailable(monkeypatch):
    _as_admin(monkeypatch)
    class _Boom:
        def table(self, _name):
            raise RuntimeError("db unavailable")
    monkeypatch.setattr(F, "supabase_admin", _Boom())
    out = _run(F.admin_list_feedback(skill=None, type=None, status=None, test_id=None,
                                     authorization="x"))
    assert out["data_status"] == "unavailable"
    assert out["count"] is None
    assert out["items"] == []


def test_admin_list_skips_malformed_rows_without_inventing_zero(monkeypatch):
    _as_admin(monkeypatch)
    rows = [
        {"id": "good", "skill": "reading", "type": "report", "status": "new",
         "test_id": "RD", "created_at": "2026-06-13T03:00:00Z"},
        {"id": "bad", "skill": "speaking", "type": "report", "status": "new",
         "test_id": "SP", "created_at": "2026-06-13T02:00:00Z"},
        {"id": "bad-rating", "skill": "reading", "type": "rating", "status": "new",
         "rating_de": 9, "test_id": "RD", "created_at": "2026-06-13T01:00:00Z"},
    ]
    monkeypatch.setattr(F, "supabase_admin", _DB(feedback_rows=rows))
    out = _run(F.admin_list_feedback(skill=None, type=None, status=None, test_id=None,
                                     authorization="x"))
    assert out["count"] == 1
    assert out["malformed_count"] == 2
    assert [row["id"] for row in out["items"]] == ["good"]


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


# ── POST: practice / exercise-lẻ anchors (2026-07-17 audit extension) ─────────
# Không có attempt row → anchor = passage_slug (reading L1/L2 practice) hoặc
# content_id (listening standalone exercise). Yêu cầu đăng nhập; rating bị chặn.

_CID = "11111111-2222-3333-4444-555555555555"


def test_post_practice_flag_reading_slug(monkeypatch):
    _as_user(monkeypatch)
    db = _DB(passage_exists=True)
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="flag", skill="reading",
                        passage_slug="l2-skimming-headlines", q_num=2, note="đáp án sai")
    _run(F.submit_feedback(body, authorization="x", x_reading_anon=None))
    row = db.inserted[0]
    assert row["test_id"] == "practice:l2-skimming-headlines"
    assert row["attempt_id"] is None and row["q_num"] == 2
    assert row["created_by"] == "U1" and row["anon_id"] is None


def test_post_exercise_flag_listening_content_qnum_optional(monkeypatch):
    _as_user(monkeypatch)
    db = _DB(content_exists=True)
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="flag", skill="listening", content_id=_CID,
                        note="audio khác transcript")
    _run(F.submit_feedback(body, authorization="x", x_reading_anon=None))
    row = db.inserted[0]
    assert row["test_id"] == f"exercise:{_CID}"
    assert row["attempt_id"] is None and row["q_num"] is None


def test_post_practice_requires_auth_401(monkeypatch):
    async def _no(_a): raise HTTPException(401, "no")
    monkeypatch.setattr(F, "get_supabase_user", _no)
    db = _DB(passage_exists=True)
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="flag", skill="reading",
                        passage_slug="l1-tea-history", q_num=1)
    with pytest.raises(HTTPException) as e:
        _run(F.submit_feedback(body, authorization=None, x_reading_anon=None))
    assert e.value.status_code == 401


def test_post_practice_rating_rejected_422(monkeypatch):
    _as_user(monkeypatch)
    db = _DB(passage_exists=True)
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="rating", skill="reading",
                        passage_slug="l1-tea-history", rating_de=5)
    with pytest.raises(HTTPException) as e:
        _run(F.submit_feedback(body, authorization="x", x_reading_anon=None))
    assert e.value.status_code == 422


def test_post_practice_unknown_slug_404(monkeypatch):
    _as_user(monkeypatch)
    db = _DB(passage_exists=False)
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="flag", skill="reading",
                        passage_slug="khong-ton-tai", q_num=1)
    with pytest.raises(HTTPException) as e:
        _run(F.submit_feedback(body, authorization="x", x_reading_anon=None))
    assert e.value.status_code == 404


def test_post_exercise_bad_content_id_422(monkeypatch):
    _as_user(monkeypatch)
    db = _DB(content_exists=True)
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="flag", skill="listening", content_id="not-a-uuid")
    with pytest.raises(HTTPException) as e:
        _run(F.submit_feedback(body, authorization="x", x_reading_anon=None))
    assert e.value.status_code == 422


# ── POST: public Vocabulary Wiki reports ──────────────────────────────────────

def _visible_vocab_card(monkeypatch, exists=True):
    monkeypatch.setattr(
        F.vocab_service,
        "get_article",
        lambda category, slug: ({"category": category, "slug": slug} if exists else None),
    )


def test_post_vocabulary_audio_report_uses_visible_markdown_fallback(monkeypatch):
    # No vocab_cards row is present in the fake DB. The runtime service still
    # exposes the Markdown fallback card, matching GET /api/vocabulary/articles.
    from services.vocab_content import VocabContentService

    monkeypatch.setattr(VocabContentService, "_load_from_db", lambda _self: None)
    fallback_service = VocabContentService()
    visible = fallback_service.get_curated_articles()[0]
    monkeypatch.setattr(F, "vocab_service", fallback_service)
    db = _DB()
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="report", skill="vocabulary",
                        vocab_category=visible["category"], vocab_slug=visible["slug"],
                        category="audio_issue")
    out = _run(F.submit_feedback(body, authorization=None, x_reading_anon=None))
    assert out["status"] == "new"
    row = db.inserted[0]
    assert row["test_id"] == f"vocabulary:{visible['category']}/{visible['slug']}"
    assert row["type"] == "report" and row["skill"] == "vocabulary"
    assert row["category"] == "audio_issue"
    assert row["created_by"] is None and row["anon_id"] is None


def test_post_vocabulary_report_attributes_logged_in_user(monkeypatch):
    _as_user(monkeypatch)
    _visible_vocab_card(monkeypatch)
    db = _DB()
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="report", skill="vocabulary",
                        vocab_category="work", vocab_slug="career-path",
                        category="content_issue")
    _run(F.submit_feedback(body, authorization="x", x_reading_anon=None))
    assert db.inserted[0]["created_by"] == "U1"
    assert db.inserted[0]["anonymous_dedupe_key"] is None


def test_repeated_anonymous_vocabulary_report_is_rate_limited(monkeypatch):
    _visible_vocab_card(monkeypatch)
    db = _DB()
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="report", skill="vocabulary",
                        vocab_category="work", vocab_slug="career-path",
                        category="content_issue")

    first = _run(F.submit_feedback(body, authorization=None, x_reading_anon=None))
    assert first["status"] == "new"
    assert db.inserted[0]["anonymous_dedupe_key"].startswith(
        "vocabulary:work/career-path|content_issue|"
    )

    with pytest.raises(HTTPException) as exc:
        _run(F.submit_feedback(body, authorization=None, x_reading_anon=None))
    assert exc.value.status_code == 429
    assert exc.value.detail["error"] == "anonymous_feedback_rate_limited"
    assert len(db.inserted) == 1


def test_anonymous_vocabulary_note_only_report_uses_other_dedupe_bucket(monkeypatch):
    _visible_vocab_card(monkeypatch)
    db = _DB()
    monkeypatch.setattr(F, "supabase_admin", db)
    body = F.FeedbackIn(type="report", skill="vocabulary",
                        vocab_category="work", vocab_slug="career-path",
                        note="The example is unclear.")

    _run(F.submit_feedback(body, authorization=None, x_reading_anon=None))

    row = db.inserted[0]
    assert row["category"] == "other"
    assert row["anonymous_dedupe_key"].startswith(
        "vocabulary:work/career-path|other|"
    )


@pytest.mark.parametrize("field,value", [
    ("category", "x" * 65),
    ("note", "x" * 1001),
    ("vocab_category", "x" * 121),
    ("vocab_slug", "x" * 161),
])
def test_feedback_text_fields_have_input_caps(field, value):
    payload = {
        "type": "report", "skill": "vocabulary",
        "vocab_category": "work", "vocab_slug": "career-path",
        "category": "content_issue",
    }
    payload[field] = value
    with pytest.raises(Exception):
        F.FeedbackIn(**payload)


def test_vocabulary_category_is_allowlisted(monkeypatch):
    _visible_vocab_card(monkeypatch)
    monkeypatch.setattr(F, "supabase_admin", _DB())
    body = F.FeedbackIn(type="report", skill="vocabulary",
                        vocab_category="work", vocab_slug="career-path",
                        category="invent-a-new-bucket")
    with pytest.raises(HTTPException) as exc:
        _run(F.submit_feedback(body, authorization=None, x_reading_anon=None))
    assert exc.value.status_code == 422


def test_post_vocabulary_unknown_card_404(monkeypatch):
    _visible_vocab_card(monkeypatch, exists=False)
    monkeypatch.setattr(F, "supabase_admin", _DB())
    body = F.FeedbackIn(type="report", skill="vocabulary",
                        vocab_category="work", vocab_slug="missing",
                        category="content_issue")
    with pytest.raises(HTTPException) as e:
        _run(F.submit_feedback(body, authorization=None, x_reading_anon=None))
    assert e.value.status_code == 404


def test_post_vocabulary_rejects_non_report(monkeypatch):
    monkeypatch.setattr(F, "supabase_admin", _DB())
    body = F.FeedbackIn(type="flag", skill="vocabulary",
                        vocab_category="work", vocab_slug="career-path")
    with pytest.raises(HTTPException) as e:
        _run(F.submit_feedback(body, authorization=None, x_reading_anon=None))
    assert e.value.status_code == 422


def test_vocabulary_feedback_schema_and_historical_backfill_exist():
    sql = _MIGRATION_199.read_text(encoding="utf-8")
    assert "CHECK (skill IN ('reading', 'listening', 'vocabulary'))" in sql
    assert "ae.event_name = 'vocab_card_flagged'" in sql
    assert "ON CONFLICT (id) DO NOTHING" in sql
