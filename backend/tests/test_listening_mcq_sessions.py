"""Sprint 11.5 — pin MCQ + session + browse + analytics contracts
(DEBT-LISTENING-MODULE 5/5 cluster closure).

Coverage:
  1. listening_grader.grade_mcq pure helper (exact, partial, missing,
     malformed indices).
  2. Admin _validate_mcq_payload (range, contiguous idx, 4 options, range).
  3. POST /api/listening/attempts mcq dispatch (happy + 404).
  4. Admin POST /admin/listening/sessions (validates draft exclusion,
     unknown exercise_ids, lineup persists in order).
  5. User GET /api/listening/sessions/{id} (mini_test only, exercises
     populated in exercise_ids order).
  6. POST /api/listening/sessions/{id}/complete (aggregates score +
     band estimate).
  7. GET /api/listening/content with filters.
  8. GET /api/listening/analytics — by_mode aggregation + weakest-mode
     ≥3-attempt rule + recent_attempts shape.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from routers import listening as listening_router
from services import listening_grader


# ── grade_mcq unit tests ─────────────────────────────────────────────


def _qs():
    return [
        {"idx": 0, "stem": "Q1", "options": ["a", "b", "c", "d"], "answer_idx": 2},
        {"idx": 1, "stem": "Q2", "options": ["a", "b", "c", "d"], "answer_idx": 0},
        {"idx": 2, "stem": "Q3", "options": ["a", "b", "c", "d"], "answer_idx": 3},
    ]


def test_mcq_all_correct():
    out = listening_grader.grade_mcq(questions=_qs(), user_answers=[2, 0, 3])
    assert out["score"] == 1.0
    assert out["is_correct"] is True
    assert out["correct"] == 3
    assert all(d["is_correct"] for d in out["details"])


def test_mcq_partial():
    out = listening_grader.grade_mcq(questions=_qs(), user_answers=[2, 1, 3])
    assert out["correct"] == 2
    assert out["total"] == 3
    assert abs(out["score"] - 2 / 3) < 0.001
    assert out["is_correct"] is False


def test_mcq_missing_answers_count_wrong():
    out = listening_grader.grade_mcq(questions=_qs(), user_answers=[2])
    assert out["correct"] == 1
    assert out["details"][1]["actual_idx"] is None
    assert out["details"][1]["is_correct"] is False


def test_mcq_malformed_actual_safe():
    out = listening_grader.grade_mcq(
        questions=_qs(),
        user_answers=["not-an-int", None, 3],  # type: ignore[list-item]
    )
    assert out["details"][0]["actual_idx"] is None
    assert out["details"][1]["actual_idx"] is None
    assert out["details"][2]["actual_idx"] == 3
    assert out["correct"] == 1


def test_mcq_empty_questions_safe():
    out = listening_grader.grade_mcq(questions=[], user_answers=[])
    assert out == {"score": 0.0, "correct": 0, "total": 0,
                   "is_correct": False, "details": []}


# ── _validate_mcq_payload (admin upsert) ─────────────────────────────


def test_mcq_payload_validator_happy():
    out = listening_router._validate_mcq_payload({
        "questions": [
            {"idx": 0, "stem": "Q1", "options": ["a", "b", "c", "d"], "answer_idx": 2},
            {"idx": 1, "stem": "Q2", "options": ["A", "B", "C", "D"], "answer_idx": 0},
        ],
    })
    assert len(out["questions"]) == 2
    assert out["questions"][0]["answer_idx"] == 2


def test_mcq_payload_validator_rejects_non_contiguous_idx():
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_mcq_payload({
            "questions": [
                {"idx": 0, "stem": "Q1", "options": ["a", "b", "c", "d"], "answer_idx": 0},
                {"idx": 5, "stem": "Q2", "options": ["a", "b", "c", "d"], "answer_idx": 0},
            ],
        })
    assert exc.value.status_code == 422


def test_mcq_payload_validator_rejects_too_few_options():
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_mcq_payload({
            "questions": [
                {"idx": 0, "stem": "Q1", "options": ["a", "b", "c"], "answer_idx": 0},
            ],
        })
    assert exc.value.status_code == 422
    assert "4 options" in str(exc.value.detail)


def test_mcq_payload_validator_rejects_answer_idx_out_of_range():
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_mcq_payload({
            "questions": [
                {"idx": 0, "stem": "Q", "options": ["a", "b", "c", "d"], "answer_idx": 4},
            ],
        })
    assert exc.value.status_code == 422
    assert "0-3" in str(exc.value.detail)


def test_mcq_payload_validator_rejects_empty_stem():
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_mcq_payload({
            "questions": [
                {"idx": 0, "stem": "  ", "options": ["a", "b", "c", "d"], "answer_idx": 0},
            ],
        })
    assert exc.value.status_code == 422
    assert "stem" in str(exc.value.detail)


def test_mcq_payload_validator_rejects_too_many_questions():
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_mcq_payload({
            "questions": [
                {"idx": i, "stem": f"Q{i}", "options": ["a", "b", "c", "d"], "answer_idx": 0}
                for i in range(21)
            ],
        })
    assert exc.value.status_code == 422
    assert "1-20" in str(exc.value.detail)


# ── Fake admin client (extended for Sprint 11.5 endpoints) ───────────


class _FakeRes:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _FakeTableQuery:
    def __init__(self, parent, table):
        self._parent = parent
        self._table = table
        self._filters: list[tuple[str, str, object]] = []
        self._range: tuple[int, int] | None = None
        self._order_by: list[tuple[str, bool]] = []
        self._insert: dict | None = None
        self._update: dict | None = None
        self._select_cols: str = "*"

    def select(self, cols="*", **_k):
        self._select_cols = cols
        return self

    def limit(self, *_a, **_k): return self

    def order(self, col, desc=False):
        self._order_by.append((col, desc))
        return self

    def range(self, lo, hi):
        self._range = (lo, hi)
        return self

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def gte(self, col, val):
        self._filters.append(("gte", col, val))
        return self

    def in_(self, col, vals):
        self._filters.append(("in", col, list(vals)))
        return self

    def insert(self, payload):
        self._insert = payload
        self._parent.inserts.append((self._table, payload))
        return self

    def update(self, payload):
        self._update = payload
        self._parent.updates.append((self._table, list(self._filters), payload))
        return self

    def execute(self):
        if self._insert is not None:
            return _FakeRes([self._insert])
        if self._update is not None:
            return _FakeRes([self._update])
        rows = list(self._parent.canned.get(self._table, []))
        for op, col, val in self._filters:
            if op == "eq":
                rows = [r for r in rows if r.get(col) == val]
            elif op == "gte":
                rows = [r for r in rows if str(r.get(col, "")) >= str(val)]
            elif op == "in":
                rows = [r for r in rows if r.get(col) in val]
        # Apply order (descending sort).
        for col, desc in reversed(self._order_by):
            rows.sort(key=lambda r: r.get(col) or "", reverse=desc)
        count = len(rows)
        if self._range is not None:
            lo, hi = self._range
            rows = rows[lo: hi + 1]
        return _FakeRes(rows, count=count)


class _FakeStorageBucket:
    def __init__(self, parent, bucket):
        self._parent = parent
        self._bucket = bucket

    def create_signed_url(self, path, ttl):
        return {"signedURL": f"https://test/{self._bucket}/{path}"}


class _FakeStorage:
    def __init__(self, parent): self._parent = parent
    def from_(self, b): return _FakeStorageBucket(self._parent, b)


class _FakeAdminClient:
    def __init__(self, canned=None):
        self.canned = canned or {}
        self.inserts: list[tuple] = []
        self.updates: list[tuple] = []
        self.storage = _FakeStorage(self)

    def table(self, name):
        return _FakeTableQuery(self, name)


def _patch_user(monkeypatch, user_id="user-1"):
    async def _f(_): return {"id": user_id}
    monkeypatch.setattr(listening_router, "get_supabase_user", _f)
    return "Bearer fake-user"


def _patch_admin(monkeypatch, admin_id="admin-1"):
    async def _f(_): return {"id": admin_id, "role": "admin"}
    monkeypatch.setattr(listening_router, "require_admin", _f)
    return "Bearer fake-admin"


def _patch_admin_client(monkeypatch, fake):
    monkeypatch.setattr(listening_router, "supabase_admin", fake)


def _run(c): return asyncio.run(c)


# ── POST /api/listening/attempts mcq dispatch ────────────────────────


def test_attempt_mcq_happy_path(monkeypatch):
    canned = {
        "listening_content": [{
            "id": "c1", "status": "published", "transcript": "...",
            "audio_storage_path": "ai/c1.mp3", "audio_duration_seconds": 200,
        }],
        "listening_exercises": [{
            "id": "ex-mcq",
            "content_id": "c1",
            "exercise_type": "mcq",
            "status": "published",
            "payload": {"questions": _qs()},
        }],
        "listening_attempts": [],
    }
    fake = _FakeAdminClient(canned)
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_user(monkeypatch)

    body = listening_router.ListeningAttemptRequest(
        exercise_id="ex-mcq", mode="mcq", mcq_answers=[2, 0, 3],
    )
    out = _run(listening_router.post_listening_attempt(body=body, authorization=authz))
    assert out["mode"] == "mcq"
    assert out["score"] == 1.0
    assert out["correct"] == 3
    assert out["is_first_attempt"] is True
    # Security — `expected_idx` NOT in client-facing details.
    for d in out["details"]:
        assert "expected_idx" not in d
        assert "actual_idx" in d


def test_attempt_mcq_missing_exercise_404(monkeypatch):
    canned = {
        "listening_content": [{"id": "c1", "status": "published", "transcript": "x",
                                "audio_storage_path": "p", "audio_duration_seconds": 60}],
        "listening_exercises": [],
        "listening_attempts": [],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    body = listening_router.ListeningAttemptRequest(
        content_id="c1", mode="mcq", mcq_answers=[0],
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.post_listening_attempt(body=body, authorization=authz))
    assert exc.value.status_code == 404


def test_attempt_mcq_requires_answers(monkeypatch):
    canned = {
        "listening_content": [{"id": "c1", "status": "published", "transcript": "x",
                                "audio_storage_path": "p", "audio_duration_seconds": 60}],
        "listening_exercises": [{
            "id": "ex-mcq", "content_id": "c1", "exercise_type": "mcq",
            "status": "published", "payload": {"questions": _qs()},
        }],
        "listening_attempts": [],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    body = listening_router.ListeningAttemptRequest(
        exercise_id="ex-mcq", mode="mcq", mcq_answers=[],
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.post_listening_attempt(body=body, authorization=authz))
    assert exc.value.status_code == 422


# ── Admin session create ─────────────────────────────────────────────


def test_admin_session_create_happy(monkeypatch):
    canned = {
        "listening_exercises": [
            {"id": "e1", "status": "published", "content_id": "c1"},
            {"id": "e2", "status": "published", "content_id": "c2"},
        ],
        "listening_sessions": [],
    }
    fake = _FakeAdminClient(canned)
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin(monkeypatch)

    body = listening_router.ListeningSessionUpsertRequest(
        title="MT1",
        exercise_ids=["e1", "e2"],
        ordered_position=[{"exercise_id": "e1", "section": 1}, {"exercise_id": "e2", "section": 2}],
    )
    out = _run(listening_router.admin_create_listening_session(body=body, authorization=authz))
    assert out["ok"] is True
    assert out["created"] is True
    # Inserted row has session_type=mini_test + exercise_ids in body order.
    inserted = fake.inserts[0][1]
    assert inserted["session_type"] == "mini_test"
    assert inserted["exercise_ids"] == ["e1", "e2"]
    assert inserted["total_questions"] == 2


def test_admin_session_create_rejects_draft_exercise(monkeypatch):
    canned = {
        "listening_exercises": [
            {"id": "e1", "status": "published", "content_id": "c1"},
            {"id": "e2", "status": "draft",     "content_id": "c2"},  # draft
        ],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_admin(monkeypatch)
    body = listening_router.ListeningSessionUpsertRequest(
        title="MT1", exercise_ids=["e1", "e2"],
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_create_listening_session(body=body, authorization=authz))
    assert exc.value.status_code == 422
    assert "draft" in str(exc.value.detail).lower() or "publish" in str(exc.value.detail).lower()


def test_admin_session_create_rejects_unknown_exercise(monkeypatch):
    canned = {
        "listening_exercises": [
            {"id": "e1", "status": "published", "content_id": "c1"},
        ],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_admin(monkeypatch)
    body = listening_router.ListeningSessionUpsertRequest(
        title="MT1", exercise_ids=["e1", "ghost"],
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_create_listening_session(body=body, authorization=authz))
    assert exc.value.status_code == 422
    assert "not found" in str(exc.value.detail).lower()


def test_admin_session_create_rejects_empty_lineup(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient({}))
    authz = _patch_admin(monkeypatch)
    body = listening_router.ListeningSessionUpsertRequest(
        title="MT1", exercise_ids=[],
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_create_listening_session(body=body, authorization=authz))
    assert exc.value.status_code == 422


# ── User GET session ─────────────────────────────────────────────────


def test_user_get_session_returns_exercises_in_order(monkeypatch):
    canned = {
        "listening_sessions": [{
            "id": "s1", "session_type": "mini_test",
            "exercise_ids": ["e2", "e1"],  # ordering
            "user_id": "admin-1", "total_questions": 2,
        }],
        "listening_exercises": [
            {"id": "e1", "status": "published", "content_id": "c1", "exercise_type": "gist"},
            {"id": "e2", "status": "published", "content_id": "c2", "exercise_type": "mcq"},
        ],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.get_listening_session(session_id="s1", authorization=authz))
    assert [e["id"] for e in out["exercises"]] == ["e2", "e1"]


def test_user_get_session_rejects_non_mini_test(monkeypatch):
    canned = {
        "listening_sessions": [{
            "id": "s1", "session_type": "free_practice", "exercise_ids": [],
            "user_id": "u1",
        }],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.get_listening_session(session_id="s1", authorization=authz))
    assert exc.value.status_code == 404


# ── User session complete ────────────────────────────────────────────


def test_session_complete_band_estimate(monkeypatch):
    canned = {
        "listening_sessions": [{
            "id": "s1", "session_type": "mini_test", "exercise_ids": ["e1", "e2", "e3", "e4"],
            "total_questions": 4,
        }],
        "listening_attempts": [
            {"exercise_id": "e1", "user_id": "user-1", "listening_session_id": "s1",
             "score": 1.0, "is_correct": True},
            {"exercise_id": "e2", "user_id": "user-1", "listening_session_id": "s1",
             "score": 1.0, "is_correct": True},
            {"exercise_id": "e3", "user_id": "user-1", "listening_session_id": "s1",
             "score": 1.0, "is_correct": True},
            {"exercise_id": "e4", "user_id": "user-1", "listening_session_id": "s1",
             "score": 0.0, "is_correct": False},
        ],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.complete_listening_session(session_id="s1", authorization=authz))
    assert out["correct_count"] == 3
    assert out["total"] == 4
    # 75% → 6.5 per _band_from_correct table.
    assert out["band_estimate"] == 6.5


def test_session_complete_404_unknown_session(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient({"listening_sessions": []}))
    authz = _patch_user(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.complete_listening_session(session_id="ghost", authorization=authz))
    assert exc.value.status_code == 404


def test_band_from_correct_table():
    assert listening_router._band_from_correct(10, 10) == 8.5
    assert listening_router._band_from_correct(8, 10) == 7.5
    assert listening_router._band_from_correct(7, 10) == 6.5
    assert listening_router._band_from_correct(6, 10) == 6.0
    assert listening_router._band_from_correct(5, 10) == 5.5
    assert listening_router._band_from_correct(4, 10) == 5.0
    assert listening_router._band_from_correct(0, 10) == 4.5
    assert listening_router._band_from_correct(0, 0) == 0.0


# ── GET /api/listening/content browse ────────────────────────────────


def test_browse_filters_by_section(monkeypatch):
    canned = {
        "listening_content": [
            {"id": "c1", "status": "published", "title": "T1",
             "accent_tag": "us_general", "cefr_level": "B2", "ielts_section": 1,
             "topic_tags": [], "audio_duration_seconds": 180,
             "is_premium": False, "created_at": "2026-05-10T00:00:00Z"},
            {"id": "c2", "status": "published", "title": "T2",
             "accent_tag": "uk_rp", "cefr_level": "C1", "ielts_section": 4,
             "topic_tags": [], "audio_duration_seconds": 220,
             "is_premium": False, "created_at": "2026-05-12T00:00:00Z"},
            {"id": "c3", "status": "draft", "title": "T3",
             "accent_tag": "us_general", "cefr_level": "B2", "ielts_section": 1,
             "topic_tags": [], "audio_duration_seconds": 100,
             "is_premium": False, "created_at": "2026-05-13T00:00:00Z"},
        ],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.list_listening_content(
        accent_tag=None, cefr_level=None, ielts_section=4,
        limit=20, offset=0, authorization=authz,
    ))
    assert len(out["items"]) == 1
    assert out["items"][0]["id"] == "c2"


def test_browse_excludes_drafts(monkeypatch):
    canned = {
        "listening_content": [
            {"id": "c1", "status": "draft", "title": "T1",
             "accent_tag": "us_general", "cefr_level": "B2",
             "ielts_section": 1, "topic_tags": [],
             "audio_duration_seconds": 100, "is_premium": False,
             "created_at": "2026-05-10T00:00:00Z"},
        ],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.list_listening_content(
        accent_tag=None, cefr_level=None, ielts_section=None,
        limit=20, offset=0, authorization=authz,
    ))
    assert len(out["items"]) == 0


def test_browse_rejects_bad_accent(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient({}))
    authz = _patch_user(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.list_listening_content(
            accent_tag="klingon", cefr_level=None, ielts_section=None,
            limit=20, offset=0, authorization=authz,
        ))
    assert exc.value.status_code == 422


# ── GET /api/listening/analytics ─────────────────────────────────────


def _iso_days_ago(n):
    return (datetime.now(timezone.utc) - timedelta(days=n)).isoformat()


def test_analytics_by_mode_aggregation(monkeypatch):
    U = "user-1"
    canned = {
        "listening_attempts": [
            {"id": "a1", "user_id": U, "exercise_id": "ex-d", "score": 1.0, "is_correct": True,  "created_at": _iso_days_ago(1)},
            {"id": "a2", "user_id": U, "exercise_id": "ex-d", "score": 0.5, "is_correct": False, "created_at": _iso_days_ago(2)},
            {"id": "a3", "user_id": U, "exercise_id": "ex-d", "score": 0.8, "is_correct": False, "created_at": _iso_days_ago(3)},
            {"id": "a4", "user_id": U, "exercise_id": "ex-m", "score": 1.0, "is_correct": True,  "created_at": _iso_days_ago(1)},
            {"id": "a5", "user_id": U, "exercise_id": "ex-m", "score": 0.4, "is_correct": False, "created_at": _iso_days_ago(2)},
            {"id": "a6", "user_id": U, "exercise_id": "ex-m", "score": 0.6, "is_correct": False, "created_at": _iso_days_ago(3)},
        ],
        "listening_exercises": [
            {"id": "ex-d", "exercise_type": "dictation"},
            {"id": "ex-m", "exercise_type": "mcq"},
        ],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.get_listening_analytics(time_range="30d", authorization=authz))
    assert out["total_attempts"] == 6
    assert out["by_mode"]["dictation"]["count"] == 3
    assert out["by_mode"]["mcq"]["count"] == 3
    # gist/true_false → 0 attempts each, avg_score None.
    assert out["by_mode"]["gist"]["count"] == 0
    assert out["by_mode"]["gist"]["avg_score"] is None


def test_analytics_weakest_mode_requires_3_attempts(monkeypatch):
    # 2 mcq attempts (insufficient) + 5 dictation attempts; mcq score
    # is lower but should NOT be returned as weakest (insufficient data).
    U = "user-1"
    canned = {
        "listening_attempts": [
            {"id": f"a-d-{i}", "user_id": U, "exercise_id": "ex-d", "score": 0.95, "is_correct": True,
             "created_at": _iso_days_ago(i + 1)}
            for i in range(5)
        ] + [
            {"id": "a-m-1", "user_id": U, "exercise_id": "ex-m", "score": 0.1, "is_correct": False, "created_at": _iso_days_ago(1)},
            {"id": "a-m-2", "user_id": U, "exercise_id": "ex-m", "score": 0.2, "is_correct": False, "created_at": _iso_days_ago(2)},
        ],
        "listening_exercises": [
            {"id": "ex-d", "exercise_type": "dictation"},
            {"id": "ex-m", "exercise_type": "mcq"},
        ],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.get_listening_analytics(time_range="30d", authorization=authz))
    # Only dictation qualifies (5 ≥ 3) — but it's the only mode, so it IS
    # the weakest (and the only candidate).
    assert out["weakest_mode"] == "dictation"


def test_analytics_recent_attempts_capped_at_10(monkeypatch):
    rows = [
        {"id": f"a{i}", "user_id": "user-1", "exercise_id": "ex-d", "score": 0.5,
         "is_correct": False, "created_at": _iso_days_ago(i)}
        for i in range(15)
    ]
    canned = {
        "listening_attempts": rows,
        "listening_exercises": [{"id": "ex-d", "exercise_type": "dictation"}],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.get_listening_analytics(time_range="30d", authorization=authz))
    assert len(out["recent_attempts"]) == 10


def test_analytics_rejects_bad_range(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient({}))
    authz = _patch_user(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.get_listening_analytics(time_range="3d", authorization=authz))
    assert exc.value.status_code == 422


def test_analytics_empty_user(monkeypatch):
    """A user with zero attempts gets a valid empty-shape response, not
    an error (CLAUDE.md non-misleading: 'insufficient data' not
    'no data error')."""
    _patch_admin_client(monkeypatch, _FakeAdminClient({"listening_attempts": []}))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.get_listening_analytics(time_range="30d", authorization=authz))
    assert out["total_attempts"] == 0
    assert out["weakest_mode"] is None
    assert out["by_mode"]["dictation"]["count"] == 0
    assert len(out["by_day"]) == 14
