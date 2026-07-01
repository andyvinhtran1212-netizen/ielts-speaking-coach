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

    def rpc(self, name, params):
        return _FakeRpc(self, name)


class _FakeRpc:
    def __init__(self, p, name):
        self._p = p; self._name = name

    def execute(self):
        data = self._p.responses.get(("rpc", self._name), [])
        if isinstance(data, Exception):
            raise data
        return MagicMock(data=data)


class _FakeQuery:
    def __init__(self, p, t):
        self._p = p; self._t = t; self._op = None; self._payload = None; self._filters = []; self._count = False

    def insert(self, payload): self._op = "insert"; self._payload = payload; return self
    def upsert(self, payload, **k): self._op = "upsert"; self._payload = payload; return self
    def update(self, payload): self._op = "update"; self._payload = payload; return self
    def delete(self): self._op = "delete"; return self
    def select(self, *a, **k): self._op = "select"; self._count = k.get("count") is not None; return self
    def eq(self, c, v): self._filters.append((c, v)); return self
    def neq(self, c, v): self._filters.append(("neq", c, v)); return self
    def in_(self, c, vals): self._filters.append(("in", c, list(vals))); return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self

    def execute(self):
        data = self._p.responses.get((self._t, self._op), [])
        self._p.calls.append({"table": self._t, "op": self._op, "payload": self._payload, "filters": list(self._filters)})
        if isinstance(data, Exception):
            raise data
        return MagicMock(data=data, count=(len(data) if self._count else None))


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


def test_get_bank_for_play_attaches_grammar_article_url(monkeypatch):
    """Grammar questions get a resolved article_url so the player can link 'review'."""
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{"id": _BANK, "is_published": True, "skill_area": "grammar"}],
        ("quiz_questions", "select"): [
            {"qid": "g1", "grammar_article_slug": "present-perfect"},
            {"qid": "g2"},   # no slug → no url
        ],
    })
    import services.grammar_content as gc
    monkeypatch.setattr(gc.grammar_service, "articles_by_slug",
                        {"present-perfect": {"category": "tenses"}})
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.get_bank_for_play(_BANK)
    g1 = next(q for q in out["questions"] if q["qid"] == "g1")
    g2 = next(q for q in out["questions"] if q["qid"] == "g2")
    assert g1["article_url"] == "/grammar/tenses/present-perfect"
    assert "article_url" not in g2


def test_get_bank_for_play_attaches_word_cards_by_headword():
    """Vocab banks get a word_cards map (lowercased headword → card) so the player
    can show a quick-glance popup. Keyed to match quiz_questions.item_key."""
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [
            {"id": _BANK, "is_published": True, "skill_area": "vocab", "topic_id": "t1"}],
        ("quiz_questions", "select"): [{"qid": "v1", "item_key": "Vocation"}],
        ("vocab_cards", "select"): [
            {"headword": "Vocation", "definition_vi": "nghề", "pronunciation": "/voʊ/",
             "audio_headword": "u.mp3", "example": "She found her vocation."}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.get_bank_for_play(_BANK)
    assert "vocation" in out["word_cards"]                 # lowercased key
    assert out["word_cards"]["vocation"]["definition_vi"] == "nghề"


def test_get_bank_for_play_skips_word_cards_for_grammar():
    """Grammar banks have no vocab cards — no vocab_cards query, empty map."""
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [
            {"id": _BANK, "is_published": True, "skill_area": "grammar", "topic_id": "t1"}],
        ("quiz_questions", "select"): [{"qid": "g1"}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.get_bank_for_play(_BANK)
    assert out["word_cards"] == {}
    assert not any(c["table"] == "vocab_cards" for c in fake.calls)


def test_get_bank_for_play_word_cards_resilient_to_db_error():
    """A vocab_cards read failure degrades to an empty map, not a 500."""
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [
            {"id": _BANK, "is_published": True, "skill_area": "vocab", "topic_id": "t1"}],
        ("quiz_questions", "select"): [{"qid": "v1", "item_key": "Vocation"}],
        ("vocab_cards", "select"): Exception("transient"),
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.get_bank_for_play(_BANK)
    assert out["word_cards"] == {}


def test_get_bank_for_play_unpublished_404():
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{"id": _BANK, "is_published": False}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as e:
            quiz_service.get_bank_for_play(_BANK)
    assert e.value.status_code == 404


# ── start session + resume ───────────────────────────────────────────

def test_start_session_fails_closed_when_resume_read_errors():
    """P1: if the resume read errors, start_session must raise (no session row) —
    otherwise a fresh-looking session would overwrite prior mastery on first POST."""
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{"id": _BANK, "is_published": True, "code": "L14"}],
        ("quiz_questions", "select"): [{"qid": "a1"}],
        ("quiz_word_stats", "select"): Exception("transient RLS/network error"),
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as e:
            quiz_service.start_session(user_id=_USER, bank_id=_BANK)
    assert e.value.status_code == 500
    assert not any(c["table"] == "quiz_sessions" and c["op"] == "insert" for c in fake.calls)


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
        {"client_id": "c-1", "item_key": "Vocation", "qid": "v1", "skill": "meaning", "is_correct": True, "attempt_no": 1},
        {"qid": "bad"},   # malformed (no item_key/is_correct) → skipped
    ]
    stats = [{"item_key": "Vocation", "correct_count": 1, "status": "provisional", "skills_passed": ["meaning"]}]
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.log_progress(user_id=_USER, session_id=_SESS, attempts=attempts, word_stats=stats)
    assert out["attempts"] == 1 and out["word_stats"] == 1
    # attempts are UPSERTED (idempotent on client_id) — a retried/keepalive re-send dedupes.
    a_up = next(c for c in fake.calls if c["table"] == "quiz_attempts" and c["op"] == "upsert")
    assert len(a_up["payload"]) == 1                      # malformed dropped
    assert a_up["payload"][0]["user_id"] == _USER and a_up["payload"][0]["bank_id"] == _BANK
    assert a_up["payload"][0]["client_id"] == "c-1"
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


