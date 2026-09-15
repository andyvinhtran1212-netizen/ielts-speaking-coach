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
        self.storage = _FakeStorage(self)

    def table(self, name):
        return _FakeQuery(self, name)

    def rpc(self, name, params):
        return _FakeRpc(self, name, params)


class _FakeStorage:
    def __init__(self, parent): self._parent = parent
    def from_(self, bucket): return _FakeBucket(self._parent, bucket)


class _FakeBucket:
    def __init__(self, parent, bucket): self._parent = parent; self._bucket = bucket
    def create_signed_url(self, path, ttl):
        self._parent.calls.append({"storage": self._bucket, "path": path, "ttl": ttl})
        return {"signedURL": f"https://signed/{path}"}


class _FakeRpc:
    def __init__(self, p, name, params):
        self._p = p; self._name = name; self._params = params

    def execute(self):
        data = self._p.responses.get(("rpc", self._name), [])
        self._p.calls.append({"table": "rpc:" + self._name, "op": "rpc",
                              "payload": self._params, "filters": []})
        if isinstance(data, Exception):
            raise data
        return MagicMock(data=data)


class _FakeQuery:
    def __init__(self, p, t):
        self._p = p; self._t = t; self._op = None; self._payload = None; self._filters = []; self._count = False
        self._range = None

    def insert(self, payload): self._op = "insert"; self._payload = payload; return self
    def upsert(self, payload, **k): self._op = "upsert"; self._payload = payload; return self
    def update(self, payload): self._op = "update"; self._payload = payload; return self
    def delete(self): self._op = "delete"; return self
    def select(self, *a, **k): self._op = "select"; self._count = k.get("count") is not None; return self
    def eq(self, c, v): self._filters.append((c, v)); return self
    def neq(self, c, v): self._filters.append(("neq", c, v)); return self
    def in_(self, c, vals): self._filters.append(("in", c, list(vals))); return self
    @property
    def not_(self): return self
    def is_(self, c, v): self._filters.append(("not_is", c, v)); return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self
    # PostgREST range() is an inclusive offset window — the paging primitive
    # mastered_item_keys() uses so a long word_stats list isn't truncated.
    def range(self, a, b): self._range = (a, b); return self

    def execute(self):
        data = self._p.responses.get((self._t, self._op), [])
        self._p.calls.append({"table": self._t, "op": self._op, "payload": self._payload, "filters": list(self._filters)})
        if isinstance(data, Exception):
            raise data
        if self._range is not None:
            lo, hi = self._range
            return MagicMock(data=data[lo:hi + 1],
                             count=(len(data) if self._count else None))
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


def test_get_bank_for_play_resolves_audio_missed_by_import():
    """THE listen-and-type bug: quiz_questions.audio_url is written ONLY at import,
    so a bank imported before the word's TTS pregen finished keeps audio_url NULL
    forever — the player then hid the 🔊 button on a question that cannot be answered
    without it. Serve-time resolution reads the card's CURRENT audio."""
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [
            {"id": _BANK, "is_published": True, "skill_area": "vocab", "topic_id": "t1"}],
        ("quiz_questions", "select"): [
            {"qid": "v1", "item_key": "Vocation",
             "prompt": "Nghe và gõ lại từ. {{audio}}", "audio_url": None}],
        ("vocab_cards", "select"): [
            {"headword": "Vocation", "audio_headword": "https://cdn/pregen-later.mp3"}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.get_bank_for_play(_BANK)
    assert out["questions"][0]["audio_url"] == "https://cdn/pregen-later.mp3"


def test_get_bank_for_play_audio_follows_the_card_not_the_snapshot():
    """The card is the source of truth: a re-generated audio file must reach the
    player, not the URL frozen into the row at import time."""
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [
            {"id": _BANK, "is_published": True, "skill_area": "vocab", "topic_id": "t1"}],
        ("quiz_questions", "select"): [
            {"qid": "v1", "item_key": "vocation",
             "prompt": "{{audio}} Gõ lại từ.", "audio_url": "https://cdn/stale.mp3"}],
        ("vocab_cards", "select"): [
            {"headword": "Vocation", "audio_headword": "https://cdn/fresh.mp3"}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.get_bank_for_play(_BANK)
    assert out["questions"][0]["audio_url"] == "https://cdn/fresh.mp3"


def test_get_bank_for_play_keeps_audio_url_when_no_card_audio():
    """No card / no pregen yet → keep whatever the row holds (grammar banks carry no
    word_cards at all). Resolution only ever upgrades; it never blanks a live URL."""
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [
            {"id": _BANK, "is_published": True, "skill_area": "vocab", "topic_id": "t1"}],
        ("quiz_questions", "select"): [
            {"qid": "v1", "item_key": "Ghost",
             "prompt": "Nghe. {{audio}}", "audio_url": "https://cdn/kept.mp3"},
            {"qid": "v2", "item_key": "Vocation",
             "prompt": "Nghĩa của từ?", "audio_url": None}],
        ("vocab_cards", "select"): [
            {"headword": "Vocation", "audio_headword": "https://cdn/fresh.mp3"}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.get_bank_for_play(_BANK)
    qs = {q["qid"]: q for q in out["questions"]}
    assert qs["v1"]["audio_url"] == "https://cdn/kept.mp3"   # no card → snapshot stands
    assert qs["v2"]["audio_url"] is None                     # no {{audio}} → untouched


@pytest.mark.parametrize("refresh_response", [Exception("post-start read failed"), []])
def test_timed_bank_keeps_timer_when_optional_mastery_refresh_fails(refresh_response):
    anchored = {
        "id": "item-timed", "assignment_id": "asg-timed",
        "opened_at": "2026-09-15T01:00:00+00:00",
        "due_at": None, "accepting": True, "passed_at": None,
        "mastery": None, "content_config": {"time_limit_minutes": 30},
    }
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{
            "id": _BANK, "code": "C1-MIDTERM", "skill_area": "course",
            "meta": {},
        }],
        ("class_assignment_items", "select"): refresh_response,
        ("quiz_questions", "select"): [{"qid": "q-1", "type": "mcq"}],
    })
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_assignment_item_for_review", return_value=anchored), \
         patch.object(quiz_service, "_ensure_timed_course_session",
                      return_value=(anchored, _SESS)), \
         patch.object(quiz_service, "_word_cards_for", return_value=[]), \
         patch.object(quiz_service, "_attach_article_urls"), \
         patch.object(quiz_service, "_resolve_question_audio"):
        out = quiz_service.get_bank_for_play(
            _BANK, user_id=_USER, assignment_item_id="item-timed",
        )
    assert out["questions"]
    assert out["mastery"]["is_timed"] is True
    assert out["mastery"]["started_at"] == "2026-09-15T01:00:00+00:00"
    assert out["mastery"]["expires_at"] == "2026-09-15T01:30:00+00:00"


def test_timed_near_pass_bank_read_adopts_retake_phase_not_run():
    mastery = {"attempts": [{
        "phase": "run", "pct": 70, "completed": True,
        "next_action": "retake", "at": "2026-09-15T12:20:00+00:00",
        "sessions": ["completed-run"],
    }]}
    anchored = {
        "id": "item-timed", "assignment_id": "asg-timed",
        "opened_at": "2026-09-15T12:00:00+00:00",
        "due_at": None, "accepting": True, "passed_at": None,
        # Simulate the near-pass committing after the first authorization read
        # but before the canonical mastery refresh.
        "mastery": None, "content_config": {"time_limit_minutes": 720},
    }
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{
            "id": _BANK, "code": "C1-MIDTERM", "skill_area": "course", "meta": {},
        }],
        ("class_assignment_items", "select"): [{
            "passed_at": None, "mastery": mastery,
        }],
        ("class_assignments", "select"): [{
            "id": "asg-timed", "status": "published", "publish_at": None,
            "due_at": None,
            "content_config": {"time_limit_minutes": 720, "pass_pct": 75},
        }],
        ("quiz_questions", "select"): [{"qid": "q-1", "type": "mcq"}],
    })
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_assignment_item_for_review",
                      return_value=anchored), \
         patch.object(quiz_service, "_ensure_timed_course_session",
                      return_value=(anchored, None)) as ensure, \
         patch.object(quiz_service, "_word_cards_for", return_value=[]), \
         patch.object(quiz_service, "_attach_article_urls"), \
         patch.object(quiz_service, "_resolve_question_audio"):
        out = quiz_service.get_bank_for_play(
            _BANK, user_id=_USER, assignment_item_id="item-timed",
        )
    assert out["mastery"]["course_action"] == "retake"
    assert ensure.call_args.kwargs["kind"] == "retake"


def test_timed_bank_crossing_cutoff_at_final_gate_returns_pending_state():
    before_cutoff = {
        "id": "item-timed", "assignment_id": "asg-timed",
        "opened_at": "2999-09-15T12:00:00+00:00",
        "due_at": None, "accepting": True, "passed_at": None,
        "mastery": None, "content_config": {"time_limit_minutes": 60},
    }
    after_cutoff = {
        **before_cutoff,
        "opened_at": "2020-09-15T12:00:00+00:00",
        "due_at": "2020-09-15T12:30:00+00:00",
    }
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{
            "id": _BANK, "code": "C1-MIDTERM", "skill_area": "course", "meta": {},
        }],
        ("class_assignment_items", "select"): [{
            "passed_at": None, "mastery": None,
        }],
        ("class_assignments", "select"): [{
            "id": "asg-timed", "status": "published", "publish_at": None,
            "due_at": None, "content_config": {"time_limit_minutes": 60},
        }],
        ("quiz_questions", "select"): [{"qid": "q-1", "type": "mcq"}],
    })
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_assignment_item_for_review",
                      return_value=before_cutoff), \
         patch.object(quiz_service, "_ensure_timed_course_session",
                      return_value=(after_cutoff, None)) as ensure, \
         patch.object(quiz_service, "_word_cards_for", return_value=[]), \
         patch.object(quiz_service, "_attach_article_urls"), \
         patch.object(quiz_service, "_resolve_question_audio"):
        out = quiz_service.get_bank_for_play(
            _BANK, user_id=_USER, assignment_item_id="item-timed",
        )
    ensure.assert_called_once()
    assert out["mastery"]["review_only"] is True
    assert out["mastery"]["expiry_pending"] is True
    assert out["mastery"]["course_action"] == "expired_pending"
    assert out["mastery"]["expires_at"] == "2020-09-15T12:30:00+00:00"


