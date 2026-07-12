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
    "transcript_anchors": {"1": 7, "2": 9},
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
    # v1.2: per-question transcript paragraph anchor flows through to the review
    assert by_q[1]["transcript_anchor"] == 7
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


def test_review_admin_bypasses_ownership(monkeypatch):
    """2026-07-12: an admin may open ANOTHER user's (U1's) submitted attempt —
    the mock-review console reuses this endpoint while deciding the band."""
    async def _caller(_a): return {"id": "ADMIN1", "email": "admin@x"}
    async def _admin_true(_a): return True
    monkeypatch.setattr(L, "_require_auth", _caller)
    monkeypatch.setattr(L, "_is_admin", _admin_true)
    monkeypatch.setattr(L, "supabase_admin", _DB(_ATTEMPT_SUBMITTED))
    out = _run(L.get_listening_test_attempt_review("att-1", authorization="x"))
    assert out["score"] == 32


def test_review_admin_bypasses_seal(monkeypatch):
    """2026-07-12: an admin may open a still-sealed 4-skill mock attempt —
    everyone else stays blocked by _mock_sealed until the sitting releases."""
    async def _caller(_a): return {"id": "ADMIN1", "email": "admin@x"}
    async def _admin_true(_a): return True
    monkeypatch.setattr(L, "_require_auth", _caller)
    monkeypatch.setattr(L, "_is_admin", _admin_true)
    monkeypatch.setattr(L, "_mock_sealed", lambda attempt: True)
    monkeypatch.setattr(L, "supabase_admin", _DB(_ATTEMPT_SUBMITTED))
    out = _run(L.get_listening_test_attempt_review("att-1", authorization="x"))
    assert out["score"] == 32


# ── Mini-test replay rebase (audio_window absolute → section-relative) ─────────
# A mini's premixed audio is its SINGLE section alone (mp3 starts ~0), but the
# stored window is full-test-absolute (= section-relative + section_offset).
# Seeking absolute lands `section_offset` seconds too late. Rebase fixes it.

def test_rebase_audio_window_pure():
    offs = {"S3": 30.12}
    # mini: subtract the section offset → section-relative
    assert L._rebase_audio_window(
        {"start": 95.68, "end": 108.23, "section": "S3"}, True, offs) == \
        {"start": 65.56, "end": 78.11, "section": "S3"}
    # full test (is_mini=False): pass through UNCHANGED — regression guard
    assert L._rebase_audio_window(
        {"start": 95.68, "end": 108.23, "section": "S3"}, False, offs) == \
        {"start": 95.68, "end": 108.23, "section": "S3"}
    # missing offset / unknown section / None → pass through (never crash)
    assert L._rebase_audio_window(
        {"start": 10.0, "end": 20.0, "section": "S9"}, True, offs) == \
        {"start": 10.0, "end": 20.0, "section": "S9"}
    assert L._rebase_audio_window(None, True, offs) is None


# A 1-section "Section 3" mini, modelled on the real LIS_L01 pack: Q1's answer
# turn sits at ~67–77 s in the section-only mp3, but the stored window is the
# absolute 95.68–108.23 (= 65.56–78.11 + 30.12). The endpoint must serve the
# rebased 65.56–78.11 so the player seeks the answer, not 30 s past it.
_MINI_ATTEMPT = dict(_ATTEMPT_SUBMITTED, grading_details=[
    {"q_num": 1, "correct": True, "user_answer": "Brennan", "expected": "Brennan"},
])
_MINI_TEST_ROW = {
    "id": "t-uuid", "test_id": "ILR-LIS-L01", "title": "L01 mini", "band_target": 5.5,
    "cue_points": [], "full_audio_storage_path": "tests/t-uuid/full.mp3",
    "full_audio_duration_seconds": 302,
    "metadata": {"section_offsets": {"S3": 30.12}, "test_type": "mini"},
    "themes": {},
}
_MINI_CONTENT = [{"id": "c3", "section_num": 3, "title": "S3", "transcript": "…",
                  "metadata": {"theme": "Family", "section_offset": 30.12}}]
_MINI_EXERCISES = [{"payload": {
    "variant": "sentence_completion",
    "questions": [{"q_num": 1, "prompt": "The student's surname is ___"}],
    "audio_windows": {"1": {"start": 95.68, "end": 108.23, "section": "S3"}},
    "solutions": {"1": {"answer": "Brennan"}},
    "transcript_anchors": {"1": 1},
}}]


def test_review_mini_rebases_window_to_section_relative(monkeypatch):
    async def _ok(_a): return {"id": "U1", "email": "u@x"}
    monkeypatch.setattr(L, "_require_auth", _ok)
    db = _DB(_MINI_ATTEMPT)
    db._d["listening_tests"] = [_MINI_TEST_ROW]
    db._d["listening_content"] = _MINI_CONTENT
    db._d["listening_exercises"] = _MINI_EXERCISES
    monkeypatch.setattr(L, "supabase_admin", db)

    out = _run(L.get_listening_test_attempt_review("att-1", authorization="x"))
    win = {r["q_num"]: r for r in out["review"]}[1]["audio_window"]
    # rebased to section-relative (absolute 95.68 − offset 30.12)
    assert win == {"start": 65.56, "end": 78.11, "section": "S3"}
    # lands ON the answer turn (~67–77 s in the section mp3), NOT 30 s late
    # (the wrong turn at this pack starts at 95.22 s)
    assert win["start"] < 95.22, "must seek before the next (wrong) turn"
    assert win["start"] <= 77.11 and win["end"] >= 67.06, "window must overlap the answer turn"