# ── Analytics (Pha 5a) ───────────────────────────────────────────────

def test_bank_analytics_returns_items_skills_and_session_count():
    fake = _FakeSupabase(responses={
        ("rpc", "quiz_item_error_rates"): [{"item_key": "Vocation", "total": 10, "wrong": 6, "error_rate": 0.6}],
        ("rpc", "quiz_skill_error_rates"): [{"skill": "spelling", "total": 8, "wrong": 5, "error_rate": 0.625}],
        ("quiz_sessions", "select"): [{"id": "s1"}, {"id": "s2"}, {"id": "s3"}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.bank_analytics(_BANK)
    assert out["items"][0]["item_key"] == "Vocation" and out["items"][0]["error_rate"] == 0.6
    assert out["skills"][0]["skill"] == "spelling"
    assert out["session_count"] == 3


def test_student_progress_groups_by_bank_and_lists_sessions():
    fake = _FakeSupabase(responses={
        # aggregated server-side (RPC) — no row-cap undercount
        ("rpc", "quiz_user_bank_progress"): [{"bank_id": _BANK, "mastered": 2, "in_progress": 1}],
        ("quiz_banks", "select"): [{"id": _BANK, "code": "L14", "title": "Work", "skill_area": "vocab", "words_count": 29}],
        ("quiz_sessions", "select"): [
            {"code": "L14", "accuracy": 0.8, "words_mastered": 2, "duration_sec": 120,
             "ended_at": "2026-07-01T00:00:00Z"},                       # finalized
            {"code": "L99", "accuracy": None, "words_mastered": 0, "duration_sec": None,
             "ended_at": None},                                          # abandoned on load
        ],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.student_progress(_USER)
    assert len(out["banks"]) == 1
    b = out["banks"][0]
    assert b["code"] == "L14" and b["mastered"] == 2 and b["in_progress"] == 1
    assert b["words_count"] == 29
    assert out["recent_sessions"][0]["accuracy"] == 0.8
    # Lifetime totals — the abandoned (ended_at-less) session is EXCLUDED so the
    # count isn't inflated by opening the quiz and leaving.
    t = out["totals"]
    assert t["sessions"] == 1
    assert t["time_sec"] == 120
    assert t["words_mastered"] == 2          # summed across banks (page-safe RPC)
    assert t["avg_accuracy"] == 0.8


def test_student_progress_empty_when_no_word_stats():
    fake = _FakeSupabase(responses={
        ("rpc", "quiz_user_bank_progress"): [],
        ("quiz_sessions", "select"): [],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.student_progress(_USER)
    assert out["banks"] == [] and out["recent_sessions"] == []
    assert out["totals"] == {"sessions": 0, "time_sec": 0, "words_mastered": 0, "avg_accuracy": None}


# ── Admin: observe learners' practice (Pha 5b) ───────────────────────

def test_admin_student_rollup_joins_identity_and_weights_overview():
    # _USER has 3 finalized sessions but only 2 GRADED (one had no answers →
    # NULL accuracy). Weighting by graded (not total) sessions is what we assert.
    fake = _FakeSupabase(responses={
        ("rpc", "quiz_admin_student_rollup"): [
            {"user_id": _USER, "sessions": 3, "graded_sessions": 2, "total_time_sec": 600,
             "avg_accuracy": 0.9, "words_mastered": 12, "last_active": "2026-07-01T00:00:00Z"},
            {"user_id": _OTHER, "sessions": 1, "graded_sessions": 1, "total_time_sec": 120,
             "avg_accuracy": 0.5, "words_mastered": 2, "last_active": "2026-06-30T00:00:00Z"},
        ],
        ("users", "select"): [
            {"id": _USER, "email": "a@x", "display_name": "Anh A"},
            {"id": _OTHER, "email": "b@x", "display_name": "Bao B"},
        ],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.admin_student_rollup(skill_area="vocab")
    ov = out["overview"]
    assert ov["active_learners"] == 2
    assert ov["total_sessions"] == 4
    assert ov["total_time_sec"] == 720
    assert ov["total_words_mastered"] == 14
    # weighted by GRADED sessions: (0.9*2 + 0.5*1) / (2+1) = 2.3/3 ≈ 0.7667
    # (weighting by total sessions would wrongly give (0.9*3+0.5*1)/4 = 0.8)
    assert abs(ov["avg_accuracy"] - (2.3 / 3)) < 1e-9
    s0 = out["students"][0]                     # RPC orders last_active desc → _USER first
    assert s0["user_id"] == _USER and s0["name"] == "Anh A" and s0["email"] == "a@x"
    assert s0["sessions"] == 3 and s0["words_mastered"] == 12 and s0["time_sec"] == 600


def test_admin_student_rollup_empty_when_no_activity():
    fake = _FakeSupabase(responses={("rpc", "quiz_admin_student_rollup"): []})
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.admin_student_rollup(skill_area="vocab")
    assert out["students"] == []
    assert out["overview"]["active_learners"] == 0
    assert out["overview"]["avg_accuracy"] is None


def test_admin_student_detail_scoped_to_skill_and_wraps_identity():
    """The vocab drill-down must NOT leak the learner's grammar bank progress."""
    _BANK2 = "cccccccc-cccc-cccc-cccc-cccccccccccc"
    fake = _FakeSupabase(responses={
        ("rpc", "quiz_user_bank_progress"): [
            {"bank_id": _BANK, "mastered": 2, "in_progress": 1},
            {"bank_id": _BANK2, "mastered": 1, "in_progress": 0},   # grammar — must be filtered
        ],
        ("quiz_banks", "select"): [
            {"id": _BANK, "code": "L14", "title": "Work", "skill_area": "vocab", "words_count": 29},
            {"id": _BANK2, "code": "GR1", "title": "Tenses", "skill_area": "grammar", "words_count": 10},
        ],
        ("quiz_sessions", "select"): [{"code": "L14", "accuracy": 0.8, "words_mastered": 2}],
        ("users", "select"): [{"id": _USER, "email": "a@x", "display_name": "Anh A"}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.admin_student_detail(_USER, skill_area="vocab")
    assert out["user"]["name"] == "Anh A" and out["user"]["email"] == "a@x"
    codes = [b["code"] for b in out["banks"]]
    assert codes == ["L14"]                      # grammar bank GR1 excluded
    assert out["recent_sessions"][0]["accuracy"] == 0.8
    # Recent sessions are re-queried scoped by bank_id BEFORE the 20-row cap
    # (not filtered from the cross-skill capped list).
    assert any(c["table"] == "quiz_sessions"
               and any(f[0] == "in" and f[1] == "bank_id" for f in c["filters"])
               for c in fake.calls)