@pytest.mark.parametrize(("entitlement", "session_kind", "score"), [
    ("retake", "retake", 70),
    ("retry_full", "run", 50),
])
def test_expired_retry_stays_pending_until_reaper_records_its_verdict(
    entitlement, session_kind, score,
):
    entitled = {
        "phase": "run", "pct": score, "completed": True,
        "next_action": entitlement, "at": "2020-09-15T12:20:00+00:00",
        "sessions": ["completed-run"],
    }
    retake_session = {
        "id": "pending-retry", "kind": session_kind,
        "created_at": "2020-09-15T12:21:00+00:00",
        "ended_at": None, "ended_by": None,
    }

    def load(mastery):
        anchored = {
            "id": "item-timed", "assignment_id": "asg-timed",
            "opened_at": "2020-09-15T12:00:00+00:00",
            "due_at": None, "accepting": False, "passed_at": None,
            "mastery": mastery,
            "content_config": {"time_limit_minutes": 30, "pass_pct": 75},
        }
        fake = _FakeSupabase(responses={
            ("quiz_banks", "select"): [{
                "id": _BANK, "code": "C1-MIDTERM", "skill_area": "course",
                "meta": {},
            }],
            ("class_assignment_items", "select"): [{
                "passed_at": None, "mastery": mastery,
            }],
            ("class_assignments", "select"): [{
                "id": "asg-timed", "status": "published", "publish_at": None,
                "due_at": None,
                "content_config": {"time_limit_minutes": 30, "pass_pct": 75},
            }],
            ("quiz_sessions", "select"): [retake_session],
            ("quiz_questions", "select"): [{"qid": "q-1", "type": "mcq"}],
        })
        with patch.object(quiz_service, "supabase_admin", fake), \
             patch.object(quiz_service, "_assignment_item_for_review",
                          return_value=anchored), \
             patch.object(quiz_service, "_ensure_timed_course_session") as ensure, \
             patch.object(quiz_service, "_word_cards_for", return_value=[]), \
             patch.object(quiz_service, "_attach_article_urls"), \
             patch.object(quiz_service, "_resolve_question_audio"):
            out = quiz_service.get_bank_for_play(
                _BANK, user_id=_USER, assignment_item_id="item-timed",
            )
        ensure.assert_not_called()
        return out

    pending = load({"attempts": [entitled]})
    assert pending["mastery"]["review_only"] is True
    assert pending["mastery"]["expiry_pending"] is True
    assert pending["mastery"]["course_action"] == "expired_pending"

    after_reaper = load({"attempts": [entitled, {
        "phase": session_kind, "pct": 0, "completed": True,
        "next_action": "timed_out", "at": "2020-09-15T12:30:00+00:00",
        "sessions": ["pending-retry"],
    }]})
    assert after_reaper["mastery"]["review_only"] is True
    assert after_reaper["mastery"]["expiry_pending"] is False
    assert after_reaper["mastery"]["course_action"] == "review"


def test_timed_bank_question_failure_does_not_start_clock_or_session():
    """Prepare the answer-bearing payload before claiming a fixed time window."""
    unopened = {
        "id": "item-timed", "assignment_id": "asg-timed",
        "opened_at": None, "due_at": None, "accepting": True,
        "passed_at": None, "mastery": None,
        "content_config": {"time_limit_minutes": 30},
    }
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{
            "id": _BANK, "code": "C1-MIDTERM", "skill_area": "course",
            "meta": {},
        }],
        ("class_assignment_items", "select"): [],
        ("quiz_questions", "select"): Exception("question read failed"),
    })
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_assignment_item_for_review", return_value=unopened), \
         patch.object(quiz_service, "_ensure_timed_course_session") as anchor:
        with pytest.raises(HTTPException) as exc:
            quiz_service.get_bank_for_play(
                _BANK, user_id=_USER, assignment_item_id="item-timed",
            )
    assert exc.value.status_code == 500
    anchor.assert_not_called()


def test_first_timed_bank_marks_clock_as_started_during_this_load():
    unopened = {
        "id": "item-timed", "assignment_id": "asg-timed",
        "opened_at": None, "due_at": None, "accepting": True,
        "passed_at": None, "mastery": None,
        "content_config": {"time_limit_minutes": 30},
    }
    anchored = {**unopened, "opened_at": "2026-09-15T01:00:00+00:00"}
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{
            "id": _BANK, "code": "C1-MIDTERM", "skill_area": "course",
            "meta": {},
        }],
        ("class_assignment_items", "select"): [{
            "passed_at": None, "mastery": None,
        }],
        ("class_assignments", "select"): [{
            "id": "asg-timed", "status": "published", "publish_at": None,
            "due_at": None, "content_config": {"time_limit_minutes": 30},
        }],
        ("quiz_questions", "select"): [{"qid": "q-1", "type": "mcq"}],
    })
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_assignment_item_for_review",
                      return_value=unopened), \
         patch.object(quiz_service, "_ensure_timed_course_session",
                      return_value=(anchored, _SESS)), \
         patch.object(quiz_service, "_word_cards_for", return_value=[]), \
         patch.object(quiz_service, "_attach_article_urls"), \
         patch.object(quiz_service, "_resolve_question_audio"):
        out = quiz_service.get_bank_for_play(
            _BANK, user_id=_USER, assignment_item_id="item-timed",
        )

    assert out["mastery"]["initial_session_id"] == _SESS
    assert out["mastery"]["timer_started_during_load"] is True


def test_get_bank_for_play_unpublished_404():
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{"id": _BANK, "is_published": False}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as e:
            quiz_service.get_bank_for_play(_BANK)
    assert e.value.status_code == 404


def test_get_bank_for_play_hides_short_reading_solution():
    reading = {
        "title": "Library", "passage": "Mai reads.",
        "translation": "Mai đọc.",
        "answers": [{"id": "r-01", "answer": "T", "explanation": "Đúng."}],
    }
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{
            "id": _BANK, "is_published": True, "skill_area": "grammar",
            "meta": {"short_reading": reading},
        }],
        ("quiz_questions", "select"): [{"qid": "g1"}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.get_bank_for_play(_BANK)
    served = out["bank"]["meta"]["short_reading"]
    assert served["passage"] == "Mai reads."
    assert served["has_solution"] is True
    assert "translation" not in served
    assert "answers" not in served


def test_get_bank_for_play_hides_listening_solution_and_signs_private_audio():
    listening = {
        "audio_bundle": {"bucket": "listening-audio"},
        "sections": [
            {"id": "sound", "questions": [
                {"id": "l-A1", "audio_storage_path": "course/hash/A1.mp3",
                 "options": ["city", "pity"]}]},
            {"id": "content", "audio_storage_path": "course/hash/D.mp3",
             "questions": [{"id": "l-D1", "options": ["T", "F", "NG"]}]},
        ],
        "solution": {"answers": [{"id": "l-A1", "answer": "A"}]},
    }
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{
            "id": _BANK, "is_published": True, "skill_area": "grammar",
            "meta": {"short_listening": listening},
        }],
        ("quiz_questions", "select"): [{"qid": "g1"}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.get_bank_for_play(_BANK)
    served = out["bank"]["meta"]["short_listening"]
    assert "solution" not in served
    assert "audio_storage_path" not in str(served)
    assert served["sections"][0]["questions"][0]["audio_url"].startswith("https://signed/")
    assert served["sections"][1]["audio_url"].startswith("https://signed/")
    assert len([call for call in fake.calls if call.get("storage")]) == 2


def test_course_reading_solution_uses_a_separate_guarded_read():
    reading = {
        "translation": "Mai đọc.",
        "answers": [{"id": "r-01", "answer": "T", "explanation": "Đúng."}],
    }
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{
            "id": _BANK, "is_published": True, "skill_area": "grammar",
            "meta": {"short_reading": reading},
        }],
        ("course_section_submissions", "select"): [],
        ("course_section_submissions", "insert"): [{
            "total": 1, "correct": 1, "score": 100,
            "duration_sec": 0, "submitted_at": "2026-08-20T00:00:00Z",
        }],
    })
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_assignment_item_for", return_value={
             "id": "item-1", "assignment_id": "asg-1",
         }), \
         patch.object(quiz_service, "refresh_course_completion",
                      return_value={"completed": False}):
        out = quiz_service.course_reading_solution(
            user_id=_USER, bank_id=_BANK, submitted_answers={"r-01": "T"})
    assert out["translation"] == reading["translation"]
    assert out["answers"] == reading["answers"]
    assert out["result"]["pct"] == 100
    assert out["result"]["answer_results"] == [{
        "id": "r-01", "submitted_answer": "T", "is_correct": True,
    }]
    inserted = next(c for c in fake.calls
                    if c["table"] == "course_section_submissions" and c["op"] == "insert")
    assert inserted["payload"]["class_assignment_item_id"] == "item-1"
    assert inserted["payload"]["answers"] == {"r-01": "T"}
    assert inserted["payload"]["content_snapshot"] == reading
    assert len([c for c in fake.calls if c["table"] == "quiz_banks"]) == 2


def test_course_reading_solution_rejects_an_incomplete_attempt():
    reading = {
        "translation": "Mai đọc.",
        "answers": [
            {"id": "r-01", "answer": "T", "explanation": "Đúng."},
            {"id": "r-02", "answer": "a", "explanation": "Danh từ số ít."},
        ],
    }
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{
            "id": _BANK, "is_published": True, "skill_area": "grammar",
            "meta": {"short_reading": reading},
        }],
    })
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_assignment_item_for",
                      return_value={"id": "item-1", "assignment_id": "asg-1"}):
        with pytest.raises(HTTPException) as exc:
            quiz_service.course_reading_solution(
                user_id=_USER, bank_id=_BANK, submitted_answers={"r-01": "T"})
    assert exc.value.status_code == 422
    assert exc.value.detail["missing"] == ["r-02"]


def test_course_reading_solution_empty_answers_reviews_canonical_submission():
    saved_answers = [{"id": "r-01", "answer": "T", "explanation": "saved key"}]
    saved_reading = {
        "title": "Bản đã nộp", "passage": "Original passage.",
        "translation": "Bản dịch gốc.", "answers": saved_answers,
        "question_groups": [],
    }
    fake = _FakeSupabase(responses={
        ("course_section_submissions", "select"): [{
            "answers": {"r-01": "T"}, "answer_key": saved_answers,
            "content_snapshot": saved_reading,
            "total": 1, "correct": 1, "score": 100, "duration_sec": 20,
            "submitted_at": "2026-08-20T00:00:00Z",
        }],
    })
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_assignment_item_for_review", return_value={
             "id": "item-1", "assignment_id": "asg-1",
         }) as review_item, \
         patch.object(quiz_service, "refresh_course_completion") as refresh:
        out = quiz_service.course_reading_solution(
            user_id=_USER, bank_id=_BANK, submitted_answers={},
            assignment_item_id="item-1")
    assert out["answers"] == saved_answers
    assert out["translation"] == "Bản dịch gốc."
    assert out["content"]["passage"] == "Original passage."
    assert "translation" not in out["content"] and "answers" not in out["content"]
    assert out["result"]["submitted_answers"] == {"r-01": "T"}
    assert out["result"]["answer_results"] == [{
        "id": "r-01", "submitted_answer": "T", "is_correct": True,
    }]
    assert "_content_snapshot" not in out["result"]
    review_item.assert_called_once_with(
        _BANK, _USER, assignment_item_id="item-1")
    assert not any(call.get("table") == "quiz_banks" for call in fake.calls)
    assert not any(call["table"] == "course_section_submissions" and call["op"] == "insert"
                   for call in fake.calls)
    refresh.assert_not_called()


def test_course_section_item_results_use_the_same_exact_match_as_total_score():
    answers = [
        {"id": "r-06", "answer": "under the desk"},
        {"id": "r-07", "answer": "with a blue roof"},
    ]
    submitted = {"r-06": "Under the desk.", "r-07": "with"}

    results = quiz_service._course_section_answer_results(submitted, answers)

    assert results == [
        {"id": "r-06", "submitted_answer": "Under the desk.", "is_correct": True},
        {"id": "r-07", "submitted_answer": "with", "is_correct": False},
    ]
    assert quiz_service._grade_course_section(submitted, answers) == (1, 2)


