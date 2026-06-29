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
    """Branches on table name. essay_row backs the writing_essays snapshot read;
    upsert payloads land in `captured`; rating_rows back the summary select."""
    def __init__(self, essay_row=None, rating_rows=None):
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
        if self.name == "writing_essays" and self._action == "select":
            r.data = [self.p.essay_row] if self.p.essay_row else []
        elif self.name == "writing_grade_ratings" and self._action == "upsert":
            self.p.captured["payload"] = self._payload
            r.data = [self._payload]
        elif self.name == "writing_grade_ratings" and self._action == "select":
            r.data = self.p.rating_rows
        return r


def test_rate_grade_upserts_with_model_snapshot():
    """POST persists the rating + snapshots the model/level/tier that graded
    the essay, attributed to the admin."""
    fake = _FakeSupa(essay_row={
        "selected_model": "gemini-3.5-flash", "analysis_level": 3, "grading_tier": "standard",
    })
    with patch("routers.admin_writing.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("services.essay_service.supabase_admin", fake):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/grade-rating",
            json={"rating": 4, "note": "Band hợp lý, lỗi bắt tốt"},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200, r.text
    p = fake.captured["payload"]
    assert p["rating"] == 4
    assert p["note"] == "Band hợp lý, lỗi bắt tốt"
    assert p["grading_model"] == "gemini-3.5-flash"   # snapshot from the essay
    assert p["analysis_level"] == 3
    assert p["rated_by"] == _ADMIN["id"]


def test_rate_grade_rejects_out_of_range():
    """rating bounded 1–5 → 6 is a 422 before any DB write."""
    with patch("routers.admin_writing.require_admin", new=AsyncMock(return_value=_ADMIN)):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/grade-rating",
            json={"rating": 6}, headers=_ADMIN_AUTH,
        )
    assert r.status_code == 422


def test_rate_grade_requires_auth():
    r = _client().post(f"/admin/writing/essays/{_ESSAY_ID}/grade-rating", json={"rating": 3})
    assert r.status_code in (401, 403)


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
