"""Tests for A1 — Listening resume after a disconnect.

Before this, the only way into a Listening attempt was POST /attempts, which
abandons the open attempt and mints an empty replacement. Inside a 4-skill mock
the embed auto-clicks start, so a plain refresh destroyed every answer with the
class clock still running and the audio not rewindable.

What these pin:
  - the in-progress lookup returns only the CALLER's open attempt at THAT test
  - blank answers are not reported as recovered progress
  - `section_duration_seconds` is exposed so a resuming runner can derive
    elapsed and seek the audio to where the room already is
  - attach_attempt refuses to trade an attempt holding answers for a blank one
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from tests.test_mock_exam_workflow import FakeSupabase, _seed_exam  # noqa: F401


@pytest.fixture
def fake_db(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr("services.mock_exam_service.supabase_admin", fake)
    monkeypatch.setattr("services.mock_review_workflow.supabase_admin", fake)
    return fake


@pytest.fixture
def svc():
    from services import mock_exam_service
    return mock_exam_service


# ── section_duration_seconds (audio seek anchor) ──────────────────────


def test_section_duration_is_audio_plus_buffer(fake_db, svc):
    """Elapsed = duration − time_left is how the runner finds the room's audio
    position, so the duration must be the real one (audio + buffer)."""
    exam = _seed_exam(fake_db)          # seeds full_audio_duration_seconds=1800
    assert svc.section_duration_seconds(exam, "listening") == 1800 + 120


def test_section_duration_none_outside_a_seated_section(fake_db, svc):
    exam = _seed_exam(fake_db)
    assert svc.section_duration_seconds(exam, "not_started") is None
    assert svc.section_duration_seconds(exam, "done") is None


def test_section_duration_reading_and_writing_from_exam(fake_db, svc):
    exam = _seed_exam(fake_db)
    assert svc.section_duration_seconds(exam, "reading") == 60 * 60
    assert svc.section_duration_seconds(exam, "writing") == 60 * 60


# ── _attempt_has_answers ──────────────────────────────────────────────


def test_listening_answers_read_off_the_attempt_row(fake_db, svc):
    aid = str(uuid4())
    fake_db.seed("listening_test_attempts", {
        "id": aid, "status": "in_progress",
        "answers": [{"q_num": 1, "user_answer": "cat"}],
    })
    assert svc._attempt_has_answers("listening_test_attempts", aid) is True


def test_blank_listening_answers_are_not_progress(fake_db, svc):
    """A row exists the moment a field is touched and cleared — counting it
    would let a blank paper block a legitimate re-bind."""
    aid = str(uuid4())
    fake_db.seed("listening_test_attempts", {
        "id": aid, "status": "in_progress",
        "answers": [{"q_num": 1, "user_answer": "   "}, {"q_num": 2, "user_answer": ""}],
    })
    assert svc._attempt_has_answers("listening_test_attempts", aid) is False


def test_reading_answers_read_off_the_autosave_table(fake_db, svc):
    aid = str(uuid4())
    fake_db.seed("reading_test_attempts", {"id": aid, "status": "in_progress"})
    fake_db.seed("reading_attempt_answers", {
        "attempt_id": aid, "q_num": 1, "user_answer": "TRUE",
    })
    assert svc._attempt_has_answers("reading_test_attempts", aid) is True


def test_missing_attempt_has_no_answers(fake_db, svc):
    assert svc._attempt_has_answers("listening_test_attempts", str(uuid4())) is False
    assert svc._attempt_has_answers("listening_test_attempts", None) is False


# ── attach_attempt: never trade work for a blank page ─────────────────


def _seed_bound_sitting(fake_db, svc, exam, user_id, old_attempt_id, answers):
    fake_db.seed("listening_test_attempts", {
        "id": old_attempt_id, "user_id": str(user_id), "test_id": exam["listening_test_id"],
        "status": "in_progress", "answers": answers,
    })
    sitting = {
        "id": str(uuid4()), "mock_exam_id": exam["id"], "user_id": str(user_id),
        "status": "lrw_in_progress", "sealed": True,
        "listening_attempt_id": old_attempt_id,
    }
    fake_db.seed("mock_exam_sittings", sitting)
    return sitting


def test_attach_refuses_to_replace_answered_attempt_with_blank(fake_db, svc):
    """The exact regression A1 is about: if resume ever fails and the runner
    mints an empty attempt, re-binding would hand the examiner the blank one and
    orphan the student's real answers."""
    exam = _seed_exam(fake_db)
    fake_db.table("mock_exams").update({"active_section": "listening"}).eq(
        "id", exam["id"]).execute()
    user = uuid4()
    old = str(uuid4())
    sitting = _seed_bound_sitting(fake_db, svc, exam, user, old,
                                  [{"q_num": 1, "user_answer": "cat"}])
    blank = str(uuid4())
    fake_db.seed("listening_test_attempts", {
        "id": blank, "user_id": str(user), "test_id": exam["listening_test_id"],
        "status": "in_progress", "answers": [],
    })

    with pytest.raises(svc.SittingConflictError):
        svc.attach_attempt(sitting["id"], user, "listening", blank)

    # the sitting still points at the work
    assert svc.get_sitting(sitting["id"])["listening_attempt_id"] == old


def test_attach_still_allows_rebinding_when_prior_is_blank(fake_db, svc):
    """The legitimate case the guard must not break: the prior attempt holds
    nothing, so swapping to a fresh one loses no work."""
    exam = _seed_exam(fake_db)
    fake_db.table("mock_exams").update({"active_section": "listening"}).eq(
        "id", exam["id"]).execute()
    user = uuid4()
    old = str(uuid4())
    sitting = _seed_bound_sitting(fake_db, svc, exam, user, old, [])
    fresh = str(uuid4())
    fake_db.seed("listening_test_attempts", {
        "id": fresh, "user_id": str(user), "test_id": exam["listening_test_id"],
        "status": "in_progress", "answers": [{"q_num": 3, "user_answer": "dog"}],
    })

    svc.attach_attempt(sitting["id"], user, "listening", fresh)
    assert svc.get_sitting(sitting["id"])["listening_attempt_id"] == fresh


def test_attach_still_blocks_swapping_a_submitted_attempt(fake_db, svc):
    """Pre-existing rule must survive the new guard."""
    exam = _seed_exam(fake_db)
    fake_db.table("mock_exams").update({"active_section": "listening"}).eq(
        "id", exam["id"]).execute()
    user = uuid4()
    old = str(uuid4())
    sitting = _seed_bound_sitting(fake_db, svc, exam, user, old, [])
    fake_db.table("listening_test_attempts").update({"status": "submitted"}).eq(
        "id", old).execute()
    fresh = str(uuid4())
    fake_db.seed("listening_test_attempts", {
        "id": fresh, "user_id": str(user), "test_id": exam["listening_test_id"],
        "status": "in_progress", "answers": [],
    })

    with pytest.raises(svc.SittingConflictError):
        svc.attach_attempt(sitting["id"], user, "listening", fresh)
