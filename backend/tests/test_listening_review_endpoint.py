"""tests/test_listening_review_endpoint.py — listening-review-ui Phase B (backend).

GET /api/listening/tests/attempts/{id}/review — owner-only, submitted-gated
chữa-bài that joins grading_details with each question's audio replay window +
rich solution (from the imported exercise payloads), transcripts, and a signed
full-audio URL. Lesson 20 — assert the real joined VALUES.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from routers import listening as L


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


_ATTEMPT_SUBMITTED = {
    "id": "att-1", "test_id": "t-uuid", "user_id": "U1", "status": "submitted",
    "score": 32, "band_estimate": 7.0, "trap_analytics": {},
    "grading_details": [
        {"q_num": 1, "correct": True,  "user_answer": "Brighton", "expected": "Brighton"},
        {"q_num": 2, "correct": False, "user_answer": "x",        "expected": "BN1 6QR"},
    ],
}
_TEST_ROW = {
    "id": "t-uuid", "test_id": "ILR-LIS-001", "title": "Pilot 01", "band_target": 5.5,
    "cue_points": [{"type": "section", "section_num": 1, "timestamp_seconds": 31.22}],
    "full_audio_storage_path": "tests/t-uuid/full.mp3", "full_audio_duration_seconds": 1664,
    "metadata": {"section_offsets": {"S1": 31.22}, "band_conversion": [{"raw_min": 30, "raw_max": 31, "band": 7.0}]},
    "themes": {"s1": "Cookery"},
}
_CONTENT = [{"id": "c1", "section_num": 1, "title": "S1", "transcript": "…", "metadata": {"theme": "Cookery"}}]
_EXERCISES = [{"payload": {
    "variant": "form_completion",
    "questions": [{"q_num": 1, "prompt": "City:"}, {"q_num": 2, "prompt": "Postcode:"}],
    "audio_windows": {"1": {"start": 126.32, "end": 135.64, "section": "S1"},
                       "2": {"start": 135.82, "end": 151.34, "section": "S1"}},
    "solutions": {"1": {"answer": "Brighton", "translation_vi": "…", "skills": "K1, K2"},
                   "2": {"answer": "BN1 6QR"}},
}}]


class _Q:
    def __init__(self, db, table): self._db = db; self._t = table
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def execute(self): return type("R", (), {"data": self._db.get(self._t, [])})()


class _Signer:
    def from_(self, *a, **k): return self
    def create_signed_url(self, path, ttl): return {"signedURL": f"https://signed/{path}?t={ttl}"}


class _DB:
    def __init__(self, attempt):
        self._d = {
            "listening_test_attempts": [attempt],
            "listening_tests": [_TEST_ROW],
            "listening_content": _CONTENT,
            "listening_exercises": _EXERCISES,
        }
        self.storage = _Signer()
    def table(self, n): return _Q(self._d, n)


def _patch(monkeypatch, attempt):
    async def _ok(_a): return {"id": "U1", "email": "u@x"}
    monkeypatch.setattr(L, "_require_auth", _ok)
    monkeypatch.setattr(L, "supabase_admin", _DB(attempt))
    # _fetch_attempt_or_404 enforces owner internally; our stub returns the row.


def test_review_joins_window_and_solution_per_question(monkeypatch):
    _patch(monkeypatch, _ATTEMPT_SUBMITTED)
    out = _run(L.get_listening_test_attempt_review("att-1", authorization="x"))
    assert out["test_id"] == "ILR-LIS-001" and out["status"] == "submitted"
    assert out["max_score"] == 2 and out["score"] == 32 and out["band_estimate"] == 7.0
    assert out["audio_url"].startswith("https://signed/tests/t-uuid/full.mp3")
    assert out["section_offsets"] == {"S1": 31.22}
    assert out["band_conversion"][0]["band"] == 7.0
    by_q = {r["q_num"]: r for r in out["review"]}
    # Q1: correct + joined audio window (full_test-absolute) + solution
    assert by_q[1]["correct"] is True
    assert by_q[1]["audio_window"] == {"start": 126.32, "end": 135.64, "section": "S1"}
    assert by_q[1]["section"] == "S1"
    assert by_q[1]["solution"]["skills"] == "K1, K2"
    assert by_q[1]["prompt"] == "City:"
    # Q2: wrong, expected surfaced
    assert by_q[2]["correct"] is False and by_q[2]["expected"] == "BN1 6QR"
    # transcripts present
    assert out["sections"][0]["section_num"] == 1


def test_review_409_when_not_submitted(monkeypatch):
    in_progress = dict(_ATTEMPT_SUBMITTED, status="in_progress")
    _patch(monkeypatch, in_progress)
    with pytest.raises(HTTPException) as e:
        _run(L.get_listening_test_attempt_review("att-1", authorization="x"))
    assert e.value.status_code == 409
