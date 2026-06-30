"""Tests for services.quiz_service (Pha 2 — player read/write paths).

supabase_admin mocked. Covers bank serving, session start + resume, progress
logging (ownership + batch), and session end.
"""

from __future__ import annotations

from typing import Optional
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from services import quiz_service

_USER = "11111111-1111-1111-1111-111111111111"
_OTHER = "22222222-2222-2222-2222-222222222222"
_BANK = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
_SESS = "55555555-5555-5555-5555-555555555555"


class _FakeSupabase:
    def __init__(self, responses=None):
        self.responses = responses or {}
        self.calls = []

    def table(self, name):
        return _FakeQuery(self, name)


class _FakeQuery:
    def __init__(self, p, t):
        self._p = p; self._t = t; self._op = None; self._payload = None; self._filters = []

    def insert(self, payload): self._op = "insert"; self._payload = payload; return self
    def upsert(self, payload, **k): self._op = "upsert"; self._payload = payload; return self
    def update(self, payload): self._op = "update"; self._payload = payload; return self
    def delete(self): self._op = "delete"; return self
    def select(self, *a, **k): self._op = "select"; return self
    def eq(self, c, v): self._filters.append((c, v)); return self
    def neq(self, c, v): self._filters.append(("neq", c, v)); return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self

    def execute(self):
        data = self._p.responses.get((self._t, self._op), [])
        self._p.calls.append({"table": self._t, "op": self._op, "payload": self._payload, "filters": list(self._filters)})
        if isinstance(data, Exception):
            raise data
        return MagicMock(data=data)


# ── serve bank ───────────────────────────────────────────────────────

def test_get_bank_for_play_published():
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{"id": _BANK, "is_published": True, "code": "L14"}],
        ("quiz_questions", "select"): [{"qid": "a1"}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.get_bank_for_play(_BANK)
    assert out["bank"]["code"] == "L14"
    assert out["questions"] == [{"qid": "a1"}]


def test_get_bank_for_play_unpublished_404():
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{"id": _BANK, "is_published": False}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as e:
            quiz_service.get_bank_for_play(_BANK)
    assert e.value.status_code == 404


# ── start session + resume ───────────────────────────────────────────

def test_start_session_creates_and_returns_resume():
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{"id": _BANK, "is_published": True, "code": "L14"}],
        ("quiz_questions", "select"): [{"qid": "a1"}],
        ("quiz_sessions", "insert"): [{"id": _SESS}],
        ("quiz_word_stats", "select"): [{"item_key": "Vocation", "status": "carried_over"}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.start_session(user_id=_USER, bank_id=_BANK)
    assert out["session_id"] == _SESS
    assert out["resume"] == [{"item_key": "Vocation", "status": "carried_over"}]
    ins = next(c for c in fake.calls if c["table"] == "quiz_sessions" and c["op"] == "insert")
    assert ins["payload"]["user_id"] == _USER


# ── progress logging ─────────────────────────────────────────────────

def _session_resp(user_id=_USER):
    return {("quiz_sessions", "select"): [{"id": _SESS, "user_id": user_id, "bank_id": _BANK}]}


def test_log_progress_rejects_foreign_session():
    fake = _FakeSupabase(responses=_session_resp(user_id=_OTHER))
    with patch.object(quiz_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as e:
            quiz_service.log_progress(user_id=_USER, session_id=_SESS, attempts=[], word_stats=[])
    assert e.value.status_code == 403


def test_log_progress_inserts_attempts_and_upserts_stats():
    fake = _FakeSupabase(responses=_session_resp())
    attempts = [
        {"item_key": "Vocation", "qid": "v1", "skill": "meaning", "is_correct": True, "attempt_no": 1},
        {"qid": "bad"},   # malformed (no item_key/is_correct) → skipped
    ]
    stats = [{"item_key": "Vocation", "correct_count": 1, "status": "provisional", "skills_passed": ["meaning"]}]
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.log_progress(user_id=_USER, session_id=_SESS, attempts=attempts, word_stats=stats)
    assert out["attempts"] == 1 and out["word_stats"] == 1
    a_ins = next(c for c in fake.calls if c["table"] == "quiz_attempts" and c["op"] == "insert")
    assert len(a_ins["payload"]) == 1                      # malformed dropped
    assert a_ins["payload"][0]["user_id"] == _USER and a_ins["payload"][0]["bank_id"] == _BANK
    w_up = next(c for c in fake.calls if c["table"] == "quiz_word_stats" and c["op"] == "upsert")
    assert w_up["payload"][0]["item_key"] == "Vocation"


def test_log_progress_normalizes_bad_status():
    fake = _FakeSupabase(responses=_session_resp())
    stats = [{"item_key": "X", "status": "bogus"}]
    with patch.object(quiz_service, "supabase_admin", fake):
        quiz_service.log_progress(user_id=_USER, session_id=_SESS, attempts=[], word_stats=stats)
    w_up = next(c for c in fake.calls if c["table"] == "quiz_word_stats" and c["op"] == "upsert")
    assert w_up["payload"][0]["status"] == "testing"      # invalid → safe default


# ── end session ──────────────────────────────────────────────────────

def test_end_session_computes_accuracy():
    fake = _FakeSupabase(responses={
        **_session_resp(),
        ("quiz_sessions", "update"): [{"id": _SESS, "accuracy": 0.8}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        quiz_service.end_session(user_id=_USER, session_id=_SESS, data={
            "total_questions": 10, "total_correct": 8, "total_wrong": 2, "ended_by": "completed",
        })
    upd = next(c for c in fake.calls if c["table"] == "quiz_sessions" and c["op"] == "update")
    assert upd["payload"]["accuracy"] == 0.8
    assert upd["payload"]["ended_by"] == "completed"


def test_end_session_defaults_bad_ended_by():
    fake = _FakeSupabase(responses={**_session_resp(), ("quiz_sessions", "update"): [{}]})
    with patch.object(quiz_service, "supabase_admin", fake):
        quiz_service.end_session(user_id=_USER, session_id=_SESS, data={"ended_by": "nonsense"})
    upd = next(c for c in fake.calls if c["table"] == "quiz_sessions" and c["op"] == "update")
    assert upd["payload"]["ended_by"] == "completed"
    assert upd["payload"]["accuracy"] is None             # 0 questions → None
