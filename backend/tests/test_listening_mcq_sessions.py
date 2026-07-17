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
# Audit 2026-07-17: nguồn = listening_test_attempts (bảng listening_attempts
# cũ đã chết); by_mode = theo test_type (mini/drill/full), avg_score = % đúng.


def _iso_days_ago(n):
    return (datetime.now(timezone.utc) - timedelta(days=n)).isoformat()


def _tests_canned():
    return [
        {"id": "t-mini", "test_id": "ILR-LIS-LSN-L01", "title": "Lesson 01", "test_type": "mini"},
        {"id": "t-drill", "test_id": "ILR-LIS-DRL-01", "title": "Drill 01", "test_type": "drill"},
        {"id": "t-full", "test_id": "C19-T1", "title": "Cam 19 Test 1", "test_type": "full"},
    ]


def _att(i, test="t-mini", *, status="submitted", score=8, total=10, days_ago=1.0, user="user-1"):
    return {
        "id": f"att-{i}", "user_id": user, "test_id": test, "status": status,
        "score": (score if status == "submitted" else None),
        "grading_details": ([{"q_num": q + 1} for q in range(total)]
                            if status == "submitted" else []),
        "created_at": _iso_days_ago(days_ago),
        "submitted_at": (_iso_days_ago(days_ago) if status == "submitted" else None),
    }


def test_analytics_by_type_aggregation(monkeypatch):
    canned = {
        "listening_test_attempts": [
            _att(1, "t-mini", score=8, days_ago=1),      # 0.8
            _att(2, "t-drill", score=5, days_ago=2),     # 0.5
        ],
        "listening_tests": _tests_canned(),
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.get_listening_analytics(time_range="30d", authorization=authz))
    assert out["total_attempts"] == 2
    assert out["by_mode"]["mini"] == {"count": 1, "avg_score": 0.8, "completion": 1.0}
    assert out["by_mode"]["drill"]["avg_score"] == 0.5
    assert out["by_mode"]["full"] == {"count": 0, "avg_score": None, "completion": None}


def test_analytics_first_attempt_rule_per_test(monkeypatch):
    """Retry không được kéo avg: lượt đầu 1.0, retry 0.0 → avg = 1.0; nhưng
    total_attempts + recent vẫn đếm mọi lượt (engagement/timeline)."""
    canned = {
        "listening_test_attempts": [
            _att(1, "t-mini", score=10, days_ago=2),
            _att(2, "t-mini", score=0, days_ago=1),      # retry
        ],
        "listening_tests": _tests_canned(),
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.get_listening_analytics(time_range="30d", authorization=authz))
    assert out["total_attempts"] == 2
    assert out["by_mode"]["mini"]["count"] == 1
    assert out["by_mode"]["mini"]["avg_score"] == 1.0
    assert len(out["recent_attempts"]) == 2


def test_analytics_completion_counts_abandoned(monkeypatch):
    """46/418 lượt prod là bỏ dở — completion phải lộ tín hiệu này."""
    canned = {
        "listening_test_attempts": [
            _att(1, "t-drill", status="submitted", score=9, days_ago=1),
            _att(2, "t-drill", status="abandoned", days_ago=2),
        ],
        "listening_tests": _tests_canned(),
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.get_listening_analytics(time_range="30d", authorization=authz))
    assert out["by_mode"]["drill"]["completion"] == 0.5
    # lượt bỏ dở không kéo avg_score (không có accuracy)
    assert out["by_mode"]["drill"]["avg_score"] == 0.9


def test_analytics_weakest_mode_requires_3_submitted(monkeypatch):
    """Loại chỉ 2 lượt nộp (điểm thấp) KHÔNG được gắn 'yếu nhất' —
    non-misleading rule; loại đủ 3 lượt là candidate duy nhất."""
    canned = {
        "listening_test_attempts": [
            # 3 bài mini khác nhau, điểm cao
            {**_att(i, "t-mini", score=9, days_ago=i + 1), "test_id": f"t-mini-{i}"}
            for i in range(3)
        ] + [
            {**_att(10 + i, "t-drill", score=1, days_ago=i + 1), "test_id": f"t-drill-{i}"}
            for i in range(2)
        ],
        "listening_tests": _tests_canned() + [
            {"id": f"t-mini-{i}", "test_id": f"M{i}", "title": f"M{i}", "test_type": "mini"}
            for i in range(3)
        ] + [
            {"id": f"t-drill-{i}", "test_id": f"D{i}", "title": f"D{i}", "test_type": "drill"}
            for i in range(2)
        ],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.get_listening_analytics(time_range="30d", authorization=authz))
    assert out["weakest_mode"] == "mini"


def test_analytics_recent_attempts_capped_at_10(monkeypatch):
    canned = {
        "listening_test_attempts": [
            _att(i, "t-mini", score=5, days_ago=i / 10) for i in range(15)
        ],
        "listening_tests": _tests_canned(),
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.get_listening_analytics(time_range="30d", authorization=authz))
    assert len(out["recent_attempts"]) == 10
    r0 = out["recent_attempts"][0]
    assert r0["type"] == "mini" and r0["title"] == "Lesson 01"
    assert r0["accuracy"] == 0.5 and r0["total_questions"] == 10


def test_analytics_rejects_bad_range(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient({}))
    authz = _patch_user(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.get_listening_analytics(time_range="3d", authorization=authz))
    assert exc.value.status_code == 422


def test_analytics_empty_user(monkeypatch):
    """User 0 lượt → shape rỗng hợp lệ, không lỗi (non-misleading)."""
    _patch_admin_client(monkeypatch, _FakeAdminClient({"listening_test_attempts": []}))
    authz = _patch_user(monkeypatch)
    out = _run(listening_router.get_listening_analytics(time_range="30d", authorization=authz))
    assert out["total_attempts"] == 0
    assert out["weakest_mode"] is None
    assert set(out["by_mode"]) == {"mini", "drill", "full"}
    assert out["by_mode"]["mini"]["count"] == 0
    assert len(out["by_day"]) == 14
