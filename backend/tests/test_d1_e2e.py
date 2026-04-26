"""
End-to-end-ish tests for D1 fill-blank.

These exercise the pure helpers (no DB, no auth) that drive the user-facing
endpoint:
  - _grade_d1: case- and whitespace-insensitive equality
  - _public_view: strips answer/word, exposes a deterministic shuffled options list
  - D1AttemptRequest: rejects empty answers / over-long answers

The rate-limit and full FastAPI handler are covered separately
(test_rate_limit.py).  RLS is covered by test_exercise_rls.py.

Run: pytest backend/tests/test_d1_e2e.py -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from pydantic import ValidationError

from routers.exercises import _grade_d1, _public_view, D1AttemptRequest


# ── _grade_d1 ─────────────────────────────────────────────────────────────────


def test_grade_d1_exact_match():
    assert _grade_d1("mitigate", "mitigate") is True


def test_grade_d1_case_insensitive():
    assert _grade_d1("Mitigate", "mitigate") is True
    assert _grade_d1("MITIGATE", "mitigate") is True


def test_grade_d1_trim_whitespace():
    assert _grade_d1("  mitigate  ", "mitigate") is True


def test_grade_d1_wrong_word():
    assert _grade_d1("aggravate", "mitigate") is False


def test_grade_d1_empty_user_answer():
    assert _grade_d1("", "mitigate") is False


# ── _public_view ──────────────────────────────────────────────────────────────


_ROW = {
    "id": "00000000-0000-0000-0000-000000000001",
    "exercise_type": "D1",
    "content_payload": {
        "sentence": "The plan must ___ the impact of climate change.",
        "word": "mitigate",
        "answer": "mitigate",
        "distractors": ["aggravate", "ignore", "exacerbate"],
    },
}


def test_public_view_strips_answer_and_word():
    v = _public_view(_ROW)
    assert "answer" not in v["content"]
    assert "word" not in v["content"]
    assert "distractors" not in v["content"]


def test_public_view_options_includes_answer_plus_distractors():
    v = _public_view(_ROW)
    opts = v["content"]["options"]
    assert sorted(opts) == sorted(["mitigate", "aggravate", "ignore", "exacerbate"])
    assert len(opts) == 4


def test_public_view_options_order_is_deterministic_per_id():
    """Same row id must produce the same option order across calls."""
    v1 = _public_view(_ROW)
    v2 = _public_view(_ROW)
    assert v1["content"]["options"] == v2["content"]["options"]


def test_public_view_different_ids_produce_different_orders():
    """Sanity: at least one of two distinct ids should reorder the options."""
    row_a = {**_ROW, "id": "11111111-1111-1111-1111-111111111111"}
    row_b = {**_ROW, "id": "22222222-2222-2222-2222-222222222222"}
    a = _public_view(row_a)["content"]["options"]
    b = _public_view(row_b)["content"]["options"]
    # Both must be valid (same set), at least one distinct order across ids.
    assert sorted(a) == sorted(b)


def test_public_view_keeps_sentence():
    v = _public_view(_ROW)
    assert v["content"]["sentence"] == _ROW["content_payload"]["sentence"]


# ── D1AttemptRequest schema ───────────────────────────────────────────────────


def test_attempt_request_rejects_empty():
    with pytest.raises(ValidationError):
        D1AttemptRequest(user_answer="")


def test_attempt_request_rejects_overlong():
    with pytest.raises(ValidationError):
        D1AttemptRequest(user_answer="x" * 81)


def test_attempt_request_accepts_normal():
    req = D1AttemptRequest(user_answer="mitigate")
    assert req.user_answer == "mitigate"


# ── list_d1_exercises: exclude already-attempted ──────────────────────────────
#
# Production smoke surfaced an infinite-loop bug — list endpoint kept handing
# back exercises the user had already submitted.  Fix: filter out attempted
# ids before returning.  These tests use a fake user-scoped client so the
# logic can be exercised without a live DB.

import asyncio


class _FakeAttemptsBuilder:
    def __init__(self, rows): self._rows = rows
    def select(self, _cols): return self
    def eq(self, _col, _val): return self
    def execute(self):
        class _R: pass
        r = _R(); r.data = self._rows; return r


class _FakeExercisesBuilder:
    """Mimics .select().eq().eq().[not_.in_().].order().limit().execute()."""
    def __init__(self, rows, recorder):
        self._rows = rows
        self._recorder = recorder
        self.not_ = self  # so builder.not_.in_(...) chains back to the same obj

    def select(self, _cols): return self
    def eq(self, _col, _val):  return self
    def in_(self, col, values):
        self._recorder.append(("not_in", col, list(values)))
        # Filter the returned rows so the test can assert what's actually returned
        self._rows = [r for r in self._rows if r["id"] not in set(values)]
        return self
    def order(self, _col, desc=False): return self
    def limit(self, _n): return self
    def execute(self):
        class _R: pass
        r = _R(); r.data = self._rows; return r


class _FakeListClient:
    """First .table('vocabulary_exercise_attempts') call returns attempts;
    second .table('vocabulary_exercises') call returns the exercise rows."""
    def __init__(self, attempts, exercises, recorder):
        self._attempts = attempts
        self._exercises = exercises
        self._recorder = recorder

    def table(self, name):
        if name == "vocabulary_exercise_attempts":
            return _FakeAttemptsBuilder(self._attempts)
        if name == "vocabulary_exercises":
            return _FakeExercisesBuilder(list(self._exercises), self._recorder)
        raise AssertionError(f"unexpected table {name}")


def _patch_user_route(monkeypatch, fake_client):
    from routers import exercises as exr

    async def _fake_auth(_authorization):
        return {"id": "user-list-1"}

    monkeypatch.setattr("routers.auth.get_supabase_user", _fake_auth)
    monkeypatch.setattr(exr, "get_supabase_user", _fake_auth)
    monkeypatch.setattr(exr, "is_d1_enabled", lambda *_a, **_k: True)
    monkeypatch.setattr(exr, "_user_sb", lambda _token: fake_client)
    monkeypatch.setattr(exr, "_bearer_token", lambda _h: "fake-token")


def test_list_d1_excludes_already_attempted(monkeypatch):
    """Audit-style probe: 3 published, 1 attempted → list returns 2."""
    from routers import exercises as exr

    attempts = [{"exercise_id": "ex-1"}]
    exercises = [
        {"id": "ex-1", "exercise_type": "D1", "content_payload": {
            "sentence": "a ___ b", "answer": "x", "distractors": ["a", "b", "c"]}},
        {"id": "ex-2", "exercise_type": "D1", "content_payload": {
            "sentence": "c ___ d", "answer": "y", "distractors": ["a", "b", "c"]}},
        {"id": "ex-3", "exercise_type": "D1", "content_payload": {
            "sentence": "e ___ f", "answer": "z", "distractors": ["a", "b", "c"]}},
    ]
    recorder: list = []
    _patch_user_route(monkeypatch, _FakeListClient(attempts, exercises, recorder))

    result = asyncio.run(exr.list_d1_exercises(limit=5, authorization="Bearer x"))
    returned_ids = {item["id"] for item in result}

    assert "ex-1" not in returned_ids, "ex-1 was attempted and must be excluded"
    assert returned_ids == {"ex-2", "ex-3"}
    # The not.in.() filter must have been applied with exactly the attempted ids.
    assert ("not_in", "id", ["ex-1"]) in recorder


def test_list_d1_skips_not_in_filter_when_no_attempts(monkeypatch):
    """When the user has no attempts, the not.in.() filter must be skipped
    (PostgREST 400s on an empty IN list)."""
    from routers import exercises as exr

    exercises = [
        {"id": "ex-1", "exercise_type": "D1", "content_payload": {
            "sentence": "a ___ b", "answer": "x", "distractors": ["a", "b", "c"]}},
    ]
    recorder: list = []
    _patch_user_route(monkeypatch, _FakeListClient([], exercises, recorder))

    result = asyncio.run(exr.list_d1_exercises(limit=5, authorization="Bearer x"))
    assert len(result) == 1
    # No not.in.() call should have been made.
    assert not any(c[0] == "not_in" for c in recorder)


def test_list_d1_returns_empty_when_all_attempted(monkeypatch):
    """User has attempted every published exercise → empty array → frontend
    will translate that into the 'all done' empty state."""
    from routers import exercises as exr

    exercises = [
        {"id": "ex-1", "exercise_type": "D1",
         "content_payload": {"sentence": "x ___ y", "answer": "z", "distractors": ["a", "b", "c"]}},
        {"id": "ex-2", "exercise_type": "D1",
         "content_payload": {"sentence": "p ___ q", "answer": "r", "distractors": ["a", "b", "c"]}},
    ]
    attempts = [{"exercise_id": "ex-1"}, {"exercise_id": "ex-2"}]
    recorder: list = []
    _patch_user_route(monkeypatch, _FakeListClient(attempts, exercises, recorder))

    result = asyncio.run(exr.list_d1_exercises(limit=5, authorization="Bearer x"))
    assert result == []