def test_course_section_accepts_explicit_bilingual_short_answer_variants():
    answers = [{
        "id": "r-06",
        "answer": "quá khứ đơn (past simple)",
        "accepted": [
            "quá khứ đơn (past simple)", "quá khứ đơn", "past simple",
        ],
    }]

    assert quiz_service._grade_course_section(
        {"r-06": "Quá khứ đơn"}, answers) == (1, 1)
    assert quiz_service._grade_course_section(
        {"r-06": "PAST SIMPLE"}, answers) == (1, 1)
    assert quiz_service._grade_course_section(
        {"r-06": "quá khứ"}, answers) == (0, 1)


def test_course_reading_idempotent_retry_keeps_original_content_snapshot():
    live_reading = {
        "passage": "Changed passage.", "translation": "Bản dịch mới.",
        "answers": [{"id": "r-01", "answer": "F"}],
    }
    saved_answers = [{"id": "r-01", "answer": "T"}]
    saved_reading = {
        "passage": "Original passage.", "translation": "Bản dịch gốc.",
        "answers": saved_answers,
    }
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{
            "id": _BANK, "is_published": True, "skill_area": "grammar",
            "meta": {"short_reading": live_reading},
        }],
        ("course_section_submissions", "select"): [{
            "answers": {"r-01": "T"}, "answer_key": saved_answers,
            "content_snapshot": saved_reading,
            "total": 1, "correct": 1, "score": 100,
        }],
    })
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_assignment_item_for", return_value={
             "id": "item-1", "assignment_id": "asg-1",
         }), \
         patch.object(quiz_service, "refresh_course_completion",
                      return_value={"completed": True}):
        out = quiz_service.course_reading_solution(
            user_id=_USER, bank_id=_BANK, submitted_answers={"r-01": "T"})
    assert out["translation"] == "Bản dịch gốc."
    assert out["content"]["passage"] == "Original passage."
    assert out["answers"] == saved_answers


def test_course_listening_solution_is_guarded_and_requires_every_answer():
    solution = {
        "answers": [{"id": "l-A1", "answer": "A", "transcript": "city"},
                    {"id": "l-D1", "answer": "T"}],
        "talk_transcript": "The city is bigger.",
        "talk_translation": "Thành phố lớn hơn.",
    }
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{
            "id": _BANK, "is_published": True, "skill_area": "grammar",
            "meta": {"short_listening": {"solution": solution}},
        }],
        ("course_section_submissions", "select"): [],
        ("course_section_submissions", "insert"): [{
            "total": 2, "correct": 2, "score": 100,
            "duration_sec": 0, "submitted_at": "2026-08-20T00:00:00Z",
        }],
    })
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_assignment_item_for", return_value={
             "id": "item-1", "assignment_id": "asg-1",
         }), \
         patch.object(quiz_service, "refresh_course_completion",
                      return_value={"completed": False}):
        with pytest.raises(HTTPException) as exc:
            quiz_service.course_listening_solution(
                user_id=_USER, bank_id=_BANK, submitted_answers={"l-A1": "A"})
        assert exc.value.status_code == 422
        out = quiz_service.course_listening_solution(
            user_id=_USER, bank_id=_BANK,
            submitted_answers={"l-A1": "A", "l-D1": "T"})
    assert out["talk_transcript"] == solution["talk_transcript"]
    assert out["answers"] == solution["answers"]
    assert out["result"]["correct"] == 2
    inserted = next(c for c in fake.calls
                    if c["table"] == "course_section_submissions" and c["op"] == "insert")
    assert inserted["payload"]["content_snapshot"]["solution"] == solution


def test_course_listening_review_uses_saved_transcript_not_live_bank():
    saved_solution = {
        "answers": [{"id": "l-A1", "answer": "A", "transcript": "original"}],
        "talk_transcript": "Original transcript.",
        "talk_translation": "Bản dịch gốc.",
    }
    fake = _FakeSupabase(responses={
        ("course_section_submissions", "select"): [{
            "answers": {"l-A1": "A"}, "answer_key": saved_solution["answers"],
            "content_snapshot": {"title": "Original", "sections": [],
                                 "solution": saved_solution},
            "total": 1, "correct": 1, "score": 100, "duration_sec": 30,
        }],
    })
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_assignment_item_for_review", return_value={
             "id": "item-1", "assignment_id": "asg-1",
         }):
        out = quiz_service.course_listening_solution(
            user_id=_USER, bank_id=_BANK, submitted_answers={},
            assignment_item_id="item-1")
    assert out["talk_transcript"] == "Original transcript."
    assert out["answers"] == saved_solution["answers"]
    assert not any(call["table"] == "quiz_banks" for call in fake.calls)


def test_course_listening_audio_refreshes_urls_without_leaking_solution():
    listening = {
        "audio_bundle": {"bucket": "listening-audio"},
        "sections": [{"id": "sound", "questions": [{
            "id": "l-A1", "audio_storage_path": "course/hash/A1.mp3",
            "options": ["city", "pity"],
        }]}],
        "solution": {"answers": [{"id": "l-A1", "answer": "A"}]},
    }
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{
            "id": _BANK, "is_published": True, "skill_area": "grammar",
            "meta": {"short_listening": listening},
        }],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.course_listening_audio(user_id=_USER, bank_id=_BANK)
    assert "solution" not in out
    assert out["sections"][0]["questions"][0]["audio_url"].startswith("https://signed/")
    assert len([call for call in fake.calls if call.get("storage")]) == 1


def test_course_listening_audio_uses_exact_item_review_gate():
    listening = {
        "audio_bundle": {"bucket": "listening-audio"},
        "sections": [{"id": "sound", "questions": [{
            "id": "l-A1", "audio_storage_path": "course/hash/A1.mp3",
            "options": ["city", "pity"],
        }]}],
    }
    fake = _FakeSupabase(responses={
        ("course_section_submissions", "select"): [{"content_snapshot": listening}],
    })
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_assignment_item_for_review",
                      return_value={"id": "item-1"}) as review_gate:
        out = quiz_service.course_listening_audio(
            user_id=_USER, bank_id=_BANK, assignment_item_id="item-1")
    review_gate.assert_called_once_with(_BANK, _USER, assignment_item_id="item-1")
    assert out["sections"][0]["questions"][0]["audio_url"].startswith("https://signed/")
    assert not any(call.get("table") == "quiz_banks" for call in fake.calls)


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


def test_timed_course_start_uses_atomic_timer_and_session_rpc():
    fake = _FakeSupabase(responses={
        ("rpc", "quiz_start_timed_course_session"): [{
            "session_id": _SESS,
            "timer_started_at": "2026-09-15T10:00:00+00:00",
        }],
    })
    item = {
        "id": "item-timed", "opened_at": None,
        "content_config": {"time_limit_minutes": 30},
    }
    with patch.object(quiz_service, "supabase_admin", fake):
        opened, session_id = quiz_service._ensure_timed_course_session(
            item, user_id=_USER, bank_id=_BANK, code="C1-MIDTERM",
        )
    assert session_id == _SESS
    assert opened["opened_at"] == "2026-09-15T10:00:00+00:00"
    rpc = next(call for call in fake.calls if call["op"] == "rpc")
    assert rpc["payload"] == {
        "p_item_id": "item-timed", "p_user_id": _USER,
        "p_bank_id": _BANK, "p_code": "C1-MIDTERM",
        "p_kind": "run", "p_create_if_missing": False,
    }
    assert not any(call["table"] == "quiz_sessions" and call["op"] == "insert"
                   for call in fake.calls)


def test_opened_timed_course_reuses_the_canonical_rpc_session():
    fake = _FakeSupabase(responses={
        ("rpc", "quiz_start_timed_course_session"): [{
            "session_id": _SESS,
            "timer_started_at": "2026-09-15T10:00:00+00:00",
        }],
    })
    item = {
        "id": "item-timed", "opened_at": "2026-09-15T10:00:00+00:00",
        "content_config": {"time_limit_minutes": 720},
    }
    with patch.object(quiz_service, "supabase_admin", fake):
        opened, session_id = quiz_service._ensure_timed_course_session(
            item, user_id=_USER, bank_id=_BANK, code="C1-MIDTERM",
        )
    assert opened["opened_at"] == "2026-09-15T10:00:00+00:00"
    assert session_id == _SESS
    assert any(call["table"] == "rpc:quiz_start_timed_course_session"
               for call in fake.calls)


def test_opened_timed_course_rpc_expiry_refreshes_for_read_only_response():
    refreshed_item = {
        "id": "item-timed", "assignment_id": "asg-timed",
        "opened_at": "2026-09-15T10:00:00+00:00",
        "submitted_at": None, "passed_at": None, "score": None,
        "mastery": None, "updated_at": "after-cutoff",
    }
    refreshed_item["due_at"] = "2026-09-15T10:30:00+00:00"
    refreshed_item["content_config"] = {"time_limit_minutes": 60}
    fake = _FakeSupabase(responses={
        ("rpc", "quiz_start_timed_course_session"):
            Exception("timed_course_assignment_expired"),
    })
    item = {
        "id": "item-timed", "assignment_id": "asg-timed",
        "opened_at": "2026-09-15T10:00:00+00:00", "due_at": None,
        "content_config": {"time_limit_minutes": 60},
    }
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_assignment_item_for_review",
                      return_value=refreshed_item) as review_gate, \
         patch.object(quiz_service, "assignment_timer_state", side_effect=[
             {"is_timed": True, "is_expired": False},
             {"is_timed": True, "is_expired": True},
         ]):
        opened, session_id = quiz_service._ensure_timed_course_session(
            item, user_id=_USER, bank_id=_BANK, code="C1-MIDTERM",
            allow_expired_existing=True,
        )
    assert session_id is None
    assert opened["updated_at"] == "after-cutoff"
    assert opened["due_at"] == "2026-09-15T10:30:00+00:00"
    assert opened["content_config"] == {"time_limit_minutes": 60}
    review_gate.assert_called_once_with(
        _BANK, _USER, assignment_item_id="item-timed",
    )


def test_timed_retake_is_created_by_the_locked_rpc_without_plain_insert():
    item = {
        "id": "item-timed", "assignment_id": "asg-timed",
        "opened_at": "2026-09-15T10:00:00+00:00",
        "content_config": {"time_limit_minutes": 720},
    }
    new_retake = "66666666-6666-6666-6666-666666666666"
    fake = _FakeSupabase(responses={("quiz_word_stats", "select"): []})
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_bank_meta_or_404", return_value={
             "id": _BANK, "code": "C1-MIDTERM", "skill_area": "course",
         }), \
         patch.object(quiz_service, "_assignment_item_for", return_value=item), \
         patch.object(quiz_service, "_ensure_timed_course_session",
                      return_value=(item, new_retake)) as ensure, \
         patch.object(quiz_service, "_assert_retake_allowed") as legacy_gate:
        out = quiz_service.start_session(
            user_id=_USER, bank_id=_BANK, kind="retake",
            assignment_item_id="item-timed",
        )
    assert out["session_id"] == new_retake
    ensure.assert_called_once_with(
        item, user_id=_USER, bank_id=_BANK, code="C1-MIDTERM",
        kind="retake", create_if_missing=True,
    )
    legacy_gate.assert_not_called()
    assert not any(call["table"] == "quiz_sessions" and call["op"] == "insert"
                   for call in fake.calls)


