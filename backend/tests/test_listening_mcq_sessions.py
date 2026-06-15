"""Sprint 11.5 — pin MCQ + browse + analytics contracts
(DEBT-LISTENING-MODULE 5/5 cluster closure).

The Mini-Test session-mixer (admin /sessions composer + user session
runner/complete) was repurposed away — the "Mini Test" slot is now a
graded 1-section listening test served via /api/listening/tests?test_type
=mini. Its endpoints + the _band_from_correct helper were removed, so the
session tests that pinned them are gone too. The _first_attempt_only
helper survives (shared with analytics) and is still covered below.

Coverage:
  1. listening_grader.grade_mcq pure helper (exact, partial, missing,
     malformed indices).
  2. Admin _validate_mcq_payload (range, contiguous idx, 4 options, range).
  3. POST /api/listening/attempts mcq dispatch (happy + 404).
  4. GET /api/listening/content with filters.
  5. GET /api/listening/analytics — by_mode aggregation + weakest-mode
     ≥3-attempt rule + recent_attempts shape.
  6. _first_attempt_only dedupe helper (shared by analytics).
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
    """Sprint 11.5.1 hotfix — 3 distinct exercises per mode, no retries,
    so by_mode counts = 3 (post-dedup)."""
    U = "user-1"
    canned = {
        "listening_attempts": [
            {"id": "a1", "user_id": U, "exercise_id": "ex-d1", "score": 1.0, "is_correct": True,  "created_at": _iso_days_ago(1)},
            {"id": "a2", "user_id": U, "exercise_id": "ex-d2", "score": 0.5, "is_correct": False, "created_at": _iso_days_ago(2)},
            {"id": "a3", "user_id": U, "exercise_id": "ex-d3", "score": 0.8, "is_correct": False, "created_at": _iso_days_ago(3)},
            {"id": "a4", "user_id": U, "exercise_id": "ex-m1", "score": 1.0, "is_correct": True,  "created_at": _iso_days_ago(1)},
            {"id": "a5", "user_id": U, "exercise_id": "ex-m2", "score": 0.4, "is_correct": False, "created_at": _iso_days_ago(2)},
            {"id": "a6", "user_id": U, "exercise_id": "ex-m3", "score": 0.6, "is_correct": False, "created_at": _iso_days_ago(3)},
        ],
        "listening_exercises": [
            {"id": "ex-d1", "exercise_type": "dictation"},
            {"id": "ex-d2", "exercise_type": "dictation"},
            {"id": "ex-d3", "exercise_type": "dictation"},
            {"id": "ex-m1", "exercise_type": "mcq"},
            {"id": "ex-m2", "exercise_type": "mcq"},
            {"id": "ex-m3", "exercise_type": "mcq"},
        ],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.get_listening_analytics(time_range="30d", authorization=authz))
    assert out["total_attempts"] == 6     # raw count of all attempts (engagement)
    assert out["by_mode"]["dictation"]["count"] == 3   # first-attempt-only
    assert out["by_mode"]["mcq"]["count"] == 3
    # gist/true_false → 0 attempts each, avg_score None.
    assert out["by_mode"]["gist"]["count"] == 0
    assert out["by_mode"]["gist"]["avg_score"] is None


def test_analytics_weakest_mode_requires_3_attempts(monkeypatch):
    """Sprint 11.5.1 hotfix — 2 distinct mcq exercises (insufficient) +
    5 distinct dictation exercises; mcq score is lower but should NOT
    be returned as weakest (insufficient data after first-attempt dedup)."""
    U = "user-1"
    canned = {
        "listening_attempts": [
            {"id": f"a-d-{i}", "user_id": U, "exercise_id": f"ex-d-{i}", "score": 0.95, "is_correct": True,
             "created_at": _iso_days_ago(i + 1)}
            for i in range(5)
        ] + [
            {"id": "a-m-1", "user_id": U, "exercise_id": "ex-m-1", "score": 0.1, "is_correct": False, "created_at": _iso_days_ago(1)},
            {"id": "a-m-2", "user_id": U, "exercise_id": "ex-m-2", "score": 0.2, "is_correct": False, "created_at": _iso_days_ago(2)},
        ],
        "listening_exercises": [
            {"id": f"ex-d-{i}", "exercise_type": "dictation"} for i in range(5)
        ] + [
            {"id": "ex-m-1", "exercise_type": "mcq"},
            {"id": "ex-m-2", "exercise_type": "mcq"},
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


# ── Sprint 11.5.1 hotfix — first-attempt aggregation ─────────────────


def test_first_attempt_helper_dedupes_by_exercise_segment():
    """Pure helper unit test — dedupes by (exercise_id, segment_idx)
    keeping earliest created_at per key."""
    rows = [
        {"exercise_id": "e1", "segment_idx": 0, "score": 1.0, "created_at": "2026-05-10T00:00:00Z"},
        {"exercise_id": "e1", "segment_idx": 0, "score": 0.5, "created_at": "2026-05-11T00:00:00Z"},  # retry, drop
        {"exercise_id": "e1", "segment_idx": 1, "score": 0.8, "created_at": "2026-05-10T00:01:00Z"},  # different segment, keep
        {"exercise_id": "e2", "segment_idx": None, "score": 0.6, "created_at": "2026-05-10T00:02:00Z"},
        {"exercise_id": "e2", "segment_idx": None, "score": 0.4, "created_at": "2026-05-10T00:03:00Z"},  # retry, drop
    ]
    out = listening_router._first_attempt_only(rows)
    assert len(out) == 3
    scores = sorted(r["score"] for r in out)
    assert scores == [0.6, 0.8, 1.0]  # the 3 first attempts


def test_analytics_avg_score_uses_first_attempt_only(monkeypatch):
    """Retries should NOT distort by_mode.avg_score. First attempt =
    1.0, retry = 0.0 → reported avg should be 1.0, not 0.5."""
    U = "user-1"
    canned = {
        "listening_attempts": [
            {"id": "first",  "user_id": U, "exercise_id": "ex-d1", "score": 1.0, "is_correct": True,
             "created_at": _iso_days_ago(2)},
            {"id": "retry", "user_id": U, "exercise_id": "ex-d1", "score": 0.0, "is_correct": False,
             "created_at": _iso_days_ago(1)},
        ],
        "listening_exercises": [{"id": "ex-d1", "exercise_type": "dictation"}],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.get_listening_analytics(time_range="30d", authorization=authz))
    assert out["total_attempts"] == 2   # raw count for activity
    assert out["by_mode"]["dictation"]["count"] == 1   # post-dedup
    assert out["by_mode"]["dictation"]["avg_score"] == 1.0
    assert out["by_mode"]["dictation"]["accuracy"] == 1.0


def test_analytics_total_attempts_counts_all(monkeypatch):
    """total_attempts must reflect raw activity (engagement), not
    post-dedup count."""
    U = "user-1"
    canned = {
        "listening_attempts": [
            {"id": f"a{i}", "user_id": U, "exercise_id": "ex-d1", "score": 0.5, "is_correct": False,
             "created_at": _iso_days_ago(i)}
            for i in range(5)
        ],
        "listening_exercises": [{"id": "ex-d1", "exercise_type": "dictation"}],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.get_listening_analytics(time_range="30d", authorization=authz))
    assert out["total_attempts"] == 5            # all 5 attempts (engagement)
    assert out["by_mode"]["dictation"]["count"] == 1  # only first attempt


def test_analytics_weakest_mode_respects_first_attempt(monkeypatch):
    """Mode with many retries on a single exercise should NOT cross the
    3-attempt weakest-mode threshold."""
    U = "user-1"
    canned = {
        "listening_attempts": [
            # 5 retries of ONE mcq exercise → 1 unique attempt
            {"id": f"a-m-{i}", "user_id": U, "exercise_id": "ex-m-1", "score": 0.1, "is_correct": False,
             "created_at": _iso_days_ago(i + 1)}
            for i in range(5)
        ] + [
            # 3 distinct dictation exercises
            {"id": f"a-d-{i}", "user_id": U, "exercise_id": f"ex-d-{i}", "score": 0.9, "is_correct": True,
             "created_at": _iso_days_ago(i + 1)}
            for i in range(3)
        ],
        "listening_exercises": [
            {"id": "ex-m-1", "exercise_type": "mcq"},
        ] + [{"id": f"ex-d-{i}", "exercise_type": "dictation"} for i in range(3)],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.get_listening_analytics(time_range="30d", authorization=authz))
    # mcq only has 1 post-dedup attempt → does NOT qualify for weakest
    # (despite low score). Dictation has 3 → qualifies and IS reported.
    assert out["weakest_mode"] == "dictation"
    assert out["by_mode"]["mcq"]["count"] == 1


def test_analytics_recent_attempts_unaffected_by_dedup(monkeypatch):
    """recent_attempts list reflects raw activity, not post-dedup
    (so users see their actual recent timeline including retries)."""
    rows = [
        {"id": f"a{i}", "user_id": "user-1", "exercise_id": "ex-d1",
         "score": 0.5, "is_correct": False, "created_at": _iso_days_ago(i)}
        for i in range(8)
    ]
    canned = {
        "listening_attempts": rows,
        "listening_exercises": [{"id": "ex-d1", "exercise_type": "dictation"}],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.get_listening_analytics(time_range="30d", authorization=authz))
    assert len(out["recent_attempts"]) == 8


def test_first_attempt_helper_handles_missing_segment_idx():
    """Backward compat — rows from pre-Sprint-11.3 (no segment_idx)
    treat the field as None and dedupe per exercise_id."""
    rows = [
        {"exercise_id": "e1", "score": 1.0, "created_at": "2026-05-10T00:00:00Z"},
        {"exercise_id": "e1", "score": 0.0, "created_at": "2026-05-11T00:00:00Z"},  # retry, drop
    ]
    out = listening_router._first_attempt_only(rows)
    assert len(out) == 1
    assert out[0]["score"] == 1.0
