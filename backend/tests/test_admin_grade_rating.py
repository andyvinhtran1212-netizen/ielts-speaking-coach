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
    the summary/read select and are filtered by the `.eq()` calls. Every
    executed query is recorded in `calls` with its filters and on_conflict."""
    def __init__(self, feedback_run=None, essay_row=None, rating_rows=None):
        self.feedback_run = feedback_run
        self.essay_row = essay_row
        self.rating_rows = rating_rows or []
        self.captured: dict = {}
        self.calls: list[dict] = []

    def table(self, name):
        return _FakeBuilder(self, name)

    def queries(self, table, action):
        return [c for c in self.calls if c["table"] == table and c["action"] == action]


class _FakeBuilder:
    def __init__(self, parent, name):
        self.p = parent; self.name = name; self._action = None; self._payload = None
        self._eq: list[tuple] = []; self._on_conflict = None

    def select(self, *_a, **_kw): self._action = "select"; return self
    def upsert(self, payload, *_a, on_conflict=None, **_kw):
        self._action = "upsert"; self._payload = payload; self._on_conflict = on_conflict; return self
    def eq(self, column, value): self._eq.append((column, value)); return self
    def limit(self, *_a, **_kw): return self

    def execute(self):
        self.p.calls.append({"table": self.name, "action": self._action,
                             "eq": list(self._eq), "on_conflict": self._on_conflict})
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
            r.data = [row for row in self.p.rating_rows
                      if all(column in row and row[column] == value for column, value in self._eq)]
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
    assert p["essay_id"] == _ESSAY_ID
    assert [sorted(c["eq"]) for c in fake.queries("writing_feedback_current", "select")] == [
        [("essay_id", _ESSAY_ID)]]
    assert [sorted(c["eq"]) for c in fake.queries("writing_essays", "select")] == [[("id", _ESSAY_ID)]]
    assert [c["on_conflict"] for c in fake.queries("writing_grade_ratings", "upsert")] == [
        "essay_id,feedback_version"]


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


def _rating(essay_id, version, rating):
    return {"essay_id": essay_id, "feedback_version": version, "rating": rating,
            "grading_model": "gemini-2.5-pro"}


_OTHER_ESSAY_ID = "00000000-0000-0000-0000-000000000003"


def test_get_grade_rating_scoped_to_current_version():
    """get_grade_rating resolves the current run's version and only returns a
    rating for THAT version — a stale rating for an older version is hidden
    (regrade safety). The stored rows hold this essay's v1 rating and another
    essay's v2 rating, but nothing for (this essay, v2) → None."""
    fake = _FakeSupa(
        feedback_run={"version": 2, "model_used": "gemini-2.5-pro"},
        rating_rows=[_rating(_ESSAY_ID, 1, 5), _rating(_OTHER_ESSAY_ID, 2, 1)],
    )
    with patch("services.essay_service.supabase_admin", fake):
        out = essay_service.get_grade_rating(_ESSAY_ID)   # resolves current version = 2
    assert out is None
    assert [sorted(c["eq"]) for c in fake.queries("writing_feedback_current", "select")] == [
        [("essay_id", _ESSAY_ID)]]
    assert [sorted(c["eq"]) for c in fake.queries("writing_grade_ratings", "select")] == [
        [("essay_id", _ESSAY_ID), ("feedback_version", 2)]]


def test_get_grade_rating_returns_the_current_versions_row_and_not_a_wrong_version():
    """Control for the test above: with a (this essay, v2) row present it is
    returned; asking for a version that has no row returns None even though
    the essay has ratings for other versions."""
    rows = [_rating(_ESSAY_ID, 1, 5), _rating(_ESSAY_ID, 2, 3), _rating(_OTHER_ESSAY_ID, 3, 1)]
    fake = _FakeSupa(feedback_run={"version": 2, "model_used": "gemini-2.5-pro"}, rating_rows=rows)
    with patch("services.essay_service.supabase_admin", fake):
        current = essay_service.get_grade_rating(_ESSAY_ID)
        wrong = essay_service.get_grade_rating(_ESSAY_ID, 3)
    assert current == _rating(_ESSAY_ID, 2, 3)
    assert wrong is None
    assert [sorted(c["eq"]) for c in fake.queries("writing_grade_ratings", "select")] == [
        [("essay_id", _ESSAY_ID), ("feedback_version", 2)],
        [("essay_id", _ESSAY_ID), ("feedback_version", 3)]]


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