def test_session_timer_response_preserves_the_earlier_due_at_boundary():
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{
            "id": _BANK, "code": "C1-MIDTERM", "skill_area": "course",
        }],
        ("quiz_word_stats", "select"): [],
    })
    item = {
        "id": "item-timed", "assignment_id": "asg-timed",
        "opened_at": "2026-09-15T01:00:00+00:00",
        "due_at": "2026-09-15T01:10:00+00:00",
        "content_config": {"time_limit_minutes": 60},
    }
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_assignment_item_for", return_value=item), \
         patch.object(quiz_service, "_ensure_timed_course_session",
                      return_value=(item, _SESS)):
        out = quiz_service.start_session(
            user_id=_USER, bank_id=_BANK, assignment_item_id="item-timed",
        )
    assert out["session_id"] == _SESS
    assert out["timer"]["expires_at"] == "2026-09-15T01:10:00+00:00"


# ── reset progress ("Làm lại từ đầu") ────────────────────────────────

def test_reset_progress_deletes_word_stats_scoped_to_user_and_bank():
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{"id": _BANK, "code": "L14", "is_published": True}],
        ("quiz_word_stats", "delete"): [],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.reset_progress(user_id=_USER, bank_id=_BANK)
    assert out == {"ok": True}
    d = next(c for c in fake.calls if c["table"] == "quiz_word_stats" and c["op"] == "delete")
    assert ("user_id", _USER) in d["filters"]
    assert ("bank_id", _BANK) in d["filters"]
    # history tables must never be touched by a reset
    assert not any(c["table"] in ("quiz_sessions", "quiz_attempts") for c in fake.calls)


