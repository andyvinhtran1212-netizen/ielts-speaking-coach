"""Tests for the admin grade-quality rating endpoints (migration 116).

  POST /admin/writing/essays/{id}/grade-rating
  GET  /admin/writing/grade-ratings/summary

TestClient + patched require_admin + a tiny table-aware supabase fake.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from services import essay_service

_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN = {"id": "00000000-0000-0000-0000-0000000000aa", "email": "admin@x"}
_ESSAY_ID = "00000000-0000-0000-0000-000000000002"


def _client() -> TestClient:
    from main import app
    return TestClient(app)


class _FakeSupa:
    """Branches on table name. feedback_run backs writing_feedback_current
    (version + model_used of the run being rated); essay_row backs the
    writing_essays snapshot read; upserts land in `captured`; rating_rows back
    the summary/read select."""
    def __init__(self, feedback_run=None, essay_row=None, rating_rows=None):
        self.feedback_run = feedback_run
        self.essay_row = essay_row
        self.rating_rows = rating_rows or []
        self.captured: dict = {}

    def table(self, name):
        return _FakeBuilder(self, name)


class _FakeBuilder:
    def __init__(self, parent, name):
        self.p = parent; self.name = name; self._action = None; self._payload = None

    def select(self, *_a, **_kw): self._action = "select"; return self
    def upsert(self, payload, *_a, **_kw): self._action = "upsert"; self._payload = payload; return self
    def eq(self, *_a, **_kw): return self
    def limit(self, *_a, **_kw): return self

    def execute(self):
        class _R: pass
        r = _R(); r.data = []
        if self.name == "writing_feedback_current" and self._action == "select":
            r.data = [self.p.feedback_run] if self.p.feedback_run else []
        elif self.name == "writing_essays" and self._action == "select":
            r.data = [self.p.essay_row] if self.p.essay_row else []
        elif self.name == "writing_grade_ratings" and self._action == "upsert":
            self.p.captured["payload"] = self._payload
            r.data = [self._payload]
        elif self.name == "writing_grade_ratings" and self._action == "select":
            r.data = self.p.rating_rows
        return r


def test_rate_grade_snapshots_actual_model_and_run_version():
    """Snapshots the run's model_used (the ACTUAL grader, which for Deep can
    differ from the requested selected_model) + the feedback_version being
    rated — not writing_essays.selected_model."""
    fake = _FakeSupa(
        feedback_run={"version": 2, "model_used": "gemini-2.5-pro"},   # Deep ran on Pro
        essay_row={"analysis_level": 4, "grading_tier": "deep",
                   "selected_model": "gemini-3.5-flash"},             # requested ≠ actual
    )
    with patch("routers.admin_writing.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("services.essay_service.supabase_admin", fake):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/grade-rating",
            json={"rating": 4, "note": "Band hợp lý"},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200, r.text
    p = fake.captured["payload"]
    assert p["rating"] == 4
    assert p["grading_model"] == "gemini-2.5-pro"   # model_used, NOT selected_model
    assert p["feedback_version"] == 2               # keyed to the graded run
    assert p["analysis_level"] == 4
    assert p["rated_by"] == _ADMIN["id"]


def test_rate_grade_409_when_not_graded():
    """An essay with no current feedback run can't be quality-rated → 409."""
    fake = _FakeSupa(feedback_run=None, essay_row={"analysis_level": 3})
    with patch("routers.admin_writing.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("services.essay_service.supabase_admin", fake):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/grade-rating",
            json={"rating": 4}, headers=_ADMIN_AUTH,
        )
    assert r.status_code == 409, r.text


def test_rate_grade_rejects_out_of_range():
    """rating bounded 1–5 → 6 is a 422 before any DB work."""
    with patch("routers.admin_writing.require_admin", new=AsyncMock(return_value=_ADMIN)):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/grade-rating",
            json={"rating": 6}, headers=_ADMIN_AUTH,
        )
    assert r.status_code == 422


def test_rate_grade_requires_auth():
    r = _client().post(f"/admin/writing/essays/{_ESSAY_ID}/grade-rating", json={"rating": 3})
    assert r.status_code in (401, 403)


def test_get_grade_rating_scoped_to_current_version():
    """get_grade_rating resolves the current run's version and only returns a
    rating for THAT version — a stale rating for an older version is hidden
    (regrade safety). Here no rating row exists for the current version → None."""
    fake = _FakeSupa(
        feedback_run={"version": 2, "model_used": "gemini-2.5-pro"},
        rating_rows=[],
    )
    with patch("services.essay_service.supabase_admin", fake):
        out = essay_service.get_grade_rating(_ESSAY_ID)   # resolves current version = 2
    assert out is None


def test_grade_rating_summary_aggregates_by_model():
    """summary() groups ratings by model with count + avg — the upgrade view."""
    fake = _FakeSupa(rating_rows=[
        {"grading_model": "gemini-3.5-flash", "rating": 4},
        {"grading_model": "gemini-3.5-flash", "rating": 5},
        {"grading_model": "gemini-2.5-pro", "rating": 3},
    ])
    with patch("services.essay_service.supabase_admin", fake):
        out = essay_service.grade_rating_summary()
    by = {row["grading_model"]: row for row in out}
    assert by["gemini-3.5-flash"]["n"] == 2
    assert by["gemini-3.5-flash"]["avg_rating"] == 4.5
    assert by["gemini-2.5-pro"]["avg_rating"] == 3.0