def test_reset_progress_404_when_bank_unpublished():
    fake = _FakeSupabase(responses={
        ("quiz_banks", "select"): [{"id": _BANK, "is_published": False}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as e:
            quiz_service.reset_progress(user_id=_USER, bank_id=_BANK)
    assert e.value.status_code == 404
    assert not any(c["table"] == "quiz_word_stats" for c in fake.calls)


# ── progress logging ─────────────────────────────────────────────────

def _session_resp(user_id=_USER):
    return {("quiz_sessions", "select"): [{"id": _SESS, "user_id": user_id, "bank_id": _BANK}]}


def test_log_progress_rejects_foreign_session():
    fake = _FakeSupabase(responses=_session_resp(user_id=_OTHER))
    with patch.object(quiz_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as e:
            quiz_service.log_progress(user_id=_USER, session_id=_SESS, attempts=[], word_stats=[])
    assert e.value.status_code == 403


def test_log_progress_rejects_an_already_ended_session():
    fake = _FakeSupabase(responses={
        ("quiz_sessions", "select"): [{
            "id": _SESS, "user_id": _USER, "bank_id": _BANK,
            "ended_at": "2026-09-15T10:00:00+00:00",
            "ended_by": "completed",
        }],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as error:
            quiz_service.log_progress(
                user_id=_USER, session_id=_SESS,
                attempts=[{"item_key": "x", "is_correct": True}], word_stats=[],
            )
    assert error.value.status_code == 409
    assert not any(call["table"] == "quiz_attempts" for call in fake.calls)


def test_log_progress_rejects_course_answers_after_server_timer_expiry():
    fake = _FakeSupabase(responses={
        ("quiz_sessions", "select"): [{
            "id": _SESS, "user_id": _USER, "bank_id": _BANK,
            "class_assignment_item_id": "item-timed",
            "ended_at": None, "ended_by": None,
        }],
        ("class_assignment_items", "select"): [{
            "id": "item-timed", "assignment_id": "asg-timed",
            "opened_at": "2000-01-01T00:00:00+00:00", "submitted_at": None,
        }],
        ("class_assignments", "select"): [{
            "id": "asg-timed", "skill": "course",
            "status": "published", "publish_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 30},
        }],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as error:
            quiz_service.log_progress(
                user_id=_USER, session_id=_SESS,
                attempts=[{"item_key": "x", "is_correct": True}], word_stats=[],
            )
    assert error.value.status_code == 409
    assert "hết thời gian" in error.value.detail
    assert not any(call["table"] == "quiz_attempts" for call in fake.calls)


def test_timed_course_progress_uses_atomic_admission_timestamp_rpc():
    attempt = {
        "client_id": "33333333-3333-3333-3333-333333333333",
        "item_key": "x", "qid": "q1", "is_correct": True,
        "answer_given": "0", "response_time_ms": 1250, "attempt_no": 1,
    }
    fake = _FakeSupabase(responses={
        ("quiz_sessions", "select"): [{
            "id": _SESS, "user_id": _USER, "bank_id": _BANK,
            "class_assignment_item_id": "item-timed",
            "ended_at": None, "ended_by": None,
        }],
        ("class_assignment_items", "select"): [{
            "id": "item-timed", "assignment_id": "asg-timed",
            "opened_at": "2026-09-15T10:00:00+00:00", "submitted_at": None,
        }],
        ("class_assignments", "select"): [{
            "id": "asg-timed", "skill": "course", "status": "published",
            "publish_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 720},
        }],
        ("rpc", "quiz_insert_timed_course_attempts"): [{
            **attempt, "created_at": "2026-09-15T10:01:00+00:00",
        }],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.log_progress(
            user_id=_USER, session_id=_SESS, attempts=[attempt], word_stats=[],
        )
    assert out["attempts"] == 1
    rpc = next(call for call in fake.calls
               if call["table"] == "rpc:quiz_insert_timed_course_attempts")
    assert rpc["payload"]["p_session_id"] == _SESS
    assert rpc["payload"]["p_attempts"][0]["client_id"] == attempt["client_id"]
    assert not any(call["table"] == "quiz_attempts" and call["op"] == "upsert"
                   for call in fake.calls)


def test_time_cap_can_close_after_an_earlier_assignment_deadline():
    fake = _FakeSupabase(responses={
        ("class_assignment_items", "select"): [{
            "id": "item-timed", "assignment_id": "asg-timed",
            "opened_at": "2026-09-15T01:00:00+00:00",
        }],
        ("class_assignments", "select"): [{
            "id": "asg-timed", "skill": "course", "status": "published",
            "publish_at": None, "due_at": "2026-09-15T01:10:00+00:00",
            "content_config": {"time_limit_minutes": 60},
        }],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        # The assignment no longer accepts ordinary submissions, but time_cap
        # must still seal the session at the earlier canonical boundary.
        quiz_service._assert_course_session_accepting(
            {"class_assignment_item_id": "item-timed"}, "time_cap",
        )


def test_server_reaper_finalizes_an_expired_open_course_attempt():
    fake = _FakeSupabase(responses={("quiz_sessions", "update"): [{"id": _SESS}]})
    rows = {
        "class_assignments": [{
            "id": "asg-timed", "content_id": _BANK, "skill": "course",
            "status": "published", "publish_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 30},
        }],
        "class_assignment_items": [{
            "id": "item-timed", "assignment_id": "asg-timed", "student_id": "student-1",
            "opened_at": "2026-09-15T01:00:00+00:00", "submitted_at": None,
        }],
        "students": [{"id": "student-1", "user_id": _USER}],
        "quiz_sessions": [{
            "id": _SESS, "user_id": _USER, "bank_id": _BANK,
            "class_assignment_item_id": "item-timed", "kind": "run",
            "created_at": "2026-09-15T01:00:00+00:00",
            "ended_at": None, "ended_by": None,
        }],
    }

    def report(table, *_args, **_kwargs):
        return [dict(row) for row in rows[table]]

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_report_pages", side_effect=report), \
         patch.object(quiz_service, "course_verdict", return_value={"timed_out": True}) as verdict:
        out = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:31:00+00:00"),
        )
    assert out == {"examined": 1, "finalized": 1, "failed": 0}
    close = next(call for call in fake.calls
                 if call["table"] == "quiz_sessions" and call["op"] == "update")
    assert close["payload"]["ended_by"] == "time_cap"
    assert close["payload"]["ended_at"] == "2026-09-15T01:30:00+00:00"
    verdict.assert_called_once_with(
        user_id=_USER, bank_id=_BANK, session_ids=[_SESS],
        assignment_item_id="item-timed", timed_out=True,
        _allow_reaper_finalize=True,
    )


def test_server_reaper_finalizes_current_paused_course_attempt():
    """Closing the tab pauses a session; expiry must still settle that work."""
    fake = _FakeSupabase(responses={
        ("quiz_sessions", "update"): [{"id": "paused-current"}],
    })
    rows = {
        "class_assignments": [{
            "id": "asg-timed", "content_id": _BANK, "skill": "course",
            "status": "published", "publish_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 30},
        }],
        "class_assignment_items": [{
            "id": "item-timed", "assignment_id": "asg-timed",
            "student_id": "student-1", "opened_at": "2026-09-15T01:00:00+00:00",
            "submitted_at": None, "passed_at": None, "mastery": None,
        }],
        "students": [{"id": "student-1", "user_id": _USER}],
        "quiz_sessions": [{
            "id": "paused-current", "user_id": _USER, "bank_id": _BANK,
            "class_assignment_item_id": "item-timed", "kind": "run",
            "created_at": "2026-09-15T01:00:00+00:00",
            "ended_at": "2026-09-15T01:10:00+00:00", "ended_by": "paused",
        }],
    }

    def report(table, *_args, **_kwargs):
        return [dict(row) for row in rows[table]]

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_report_pages", side_effect=report), \
         patch.object(quiz_service, "course_verdict",
                      return_value={"timed_out": True}) as verdict:
        out = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:31:00+00:00"),
        )
    assert out == {"examined": 1, "finalized": 1, "failed": 0}
    close = next(call for call in fake.calls
                 if call["table"] == "quiz_sessions" and call["op"] == "update")
    assert close["filters"] == [
        ("id", "paused-current"), ("ended_by", "paused"),
    ]
    assert close["payload"]["ended_by"] == "time_cap"
    verdict.assert_called_once_with(
        user_id=_USER, bank_id=_BANK, session_ids=["paused-current"],
        assignment_item_id="item-timed", timed_out=True,
        _allow_reaper_finalize=True,
    )


def test_server_reaper_excludes_paused_session_replaced_by_newer_same_kind():
    fake = _FakeSupabase(responses={
        ("quiz_sessions", "update"): [{"id": "current-open"}],
    })
    rows = {
        "class_assignments": [{
            "id": "asg-timed", "content_id": _BANK, "skill": "course",
            "status": "published", "publish_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 30},
        }],
        "class_assignment_items": [{
            "id": "item-timed", "assignment_id": "asg-timed",
            "student_id": "student-1", "opened_at": "2026-09-15T01:00:00+00:00",
            "submitted_at": None, "passed_at": None, "mastery": None,
        }],
        "students": [{"id": "student-1", "user_id": _USER}],
        "quiz_sessions": [
            {
                "id": "superseded-paused", "user_id": _USER, "bank_id": _BANK,
                "class_assignment_item_id": "item-timed", "kind": "run",
                "created_at": "2026-09-15T01:00:00+00:00",
                "ended_at": "2026-09-15T01:10:00+00:00", "ended_by": "paused",
            },
            {
                "id": "current-open", "user_id": _USER, "bank_id": _BANK,
                "class_assignment_item_id": "item-timed", "kind": "run",
                "created_at": "2026-09-15T01:20:00+00:00",
                "ended_at": None, "ended_by": None,
            },
        ],
    }

    def report(table, *_args, **_kwargs):
        return [dict(row) for row in rows[table]]

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_report_pages", side_effect=report), \
         patch.object(quiz_service, "course_verdict",
                      return_value={"timed_out": True}) as verdict:
        out = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:31:00+00:00"),
        )
    assert out == {"examined": 1, "finalized": 1, "failed": 0}
    closes = [call for call in fake.calls
              if call["table"] == "quiz_sessions" and call["op"] == "update"]
    assert [call["filters"][0] for call in closes] == [("id", "current-open")]
    verdict.assert_called_once_with(
        user_id=_USER, bank_id=_BANK, session_ids=["current-open"],
        assignment_item_id="item-timed", timed_out=True,
        _allow_reaper_finalize=True,
    )


def test_server_reaper_ignores_passed_item_with_concurrent_orphan_session():
    """A stale tab cannot append a timeout after the canonical pass."""
    fake = _FakeSupabase()
    mastery = {"attempts": [{
        "phase": "run", "pct": 100, "next_action": "passed",
        "at": "2026-09-15T01:20:00+00:00", "sessions": ["winning-session"],
    }]}
    rows = {
        "class_assignments": [{
            "id": "asg-timed", "content_id": _BANK, "skill": "course",
            "status": "published", "publish_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 30},
        }],
        "class_assignment_items": [{
            "id": "item-timed", "assignment_id": "asg-timed",
            "student_id": "student-1", "opened_at": "2026-09-15T01:00:00+00:00",
            "submitted_at": "2026-09-15T01:20:00+00:00",
            "passed_at": "2026-09-15T01:20:00+00:00",
            "score": 100, "mastery": mastery,
        }],
    }
    report_calls = []

    def report(table, *_args, **_kwargs):
        report_calls.append(table)
        return [dict(row) for row in rows[table]]

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_report_pages", side_effect=report), \
         patch.object(quiz_service, "course_verdict") as verdict:
        out = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:31:00+00:00"),
        )
    assert out == {"examined": 0, "finalized": 0, "failed": 0}
    assert report_calls == ["class_assignments", "class_assignment_items"]
    assert mastery["attempts"][-1]["next_action"] == "passed"
    assert not any(call["table"] == "quiz_sessions" and call["op"] == "update"
                   for call in fake.calls)
    verdict.assert_not_called()


def test_server_reaper_seals_pre_verdict_run_orphan_without_replacing_near_pass():
    """A near-pass permits a retake, never a second old full-run verdict."""
    fake = _FakeSupabase(responses={
        ("quiz_sessions", "update"): [{"id": "orphan-open"}],
    })
    mastery = {"attempts": [{
        "phase": "run", "pct": 70, "completed": True,
        "next_action": "retake", "at": "2026-09-15T01:20:00+00:00",
        "sessions": ["near-pass-run"],
    }]}
    rows = {
        "class_assignments": [{
            "id": "asg-timed", "content_id": _BANK, "skill": "course",
            "status": "published", "publish_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 30, "pass_pct": 75},
        }],
        "class_assignment_items": [{
            "id": "item-timed", "assignment_id": "asg-timed",
            "student_id": "student-1", "opened_at": "2026-09-15T01:00:00+00:00",
            "submitted_at": "2026-09-15T01:20:00+00:00", "passed_at": None,
            "mastery": mastery,
        }],
        "students": [{"id": "student-1", "user_id": _USER}],
        "quiz_sessions": [
            {
                "id": "near-pass-run", "user_id": _USER, "bank_id": _BANK,
                "class_assignment_item_id": "item-timed", "kind": "run",
                "created_at": "2026-09-15T01:00:00+00:00",
                "ended_at": "2026-09-15T01:20:00+00:00", "ended_by": "completed",
            },
            {
                "id": "orphan-open", "user_id": _USER, "bank_id": _BANK,
                "class_assignment_item_id": "item-timed", "kind": "run",
                "created_at": "2026-09-15T01:05:00+00:00",
                "ended_at": None, "ended_by": None,
            },
        ],
    }

    def report(table, *_args, **_kwargs):
        return [dict(row) for row in rows[table]]

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_report_pages", side_effect=report), \
         patch.object(quiz_service, "course_verdict") as verdict:
        out = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:31:00+00:00"),
        )
    assert out == {"examined": 1, "finalized": 0, "failed": 0}
    close = next(call for call in fake.calls
                 if call["table"] == "quiz_sessions" and call["op"] == "update")
    assert close["filters"][0] == ("id", "orphan-open")
    assert close["payload"]["ended_by"] == "time_cap"
    assert mastery["attempts"][-1]["next_action"] == "retake"
    verdict.assert_not_called()


def test_server_reaper_skips_settled_timeout_before_session_sweep():
    """A terminal timeout with its receipt leaves no recurring session work."""
    fake = _FakeSupabase()
    mastery = {"attempts": [{
        "phase": "run", "pct": 40,
        "next_action": "timed_out", "at": "2026-09-15T01:30:00+00:00",
        "sessions": ["timeout-winner"],
    }]}
    rows = {
        "class_assignments": [{
            "id": "asg-timed", "content_id": _BANK, "skill": "course",
            "status": "published", "publish_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 30, "pass_pct": 75},
        }],
        "class_assignment_items": [{
            "id": "item-timed", "assignment_id": "asg-timed",
            "student_id": "student-1", "opened_at": "2026-09-15T01:00:00+00:00",
            "submitted_at": "2026-09-15T01:30:00+00:00", "passed_at": None,
            "score": 40, "mastery": mastery,
        }],
        "students": [{"id": "student-1", "user_id": _USER}],
        "quiz_sessions": [
            {
                "id": "timeout-winner", "user_id": _USER, "bank_id": _BANK,
                "class_assignment_item_id": "item-timed", "kind": "run",
                "created_at": "2026-09-15T01:00:00+00:00",
                "ended_at": "2026-09-15T01:30:00+00:00", "ended_by": "time_cap",
            },
            {
                "id": "orphan-open", "user_id": _USER, "bank_id": _BANK,
                "class_assignment_item_id": "item-timed", "kind": "run",
                "created_at": "2026-09-15T01:05:00+00:00",
                "ended_at": None, "ended_by": None,
            },
        ],
    }

    report_calls = []

    def report(table, *_args, **_kwargs):
        report_calls.append(table)
        return [dict(row) for row in rows[table]]

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_report_pages", side_effect=report), \
         patch.object(quiz_service, "course_verdict") as verdict:
        first = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:31:00+00:00"),
        )
        second = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:32:00+00:00"),
        )
    assert first == {"examined": 0, "finalized": 0, "failed": 0}
    assert second == {"examined": 0, "finalized": 0, "failed": 0}
    assert report_calls == [
        "class_assignments", "class_assignment_items",
        "class_assignments", "class_assignment_items",
    ]
    assert not any(call["table"] == "quiz_sessions" for call in fake.calls)
    assert mastery["attempts"][-1]["next_action"] == "timed_out"
    verdict.assert_not_called()


@pytest.mark.parametrize(
    ("orphan_ended_by", "orphan_ended_at"),
    [(None, None), ("paused", "2026-09-15T01:25:00+00:00")],
)
def test_server_reaper_preserves_lost_on_time_verdict_with_run_orphan(
    orphan_ended_by, orphan_ended_at,
):
    """A complete tab wins even when another run is open or paused."""
    fake = _FakeSupabase(responses={
        ("quiz_sessions", "update"): [{"id": "orphan-open"}],
    })
    completed = {
        "id": "completed-full-run", "user_id": _USER, "bank_id": _BANK,
        "class_assignment_item_id": "item-timed", "kind": "run",
        "created_at": "2026-09-15T01:00:00+00:00",
        "ended_at": "2026-09-15T01:29:00+00:00", "ended_by": "completed",
    }
    orphan = {
        "id": "orphan-open", "user_id": _USER, "bank_id": _BANK,
        "class_assignment_item_id": "item-timed", "kind": "run",
        "created_at": "2026-09-15T01:05:00+00:00",
        "ended_at": orphan_ended_at, "ended_by": orphan_ended_by,
    }
    rows = {
        "class_assignments": [{
            "id": "asg-timed", "content_id": _BANK, "skill": "course",
            "status": "published", "publish_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 30},
        }],
        "class_assignment_items": [{
            "id": "item-timed", "assignment_id": "asg-timed",
            "student_id": "student-1", "opened_at": "2026-09-15T01:00:00+00:00",
            "submitted_at": None, "passed_at": None, "mastery": None,
        }],
        "students": [{"id": "student-1", "user_id": _USER}],
        "quiz_sessions": [completed, orphan],
    }

    def report(table, *_args, **_kwargs):
        return [dict(row) for row in rows[table]]

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_report_pages", side_effect=report), \
         patch.object(quiz_service, "_course_bank_shape",
                      return_value=({"q1", "q2"}, 0, True)), \
         patch.object(quiz_service, "_course_answered_qids",
                      return_value={"q1", "q2"}) as answered, \
         patch.object(quiz_service, "course_verdict",
                      return_value={"passed": True}) as verdict:
        out = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:31:00+00:00"),
        )

    assert out == {"examined": 1, "finalized": 1, "failed": 0}
    answered.assert_called_once_with(["completed-full-run"])
    closes = [call for call in fake.calls
              if call["table"] == "quiz_sessions" and call["op"] == "update"]
    assert len(closes) == 1
    assert closes[0]["filters"][0] == ("id", "orphan-open")
    verdict.assert_called_once_with(
        user_id=_USER, bank_id=_BANK,
        session_ids=["completed-full-run"],
        assignment_item_id="item-timed", timed_out=True,
        _allow_reaper_finalize=True,
    )


def test_server_reaper_preserves_on_time_verdict_after_orphan_was_sealed():
    """A retry sweep must not mix a sealed orphan into an on-time full run."""
    fake = _FakeSupabase(responses={
        ("quiz_sessions", "update"): [{"id": "orphan-open"}],
    })
    completed = {
        "id": "completed-full-run", "user_id": _USER, "bank_id": _BANK,
        "class_assignment_item_id": "item-timed", "kind": "run",
        "created_at": "2026-09-15T01:00:00+00:00",
        "ended_at": "2026-09-15T01:29:00+00:00", "ended_by": "completed",
    }
    orphan = {
        "id": "orphan-open", "user_id": _USER, "bank_id": _BANK,
        "class_assignment_item_id": "item-timed", "kind": "run",
        "created_at": "2026-09-15T01:05:00+00:00",
        "ended_at": None, "ended_by": None,
    }
    rows = {
        "class_assignments": [{
            "id": "asg-timed", "content_id": _BANK, "skill": "course",
            "status": "published", "publish_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 30},
        }],
        "class_assignment_items": [{
            "id": "item-timed", "assignment_id": "asg-timed",
            "student_id": "student-1", "opened_at": "2026-09-15T01:00:00+00:00",
            "submitted_at": None, "passed_at": None, "mastery": None,
        }],
        "students": [{"id": "student-1", "user_id": _USER}],
        "quiz_sessions": [completed, orphan],
    }

    def report(table, *_args, **_kwargs):
        return [dict(row) for row in rows[table]]

    calls = 0

    def verdict(**kwargs):
        nonlocal calls
        calls += 1
        assert kwargs["session_ids"] == ["completed-full-run"]
        if calls == 1:
            # The session close commits before a transient verdict failure.
            orphan.update({
                "ended_at": "2026-09-15T01:30:00+00:00",
                "ended_by": "time_cap",
            })
            raise HTTPException(500, "transient verdict failure")
        return {"passed": True}

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_report_pages", side_effect=report), \
         patch.object(quiz_service, "_course_bank_shape",
                      return_value=({"q1", "q2"}, 0, True)), \
         patch.object(quiz_service, "_course_answered_qids",
                      return_value={"q1", "q2"}), \
         patch.object(quiz_service, "course_verdict", side_effect=verdict) as mocked:
        first = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:31:00+00:00"),
        )
        second = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:32:00+00:00"),
        )

    assert first == {"examined": 1, "finalized": 0, "failed": 1}
    assert second == {"examined": 1, "finalized": 1, "failed": 0}
    assert mocked.call_count == 2
    closes = [call for call in fake.calls
              if call["table"] == "quiz_sessions" and call["op"] == "update"]
    assert len(closes) == 1


def test_server_reaper_repairs_submitted_item_when_verdict_was_lost():
    fake = _FakeSupabase()
    rows = {
        "class_assignments": [{
            "id": "asg-timed", "content_id": _BANK, "skill": "course",
            "status": "published", "publish_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 30},
        }],
        "class_assignment_items": [{
            "id": "item-timed", "assignment_id": "asg-timed", "student_id": "student-1",
            "opened_at": "2026-09-15T01:00:00+00:00",
            "submitted_at": "2026-09-15T01:29:59+00:00", "mastery": None,
        }],
        "students": [{"id": "student-1", "user_id": _USER}],
        "quiz_sessions": [{
            "id": _SESS, "user_id": _USER, "bank_id": _BANK,
            "class_assignment_item_id": "item-timed", "kind": "run",
            "created_at": "2026-09-15T01:00:00+00:00",
            "ended_at": "2026-09-15T01:29:59+00:00", "ended_by": "completed",
        }],
    }

    def report(table, *_args, **_kwargs):
        return [dict(row) for row in rows[table]]

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_report_pages", side_effect=report), \
         patch.object(quiz_service, "course_verdict", return_value={"passed": True}) as verdict:
        out = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:31:00+00:00"),
        )
    assert out == {"examined": 1, "finalized": 1, "failed": 0}
    verdict.assert_called_once()


def test_server_reaper_retries_receipt_after_timeout_ledger_was_saved():
    """A failed mark_item_submitted must not make the next sweep skip forever."""
    fake = _FakeSupabase()
    item = {
        "id": "item-timed", "assignment_id": "asg-timed",
        "student_id": "student-1", "opened_at": "2026-09-15T01:00:00+00:00",
        "submitted_at": None, "passed_at": None, "mastery": None,
    }
    session = {
        "id": _SESS, "user_id": _USER, "bank_id": _BANK,
        "class_assignment_item_id": "item-timed", "kind": "run",
        "created_at": "2026-09-15T01:00:00+00:00",
        "ended_at": None, "ended_by": None,
    }
    rows = {
        "class_assignments": [{
            "id": "asg-timed", "content_id": _BANK, "skill": "course",
            "status": "published", "publish_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 30},
        }],
        "class_assignment_items": [item],
        "students": [{"id": "student-1", "user_id": _USER}],
        "quiz_sessions": [session],
    }

    def report(table, *_args, **_kwargs):
        return [dict(row) for row in rows[table]]

    calls = 0

    def verdict(**_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            # Simulate verdict ledger persistence followed by a transient
            # submission-receipt failure.
            item["mastery"] = {"attempts": [{
                "phase": "run", "pct": 0, "timed_out": True,
                "next_action": "timed_out", "sessions": [_SESS],
                "at": "2026-09-15T01:30:00+00:00",
            }]}
            session.update({
                "ended_at": "2026-09-15T01:30:00+00:00",
                "ended_by": "time_cap",
            })
            raise HTTPException(500, "receipt write failed")
        item["submitted_at"] = "2026-09-15T01:31:01+00:00"
        return {"timed_out": True}

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_report_pages", side_effect=report), \
         patch.object(quiz_service, "course_verdict", side_effect=verdict) as mocked:
        first = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:31:00+00:00"),
        )
        second = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:32:00+00:00"),
        )
    assert first == {"examined": 1, "finalized": 0, "failed": 1}
    assert second == {"examined": 1, "finalized": 1, "failed": 0}
    assert mocked.call_count == 2
    assert mocked.call_args.kwargs["session_ids"] == [_SESS]
    assert item["submitted_at"] is not None


def test_server_reaper_finalizes_expired_item_after_assignment_is_archived():
    fake = _FakeSupabase()
    rows = {
        "class_assignments": [{
            "id": "asg-timed", "content_id": _BANK, "skill": "course",
            "status": "archived", "publish_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 30},
        }],
        "class_assignment_items": [{
            "id": "item-timed", "assignment_id": "asg-timed",
            "student_id": "student-1", "opened_at": "2026-09-15T01:00:00+00:00",
            "submitted_at": None, "mastery": None,
        }],
        "students": [{"id": "student-1", "user_id": _USER}],
        "quiz_sessions": [{
            "id": _SESS, "user_id": _USER, "bank_id": _BANK,
            "class_assignment_item_id": "item-timed", "kind": "run",
            "created_at": "2026-09-15T01:00:00+00:00",
            "ended_at": None, "ended_by": None,
        }],
    }

    def report(table, *_args, **_kwargs):
        return [dict(row) for row in rows[table]]

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_report_pages", side_effect=report), \
         patch.object(quiz_service, "course_verdict", return_value={"timed_out": True}) as verdict:
        out = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:31:00+00:00"),
        )
    assert out == {"examined": 1, "finalized": 1, "failed": 0}
    verdict.assert_called_once_with(
        user_id=_USER, bank_id=_BANK, session_ids=[_SESS],
        assignment_item_id="item-timed", timed_out=True,
        _allow_reaper_finalize=True,
    )


def test_server_reaper_batches_session_reads_for_multiple_items():
    fake = _FakeSupabase()
    rows = {
        "class_assignments": [{
            "id": "asg-timed", "content_id": _BANK, "skill": "course",
            "status": "published", "publish_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 30},
        }],
        "class_assignment_items": [
            {"id": "item-1", "assignment_id": "asg-timed", "student_id": "student-1",
             "opened_at": "2026-09-15T01:00:00+00:00", "mastery": None},
            {"id": "item-2", "assignment_id": "asg-timed", "student_id": "student-2",
             "opened_at": "2026-09-15T01:00:00+00:00", "mastery": None},
        ],
        "students": [
            {"id": "student-1", "user_id": _USER},
            {"id": "student-2", "user_id": _OTHER},
        ],
        "quiz_sessions": [
            {"id": "session-1", "user_id": _USER, "bank_id": _BANK,
             "class_assignment_item_id": "item-1", "kind": "run",
             "created_at": "2026-09-15T01:00:00+00:00",
             "ended_at": "2026-09-15T01:29:00+00:00", "ended_by": "completed"},
            {"id": "session-2", "user_id": _OTHER, "bank_id": _BANK,
             "class_assignment_item_id": "item-2", "kind": "run",
             "created_at": "2026-09-15T01:00:00+00:00",
             "ended_at": "2026-09-15T01:29:00+00:00", "ended_by": "completed"},
        ],
    }
    report_calls = []

    def report(table, *_args, **_kwargs):
        report_calls.append(table)
        return [dict(row) for row in rows[table]]

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_report_pages", side_effect=report), \
         patch.object(quiz_service, "course_verdict", return_value={"passed": False}) as verdict:
        out = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:31:00+00:00"),
        )
    assert out == {"examined": 2, "finalized": 2, "failed": 0}
    assert report_calls.count("quiz_sessions") == 1
    assert verdict.call_count == 2


def test_server_reaper_selects_newest_pending_retake_across_tabs():
    fake = _FakeSupabase()
    rows = {
        "class_assignments": [{
            "id": "asg-timed", "content_id": _BANK, "skill": "course",
            "status": "published", "publish_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 30},
        }],
        "class_assignment_items": [{
            "id": "item-timed", "assignment_id": "asg-timed",
            "student_id": "student-1", "opened_at": "2026-09-15T01:00:00+00:00",
            "mastery": {"attempts": [{
                "phase": "run", "at": "2026-09-15T01:10:00+00:00",
                "sessions": ["run-recorded"], "next_action": "retake",
            }]},
        }],
        "students": [{"id": "student-1", "user_id": _USER}],
        "quiz_sessions": [
            {"id": "retake-old", "user_id": _USER, "bank_id": _BANK,
             "class_assignment_item_id": "item-timed", "kind": "retake",
             "created_at": "2026-09-15T01:20:00+00:00",
             "ended_at": None, "ended_by": None},
            {"id": "retake-new", "user_id": _USER, "bank_id": _BANK,
             "class_assignment_item_id": "item-timed", "kind": "retake",
             "created_at": "2026-09-15T01:25:00+00:00",
             "ended_at": None, "ended_by": None},
        ],
    }

    def report(table, *_args, **_kwargs):
        return [dict(row) for row in rows[table]]

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_report_pages", side_effect=report), \
         patch.object(quiz_service, "course_verdict", return_value={"timed_out": True}) as verdict:
        out = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:31:00+00:00"),
        )
    assert out == {"examined": 1, "finalized": 1, "failed": 0}
    closes = [call for call in fake.calls
              if call["table"] == "quiz_sessions" and call["op"] == "update"]
    assert len(closes) == 2
    verdict.assert_called_once_with(
        user_id=_USER, bank_id=_BANK, session_ids=["retake-new"],
        assignment_item_id="item-timed", timed_out=True,
        _allow_reaper_finalize=True,
    )


def test_server_reaper_uses_only_current_full_retry_generation():
    fake = _FakeSupabase()
    rows = {
        "class_assignments": [{
            "id": "asg-timed", "content_id": _BANK, "skill": "course",
            "status": "published", "publish_at": None, "due_at": None,
            "content_config": {"time_limit_minutes": 30, "pass_pct": 75},
        }],
        "class_assignment_items": [{
            "id": "item-timed", "assignment_id": "asg-timed",
            "student_id": "student-1", "opened_at": "2026-09-15T01:00:00+00:00",
            "submitted_at": "2026-09-15T01:10:00+00:00",
            "mastery": {
                "attempts": [{
                    "phase": "run", "at": "2026-09-15T01:10:00+00:00",
                    "sessions": ["recorded-run"], "next_action": "retry_full",
                }],
                "section_attempt_started_at": "2026-09-15T01:15:00+00:00",
            },
        }],
        "students": [{"id": "student-1", "user_id": _USER}],
        "quiz_sessions": [
            {"id": "superseded-retake-a", "user_id": _USER, "bank_id": _BANK,
             "class_assignment_item_id": "item-timed", "kind": "retake",
             "created_at": "2026-09-15T01:05:00+00:00",
             "ended_at": None, "ended_by": None},
            {"id": "superseded-retake-b", "user_id": _USER, "bank_id": _BANK,
             "class_assignment_item_id": "item-timed", "kind": "retake",
             "created_at": "2026-09-15T01:08:00+00:00",
             "ended_at": None, "ended_by": None},
            {"id": "stale-open", "user_id": _USER, "bank_id": _BANK,
             "class_assignment_item_id": "item-timed", "kind": "run",
             "created_at": "2026-09-15T01:05:00+00:00",
             "ended_at": None, "ended_by": None},
            {"id": "superseded-paused", "user_id": _USER, "bank_id": _BANK,
             "class_assignment_item_id": "item-timed", "kind": "run",
             "created_at": "2026-09-15T01:18:00+00:00",
             "ended_at": "2026-09-15T01:19:00+00:00", "ended_by": "paused"},
            {"id": "current-partial", "user_id": _USER, "bank_id": _BANK,
             "class_assignment_item_id": "item-timed", "kind": "run",
             "created_at": "2026-09-15T01:20:00+00:00",
             "ended_at": None, "ended_by": None},
        ],
    }

    def report(table, *_args, **_kwargs):
        return [dict(row) for row in rows[table]]

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_report_pages", side_effect=report), \
         patch.object(quiz_service, "course_verdict", return_value={"timed_out": True}) as verdict:
        out = quiz_service.reap_expired_course_assessments(
            15, now=quiz_service._at("2026-09-15T01:31:00+00:00"),
        )
    assert out == {"examined": 1, "finalized": 1, "failed": 0}
    closes = [call for call in fake.calls
              if call["table"] == "quiz_sessions" and call["op"] == "update"]
    assert len(closes) == 1
    assert closes[0]["filters"][0] == ("id", "current-partial")
    verdict.assert_called_once_with(
        user_id=_USER, bank_id=_BANK, session_ids=["current-partial"],
        assignment_item_id="item-timed", timed_out=True,
        _allow_reaper_finalize=True,
    )


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


def test_log_progress_coerces_fractional_response_time_ms():
    """Prod 22P02 repro: the client sends response_time_ms as a float ms delta
    (performance.now(), e.g. 5491.2999…) but the column is INT — an uncoerced
    float 500s the whole attempts batch and silently loses progress. The write
    must round it to an int (and same for attempt_no)."""
    fake = _FakeSupabase(responses=_session_resp())
    attempts = [{
        "client_id": "c-1", "item_key": "Vocation", "qid": "v1", "skill": "meaning",
        "is_correct": True, "response_time_ms": 5491.299999952316, "attempt_no": 2.0,
    }]
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.log_progress(user_id=_USER, session_id=_SESS, attempts=attempts, word_stats=[])
    assert out["attempts"] == 1
    a_up = next(c for c in fake.calls if c["table"] == "quiz_attempts" and c["op"] == "upsert")
    row = a_up["payload"][0]
    assert row["response_time_ms"] == 5491 and isinstance(row["response_time_ms"], int)
    assert row["attempt_no"] == 2 and isinstance(row["attempt_no"], int)


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
    assert ("not_is", "ended_at", "null") in upd["filters"]
    assert ("not_is", "ended_by", "null") in upd["filters"]


def test_end_session_defaults_bad_ended_by():
    fake = _FakeSupabase(responses={**_session_resp(), ("quiz_sessions", "update"): [{}]})
    with patch.object(quiz_service, "supabase_admin", fake):
        quiz_service.end_session(user_id=_USER, session_id=_SESS, data={"ended_by": "nonsense"})
    upd = next(c for c in fake.calls if c["table"] == "quiz_sessions" and c["op"] == "update")
    assert upd["payload"]["ended_by"] == "completed"
    assert upd["payload"]["accuracy"] is None             # 0 questions → None


def test_end_session_does_not_reclose_an_on_time_completed_session():
    canonical = {
        "id": _SESS, "user_id": _USER, "bank_id": _BANK,
        "class_assignment_item_id": "item-timed",
        "ended_at": "2026-09-15T01:29:59+00:00", "ended_by": "completed",
        "total_questions": 10, "total_correct": 8,
    }
    fake = _FakeSupabase(responses={
        ("quiz_sessions", "select"): [canonical],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.end_session(
            user_id=_USER, session_id=_SESS,
            data={"ended_by": "time_cap", "total_questions": 10, "total_correct": 0},
        )
    assert out == canonical
    assert not any(call["table"] == "quiz_sessions" and call["op"] == "update"
                   for call in fake.calls)


def test_time_cap_atomically_includes_the_final_pending_attempts():
    open_session = {
        "id": _SESS, "user_id": _USER, "bank_id": _BANK,
        "class_assignment_item_id": "item-timed",
        "ended_at": None, "ended_by": None,
    }
    canonical = {
        **open_session,
        "ended_at": "2026-09-15T01:30:00+00:00", "ended_by": "time_cap",
        "total_questions": 10, "total_correct": 7,
    }
    attempt = {
        "client_id": "33333333-3333-3333-3333-333333333333",
        "item_key": "x", "qid": "q-final", "is_correct": True,
        "answer_given": "4", "response_time_ms": 59_100.8, "attempt_no": 1.0,
    }
    fake = _FakeSupabase(responses={
        ("rpc", "quiz_finalize_timed_course_session"): [canonical],
    })

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_owned_session", return_value=open_session):
        out = quiz_service.end_session(
            user_id=_USER, session_id=_SESS,
            data={
                "ended_by": "time_cap", "duration_sec": 1800,
                "total_questions": 10, "total_correct": 7, "total_wrong": 3,
                "attempts": [attempt],
            },
        )

    assert out == canonical
    rpc = next(call for call in fake.calls
               if call["table"] == "rpc:quiz_finalize_timed_course_session")
    assert rpc["payload"]["p_session_id"] == _SESS
    assert rpc["payload"]["p_user_id"] == _USER
    assert rpc["payload"]["p_attempts"][0]["qid"] == "q-final"
    assert rpc["payload"]["p_attempts"][0]["response_time_ms"] == 59101
    assert rpc["payload"]["p_summary"]["total_correct"] == 7
    assert not any(call["table"] == "quiz_sessions" and call["op"] == "update"
                   for call in fake.calls)


def test_time_cap_terminal_retry_proves_final_attempts_are_persisted():
    """A reaper-won race must enter the row-locked RPC, not return 200 early."""
    terminal = {
        "id": _SESS, "user_id": _USER, "bank_id": _BANK,
        "class_assignment_item_id": "item-timed",
        "ended_at": "2026-09-15T01:30:00+00:00", "ended_by": "time_cap",
    }
    attempt = {
        "client_id": "33333333-3333-3333-3333-333333333333",
        "item_key": "x", "qid": "q-final", "is_correct": True,
        "answer_given": "4", "response_time_ms": 59_100, "attempt_no": 1,
    }
    fake = _FakeSupabase(responses={
        ("rpc", "quiz_finalize_timed_course_session"): [terminal],
    })

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_owned_session", return_value=terminal):
        out = quiz_service.end_session(
            user_id=_USER, session_id=_SESS,
            data={"ended_by": "time_cap", "attempts": [attempt]},
        )

    assert out == terminal
    assert any(call["table"] == "rpc:quiz_finalize_timed_course_session"
               for call in fake.calls)


def test_time_cap_terminal_retry_rejects_an_unpersisted_final_batch():
    terminal = {
        "id": _SESS, "user_id": _USER, "bank_id": _BANK,
        "class_assignment_item_id": "item-timed",
        "ended_at": "2026-09-15T01:30:00+00:00", "ended_by": "time_cap",
    }
    attempt = {
        "client_id": "33333333-3333-3333-3333-333333333333",
        "item_key": "x", "qid": "q-final", "is_correct": True,
    }
    fake = _FakeSupabase(responses={
        ("rpc", "quiz_finalize_timed_course_session"):
            Exception("timed_course_final_batch_missing"),
    })

    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_owned_session", return_value=terminal), \
         pytest.raises(HTTPException) as exc_info:
        quiz_service.end_session(
            user_id=_USER, session_id=_SESS,
            data={"ended_by": "time_cap", "attempts": [attempt]},
        )

    assert exc_info.value.status_code == 409
    assert "trước khi batch" in exc_info.value.detail


@pytest.mark.parametrize(("requested", "winner"), [
    ("completed", "time_cap"),
    ("time_cap", "completed"),
])
def test_end_session_concurrent_terminal_write_preserves_the_winner(requested, winner):
    open_session = {
        "id": _SESS, "user_id": _USER, "bank_id": _BANK,
        "ended_at": None, "ended_by": None,
    }
    canonical = {
        **open_session,
        "ended_at": "2026-09-15T01:30:00+00:00", "ended_by": winner,
    }
    fake = _FakeSupabase(responses={
        # Empty update representation means the terminal-null CAS lost.
        ("quiz_sessions", "update"): [],
    })
    with patch.object(quiz_service, "supabase_admin", fake), \
         patch.object(quiz_service, "_owned_session",
                      side_effect=[open_session, canonical]):
        out = quiz_service.end_session(
            user_id=_USER, session_id=_SESS,
            data={"ended_by": requested, "total_questions": 10},
        )
    assert out["ended_by"] == winner
    updates = [call for call in fake.calls
               if call["table"] == "quiz_sessions" and call["op"] == "update"]
    assert len(updates) == 1
    assert ("not_is", "ended_at", "null") in updates[0]["filters"]
    assert ("not_is", "ended_by", "null") in updates[0]["filters"]


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
        # The lifetime total is a DISTINCT word count (see mastered_item_keys),
        # so it reads the rows rather than summing the per-bank aggregate.
        ("quiz_word_stats", "select"): [{"item_key": "Tenure"}, {"item_key": "Commute"}],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.student_progress(_USER)
    assert len(out["banks"]) == 1
    b = out["banks"][0]
    assert b["code"] == "L14" and b["mastered"] == 2 and b["in_progress"] == 1
    assert b["words_count"] == 29
    assert out["recent_sessions"][0]["accuracy"] == 0.8
    session_reads = [c for c in fake.calls if c["table"] == "quiz_sessions" and c["op"] == "select"]
    assert any(("not_is", "ended_at", "null") in c["filters"] for c in session_reads), \
        "recent_sessions phải lọc phiên chưa kết thúc trước LIMIT"
    # Lifetime totals — the abandoned (ended_at-less) session is EXCLUDED so the
    # count isn't inflated by opening the quiz and leaving.
    t = out["totals"]
    assert t["sessions"] == 1
    assert t["time_sec"] == 120
    assert t["words_mastered"] == 2          # distinct words, not summed bank rows
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


# ── skill scoping on the LEARNER's own progress (audit 2026-07-28 §C3) ────────


def test_student_progress_scopes_banks_and_sessions_by_skill_area():
    """The vocab entry point ("📊 Tiến độ luyện tập" on the Vocabulary page) must
    not list the learner's grammar banks or grammar sessions. admin_student_detail
    already scoped its view; the learner's own did not."""
    fake = _FakeSupabase(responses={
        ("rpc", "quiz_user_bank_progress"): [
            {"bank_id": "v1", "mastered": 5, "in_progress": 1},
            {"bank_id": "g1", "mastered": 9, "in_progress": 0},
        ],
        ("quiz_banks", "select"): [
            {"id": "v1", "code": "L08", "title": "Env", "skill_area": "vocab", "words_count": 24},
            {"id": "g1", "code": "G01", "title": "Tenses", "skill_area": "grammar", "words_count": 12},
        ],
        ("quiz_sessions", "select"): [{"code": "L08", "accuracy": 0.9, "ended_at": "2026-07-01"}],
        # Only the vocab bank's words — the scoped read never asks for g1's.
        ("quiz_word_stats", "select"): [
            {"item_key": "Carbon footprint"}, {"item_key": "Biodiversity"},
            {"item_key": "Gridlock"}, {"item_key": "Mobility"}, {"item_key": "Emission"},
        ],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.student_progress(_USER, skill_area="vocab")

    assert [b["code"] for b in out["banks"]] == ["L08"]
    # Grammar mastery must not leak into the headline number either.
    assert out["totals"]["words_mastered"] == 5
    # Sessions are scoped by bank_id (before the 20-row cap), not by `code`.
    assert any(c["table"] == "quiz_sessions"
               and any(f[0] == "in" and f[1] == "bank_id" for f in c["filters"])
               for c in fake.calls)


def test_student_progress_unscoped_keeps_every_skill():
    """No skill_area → unchanged behaviour (the /api/quiz/progress default)."""
    fake = _FakeSupabase(responses={
        ("rpc", "quiz_user_bank_progress"): [
            {"bank_id": "v1", "mastered": 5, "in_progress": 1},
            {"bank_id": "g1", "mastered": 9, "in_progress": 0},
        ],
        ("quiz_banks", "select"): [
            {"id": "v1", "code": "L08", "skill_area": "vocab"},
            {"id": "g1", "code": "G01", "skill_area": "grammar"},
        ],
        ("quiz_sessions", "select"): [],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.student_progress(_USER)
    assert sorted(b["code"] for b in out["banks"]) == ["G01", "L08"]


def test_bank_ids_for_skill_fails_closed_on_db_error():
    """A lookup failure must 500, never fall through to an UNSCOPED read — a
    vocabulary surface silently showing grammar practice is the bug being fixed."""
    fake = _FakeSupabase(responses={("quiz_banks", "select"): RuntimeError("boom")})
    with patch.object(quiz_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as e:
            quiz_service._bank_ids_for_skill("vocab")
    assert e.value.status_code == 500


# ── mistakes review (audit 2026-07-28 §C2) ───────────────────────────────────


def _mistakes_fake(over=None):
    responses = {
        ("quiz_attempts", "select"): [
            {"bank_id": _BANK, "item_key": "Gridlock", "qid": "gridlock_v1",
             "skill": "meaning", "type": "mcq", "answer_given": "2",
             "created_at": "2026-07-20T10:00:00+00:00"},
            {"bank_id": _BANK, "item_key": "Gridlock", "qid": "gridlock_v1",
             "skill": "meaning", "type": "mcq", "answer_given": "0",
             "created_at": "2026-07-19T10:00:00+00:00"},
            {"bank_id": _BANK, "item_key": "Mobility", "qid": "mobility_v5",
             "skill": "usage", "type": "gap_text", "answer_given": "mobil",
             "created_at": "2026-07-18T10:00:00+00:00"},
        ],
        ("quiz_questions", "select"): [
            {"bank_id": _BANK, "qid": "gridlock_v1", "item_key": "Gridlock",
             "prompt": "Từ **Gridlock** nghĩa là gì?", "input": "choice", "type": "mcq",
             "skill": "meaning", "options": ["A", "B", "C", "D"], "answer": 3,
             "explain": "Gridlock = tắc nghẽn.", "hint": ""},
            {"bank_id": _BANK, "qid": "mobility_v5", "item_key": "Mobility",
             "prompt": "Urban ____ matters.", "input": "text", "type": "gap_text",
             "skill": "usage", "accept": ["mobility"], "explain": "Đáp án: mobility."},
        ],
        ("quiz_banks", "select"): [
            {"id": _BANK, "code": "L11", "title": "Transport", "skill_area": "vocab"}],
        ("quiz_word_stats", "select"): [
            {"bank_id": _BANK, "item_key": "Gridlock", "status": "mastered",
             "wrong_count": 2, "correct_count": 3, "is_difficult": True}],
    }
    responses.update(over or {})
    return _FakeSupabase(responses=responses)


def test_student_mistakes_groups_by_word_and_renders_answers():
    fake = _mistakes_fake()
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.student_mistakes(_USER, skill_area="vocab")

    by_key = {i["item_key"]: i for i in out["items"]}
    assert set(by_key) == {"Gridlock", "Mobility"}
    assert out["total_missed_words"] == 2

    g = by_key["Gridlock"]
    assert g["code"] == "L11" and g["status"] == "mastered" and g["is_difficult"]
    assert len(g["questions"]) == 1          # two attempts on ONE question
    q = g["questions"][0]
    assert q["wrong_times"] == 2
    # quiz_attempts stores the option INDEX; the learner must see the option text.
    assert q["your_answer"] == "C"           # answer_given "2" → options[2]
    assert q["correct_answer"] == "D"        # answer 3 → options[3]
    assert q["explain"] == "Gridlock = tắc nghẽn."

    m = by_key["Mobility"]["questions"][0]
    assert m["your_answer"] == "mobil"       # typed text passes through
    assert m["correct_answer"] == "mobility"  # accept[0]


def test_student_mistakes_keeps_the_latest_wrong_answer_per_question():
    """Newest-first: the answer shown is the most recent wrong one, not the first."""
    fake = _mistakes_fake()
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.student_mistakes(_USER, skill_area="vocab")
    g = next(i for i in out["items"] if i["item_key"] == "Gridlock")
    assert g["questions"][0]["last_wrong_at"] == "2026-07-20T10:00:00+00:00"
    assert g["questions"][0]["your_answer"] == "C"      # the 2026-07-20 answer


def test_student_mistakes_empty_when_skill_has_no_banks():
    fake = _mistakes_fake({("quiz_banks", "select"): []})
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.student_mistakes(_USER, skill_area="vocab")
    assert out == {"items": [], "total_missed_words": 0}


def test_student_mistakes_skips_a_retired_question():
    """A question deleted since the attempt has nothing to show — drop it rather
    than render a card with an empty prompt."""
    fake = _mistakes_fake({("quiz_questions", "select"): []})
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.student_mistakes(_USER, skill_area="vocab")
    assert out["items"] == []


def test_student_mistakes_renders_boolean_and_syllable_answers():
    fake = _mistakes_fake({
        ("quiz_attempts", "select"): [
            {"bank_id": _BANK, "item_key": "X", "qid": "b1", "answer_given": "true",
             "created_at": "2026-07-20T10:00:00+00:00"},
            {"bank_id": _BANK, "item_key": "X", "qid": "s1", "answer_given": "1",
             "created_at": "2026-07-20T09:00:00+00:00"},
        ],
        ("quiz_questions", "select"): [
            {"bank_id": _BANK, "qid": "b1", "item_key": "X", "prompt": "P",
             "input": "boolean", "answer": 0},
            {"bank_id": _BANK, "qid": "s1", "item_key": "X", "prompt": "P2",
             "input": "syllable", "segments": ["au", "ton", "o"], "answer": 2},
        ],
        ("quiz_word_stats", "select"): [],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.student_mistakes(_USER)
    qs = {q["qid"]: q for q in out["items"][0]["questions"]}
    assert qs["b1"]["your_answer"] == "Đúng" and qs["b1"]["correct_answer"] == "Sai"
    assert qs["s1"]["your_answer"] == "ton" and qs["s1"]["correct_answer"] == "o"


def test_totals_words_mastered_counts_distinct_words_not_bank_rows():
    """A word in two lessons is ONE word. Summing the per-bank counts made this
    header disagree with the Vocabulary hub tile (141 vs 136 for one learner)."""
    fake = _FakeSupabase(responses={
        ("rpc", "quiz_user_bank_progress"): [
            {"bank_id": "v1", "mastered": 2, "in_progress": 0},
            {"bank_id": "v2", "mastered": 2, "in_progress": 0},
        ],
        ("quiz_banks", "select"): [
            {"id": "v1", "code": "L11", "skill_area": "vocab"},
            {"id": "v2", "code": "L21", "skill_area": "vocab"},
        ],
        ("quiz_sessions", "select"): [],
        # "Autonomous" is mastered in BOTH lessons.
        ("quiz_word_stats", "select"): [
            {"item_key": "Autonomous"}, {"item_key": "Gridlock"},
            {"item_key": "autonomous"}, {"item_key": "Robotics"},
        ],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.student_progress(_USER, skill_area="vocab")
    assert sum(b["mastered"] for b in out["banks"]) == 4     # per-bank rows
    assert out["totals"]["words_mastered"] == 3              # distinct words


def test_mastered_item_keys_is_empty_without_banks():
    """No banks → no query at all (an unfiltered in_() would read every bank)."""
    fake = _FakeSupabase(responses={("quiz_word_stats", "select"): [{"item_key": "X"}]})
    assert quiz_service.mastered_item_keys(fake, _USER, []) == set()
    assert fake.calls == []


def test_student_mistakes_strips_the_audio_placeholder_from_prompts():
    """`{{audio}}` is a player placeholder, not prompt text. The review screen has
    no 🔊 control to replace it with, so a raw prompt put the literal token in front
    of the learner (16 of 47 cards on real data). Also covers the `**{{audio}}**`
    wrapper: stripping the bare token there would leave `****` behind."""
    fake = _mistakes_fake({
        ("quiz_attempts", "select"): [
            {"bank_id": _BANK, "item_key": "X", "qid": "a1", "answer_given": "sup",
             "created_at": "2026-07-20T10:00:00+00:00"},
            {"bank_id": _BANK, "item_key": "X", "qid": "a2", "answer_given": "sup",
             "created_at": "2026-07-20T09:00:00+00:00"},
        ],
        ("quiz_questions", "select"): [
            {"bank_id": _BANK, "qid": "a1", "item_key": "X", "input": "text",
             "accept": ["surveillance"],
             "prompt": 'Gõ từ tiếng Anh có nghĩa: "Sự giám sát"  {{audio}}'},
            {"bank_id": _BANK, "qid": "a2", "item_key": "X", "input": "text",
             "accept": ["surveillance"],
             "prompt": "Nghe rồi gõ lại. **{{audio}}**"},
        ],
        ("quiz_word_stats", "select"): [],
    })
    with patch.object(quiz_service, "supabase_admin", fake):
        out = quiz_service.student_mistakes(_USER)
    prompts = {q["qid"]: q["prompt"] for q in out["items"][0]["questions"]}
    assert prompts["a1"] == 'Gõ từ tiếng Anh có nghĩa: "Sự giám sát"'
    assert prompts["a2"] == "Nghe rồi gõ lại."
    assert not any("{{" in p or "**" in p for p in prompts.values())
