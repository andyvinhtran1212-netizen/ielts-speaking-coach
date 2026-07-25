"""Tests for services/mock_exam_service.admin_live_monitor — the invigilator's
per-student live view.

The point of this endpoint is what `admin_section_progress` cannot say, so that
is what these pin:

  - the denominator is the COHORT ROSTER, not the sitting count: a student who
    never opened the exam still appears (state 'absent'), instead of vanishing
    and letting 18/18 read as a full house in a class of 20
  - a sitting from someone outside the roster is reported, not hidden
  - per-section state (submitted / working / waiting / absent) and the answer
    count the SERVER actually holds
  - Writing is reported live=False — there is no server-side draft before
    submit, and a real 0 would read as "wrote nothing"
  - retake scopes each student to their own assigned skills
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from tests.test_mock_exam_workflow import FakeSupabase, _seed_exam  # noqa: F401


@pytest.fixture
def fake_db(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr("services.mock_exam_service.supabase_admin", fake)
    monkeypatch.setattr("services.mock_review_workflow.supabase_admin", fake)
    monkeypatch.setattr("services.mock_exam_assignment_service.supabase_admin", fake)
    return fake


@pytest.fixture
def svc():
    from services import mock_exam_service
    return mock_exam_service


def _iso(dt):
    return dt.isoformat()


def _now():
    return datetime.now(timezone.utc)


def _seed_student(fake, cohort_id, name):
    uid = str(uuid4())
    fake.seed("students", {"id": str(uuid4()), "user_id": uid, "cohort_id": cohort_id})
    fake.seed("users", {"id": uid, "display_name": name, "email": None})
    return uid


def _seed_sitting(fake, exam, user_id, **over):
    row = {
        "id": str(uuid4()), "mock_exam_id": exam["id"], "user_id": user_id,
        "status": "lrw_in_progress", "sealed": True,
        "listening_submitted_at": None, "reading_submitted_at": None,
        "writing_submitted_at": None,
        "listening_attempt_id": None, "reading_attempt_id": None,
        "speaking_session_ids": [], "writing_submission": {},
        "assigned_skills": None, "needs_retest": False,
    }
    row.update(over)
    fake.seed("mock_exam_sittings", row)
    return row


def _find(res, name):
    return next(s for s in res["students"] if s["student_name"] == name)


# ── the roster denominator ────────────────────────────────────────────


def test_absent_student_is_reported_not_silently_dropped(fake_db, svc):
    """A cohort member who never opened the exam is the whole reason this
    endpoint exists — section-progress counts sittings, so they disappear."""
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    fake_db.table("mock_exams").update({"active_section": "listening"}).eq(
        "id", exam["id"]).execute()
    came = _seed_student(fake_db, cohort, "An")
    never = _seed_student(fake_db, cohort, "Bình")
    _seed_sitting(fake_db, exam, came)

    res = svc.admin_live_monitor(exam["id"])

    assert res["roster"]["expected"] == 2
    assert res["roster"]["started"] == 1
    assert res["roster"]["not_started"] == ["Bình"]
    assert _find(res, "Bình")["started"] is False
    assert _find(res, "Bình")["sections"]["listening"]["state"] == "absent"
    # and the rollup counts them, so 1/2 can never render as "everyone in"
    assert res["sections"]["listening"]["expected"] == 2
    assert res["sections"]["listening"]["absent"] == 1


def test_expected_is_none_when_exam_has_no_cohort(fake_db, svc):
    """"Unknown roster" and "nobody on the roster" are different answers; the
    console must be able to tell them apart rather than show a fake 0."""
    exam = _seed_exam(fake_db, cohort_id=None)
    _seed_sitting(fake_db, exam, str(uuid4()))
    assert svc.admin_live_monitor(exam["id"])["roster"]["expected"] is None


def test_off_roster_sitting_is_surfaced(fake_db, svc):
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    _seed_student(fake_db, cohort, "An")
    stranger = str(uuid4())
    fake_db.seed("users", {"id": stranger, "display_name": "Người lạ", "email": None})
    _seed_sitting(fake_db, exam, stranger)

    res = svc.admin_live_monitor(exam["id"])
    assert res["roster"]["off_roster"] == ["Người lạ"]
    assert _find(res, "Người lạ")["in_roster"] is False
    # A walk-in must NOT count towards "đã vào thi": the console renders
    # expected - started as "vắng", so counting them here would cancel out the
    # roster member (An) who genuinely never arrived.
    assert res["roster"]["expected"] == 1
    assert res["roster"]["started"] == 0
    assert res["roster"]["not_started"] == ["An"]


# ── per-section state + answer counts ─────────────────────────────────


def test_listening_progress_counts_only_non_empty_answers(fake_db, svc):
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    fake_db.table("mock_exams").update({"active_section": "listening"}).eq(
        "id", exam["id"]).execute()
    uid = _seed_student(fake_db, cohort, "An")
    aid = str(uuid4())
    stamp = _iso(_now())
    fake_db.seed("listening_test_attempts", {
        "id": aid, "status": "in_progress", "answers": [
            {"q_num": 1, "user_answer": "cat", "answered_at": stamp},
            {"q_num": 2, "user_answer": "   ", "answered_at": stamp},   # cleared
            {"q_num": 3, "user_answer": "dog", "answered_at": stamp},
        ],
    })
    # _seed_exam already created this row — UPDATE it, don't seed a second one.
    fake_db.table("listening_tests").update({"total_questions": 40}).eq(
        "id", exam["listening_test_id"]).execute()
    _seed_sitting(fake_db, exam, uid, listening_attempt_id=aid)

    sec = _find(svc.admin_live_monitor(exam["id"]), "An")["sections"]["listening"]
    assert sec["state"] == "working"
    assert sec["answered"] == 2          # not 3 — a blanked field is not progress
    assert sec["total"] == 40
    assert sec["live"] is True


def test_reading_progress_reads_the_autosave_table(fake_db, svc):
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    fake_db.table("mock_exams").update({"active_section": "reading"}).eq(
        "id", exam["id"]).execute()
    uid = _seed_student(fake_db, cohort, "An")
    aid = str(uuid4())
    fake_db.seed("reading_test_attempts", {"id": aid, "status": "in_progress"})
    fake_db.seed("reading_tests", {"id": exam["reading_test_id"], "total_questions": 40})
    for q, ans in ((1, "TRUE"), (2, ""), (3, "FALSE")):
        fake_db.seed("reading_attempt_answers", {
            "attempt_id": aid, "q_num": q, "user_answer": ans,
            "answered_at": _iso(_now()),
        })
    _seed_sitting(fake_db, exam, uid, reading_attempt_id=aid)

    sec = _find(svc.admin_live_monitor(exam["id"]), "An")["sections"]["reading"]
    assert sec["state"] == "working"
    assert sec["answered"] == 2


def test_stalled_flags_a_silent_working_student(fake_db, svc):
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    fake_db.table("mock_exams").update({"active_section": "listening"}).eq(
        "id", exam["id"]).execute()
    uid = _seed_student(fake_db, cohort, "An")
    aid = str(uuid4())
    old = _iso(_now() - timedelta(minutes=12))
    fake_db.seed("listening_test_attempts", {
        "id": aid, "status": "in_progress",
        "answers": [{"q_num": 1, "user_answer": "cat", "answered_at": old}],
    })
    _seed_sitting(fake_db, exam, uid, listening_attempt_id=aid)

    assert _find(svc.admin_live_monitor(exam["id"]), "An")["sections"]["listening"]["stalled"] is True


def test_writing_word_count_is_live_from_the_autosaved_draft(fake_db, svc):
    """Since A2 the essay autosaves to the server mid-section, so the word count
    is a live signal — the same "are they still typing" reading L/R get."""
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    fake_db.table("mock_exams").update({"active_section": "writing"}).eq(
        "id", exam["id"]).execute()
    uid = _seed_student(fake_db, cohort, "An")
    stamp = _iso(_now())
    _seed_sitting(fake_db, exam, uid, writing_submission={
        "task1": {"text": "x " * 120, "word_count": 120, "submitted_at": stamp},
        "task2": {"text": "y " * 40, "word_count": 40, "submitted_at": stamp},
    })

    sec = _find(svc.admin_live_monitor(exam["id"]), "An")["sections"]["writing"]
    assert sec["state"] == "working"
    assert sec["live"] is True
    assert sec["answered"] == 160          # words across both tasks
    assert sec["total"] is None            # Writing has no denominator
    assert sec["last_activity_at"] == stamp


def test_writing_reports_zero_only_once_the_student_is_in_the_section(fake_db, svc):
    """Before the section opens there is no signal at all — a 0 there would read
    as "wrote nothing" for someone who was never given the chance."""
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    fake_db.table("mock_exams").update({"active_section": "listening"}).eq(
        "id", exam["id"]).execute()
    uid = _seed_student(fake_db, cohort, "An")
    _seed_sitting(fake_db, exam, uid)

    secs = _find(svc.admin_live_monitor(exam["id"]), "An")["sections"]
    assert secs["writing"]["state"] == "waiting"
    assert secs["writing"]["answered"] is None

    fake_db.table("mock_exams").update({"active_section": "writing"}).eq(
        "id", exam["id"]).execute()
    sec = _find(svc.admin_live_monitor(exam["id"]), "An")["sections"]["writing"]
    assert sec["state"] == "working"
    assert sec["answered"] == 0            # in the section, nothing written yet


def test_submitted_section_reports_its_timestamp(fake_db, svc):
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    fake_db.table("mock_exams").update({"active_section": "reading"}).eq(
        "id", exam["id"]).execute()
    uid = _seed_student(fake_db, cohort, "An")
    stamp = _iso(_now())
    _seed_sitting(fake_db, exam, uid, listening_submitted_at=stamp)

    secs = _find(svc.admin_live_monitor(exam["id"]), "An")["sections"]
    assert secs["listening"]["state"] == "submitted"
    assert secs["listening"]["submitted_at"] == stamp
    assert secs["writing"]["state"] == "waiting"   # not opened yet


# ── retake ────────────────────────────────────────────────────────────


def test_retake_scopes_each_student_to_assigned_skills(fake_db, svc):
    exam = _seed_exam(fake_db)
    fake_db.table("mock_exams").update({"exam_mode": "retake"}).eq(
        "id", exam["id"]).execute()
    uid = str(uuid4())
    fake_db.seed("users", {"id": uid, "display_name": "An", "email": None})
    fake_db.seed("mock_exam_assignments", {
        "id": str(uuid4()), "exam_id": exam["id"], "user_id": uid,
        "skills": ["writing"], "open_from": None, "open_until": None,
    })
    _seed_sitting(fake_db, exam, uid, assigned_skills=["writing"],
                  writing_started_at=_iso(_now()))

    res = svc.admin_live_monitor(exam["id"])
    assert res["roster"]["expected"] == 1
    row = _find(res, "An")
    assert set(row["sections"]) == {"writing"}      # never told they missed L/R
    assert row["sections"]["writing"]["state"] == "working"


def test_retake_student_who_never_started_shows_waiting_not_working(fake_db, svc):
    exam = _seed_exam(fake_db)
    fake_db.table("mock_exams").update({"exam_mode": "retake"}).eq(
        "id", exam["id"]).execute()
    uid = str(uuid4())
    fake_db.seed("users", {"id": uid, "display_name": "An", "email": None})
    fake_db.seed("mock_exam_assignments", {
        "id": str(uuid4()), "exam_id": exam["id"], "user_id": uid,
        "skills": ["reading"], "open_from": None, "open_until": None,
    })
    _seed_sitting(fake_db, exam, uid, assigned_skills=["reading"])

    row = _find(svc.admin_live_monitor(exam["id"]), "An")
    assert row["sections"]["reading"]["state"] == "waiting"


def test_uncollected_past_section_reads_as_missed_not_waiting(fake_db, svc):
    """B3 — with the straggler sweep queued in the background, a sweep that dies
    (restart mid-task) leaves papers uncollected behind a moved-on exam.
    Reporting that as 'waiting' would read as "not their turn yet" — the exact
    opposite of the truth, and it would hide recoverable lost work."""
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    # exam has walked on to Reading, but Listening was never collected
    fake_db.table("mock_exams").update({"active_section": "reading"}).eq(
        "id", exam["id"]).execute()
    uid = _seed_student(fake_db, cohort, "An")
    _seed_sitting(fake_db, exam, uid)

    res = svc.admin_live_monitor(exam["id"])
    secs = _find(res, "An")["sections"]
    assert secs["listening"]["state"] == "missed"     # behind the exam
    assert secs["reading"]["state"] == "working"      # the open one
    assert secs["writing"]["state"] == "waiting"      # genuinely not yet
    assert res["sections"]["listening"]["missed"] == 1


def test_collected_past_section_is_not_flagged_missed(fake_db, svc):
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    fake_db.table("mock_exams").update({"active_section": "reading"}).eq(
        "id", exam["id"]).execute()
    uid = _seed_student(fake_db, cohort, "An")
    _seed_sitting(fake_db, exam, uid, listening_submitted_at=_iso(_now()))

    res = svc.admin_live_monitor(exam["id"])
    assert _find(res, "An")["sections"]["listening"]["state"] == "submitted"
    assert res["sections"]["listening"]["missed"] == 0


# ── pacing (PR-15) ────────────────────────────────────────────────────


def test_pacing_reconstructs_the_order_answers_landed(fake_db, svc):
    """Every answer write has always stamped answered_at; nobody read them.
    Order + gaps are recoverable with no new collection at all."""
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    start = _now() - timedelta(minutes=10)
    fake_db.table("mock_exams").update({
        "active_section": "listening", "listening_started_at": _iso(start),
    }).eq("id", exam["id"]).execute()
    uid = _seed_student(fake_db, cohort, "An")
    aid = str(uuid4())
    fake_db.seed("listening_test_attempts", {
        "id": aid, "status": "in_progress", "grading_details": [{}] * 40,
        "answers": [
            # answered out of paper order: 1, then 3, then back to 2
            {"q_num": 1, "user_answer": "a", "answered_at": _iso(start + timedelta(seconds=30))},
            {"q_num": 3, "user_answer": "c", "answered_at": _iso(start + timedelta(seconds=50))},
            {"q_num": 2, "user_answer": "b", "answered_at": _iso(start + timedelta(seconds=230))},
        ],
    })
    _seed_sitting(fake_db, exam, uid, listening_attempt_id=aid,
                  listening_submitted_at=_iso(start + timedelta(minutes=8)))

    out = svc.sitting_pacing(_find_sitting_id(fake_db))
    lis = out["sections"]["listening"]

    assert [r["q_num"] for r in lis["timeline"]] == [1, 3, 2]   # landing order
    assert lis["worked_in_paper_order"] is False                # jumped around
    assert lis["timeline"][0]["gap_seconds"] == 30              # from section start
    assert lis["timeline"][2]["gap_seconds"] == 180             # the 3-minute pause
    assert len(lis["long_gaps"]) == 1
    assert lis["answered"] == 3 and lis["total"] == 40


def test_pacing_reports_where_the_work_stopped(fake_db, svc):
    """A big idle tail is a student who gave up (or dropped off) well before
    time — invisible in a raw score."""
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    start = _now() - timedelta(minutes=30)
    fake_db.table("mock_exams").update({
        "active_section": "reading", "reading_started_at": _iso(start),
    }).eq("id", exam["id"]).execute()
    uid = _seed_student(fake_db, cohort, "An")
    aid = str(uuid4())
    fake_db.seed("reading_test_attempts", {"id": aid, "status": "submitted",
                                           "grading_details": [{}] * 40})
    fake_db.seed("reading_attempt_answers", {
        "attempt_id": aid, "q_num": 1, "user_answer": "TRUE",
        "answered_at": _iso(start + timedelta(minutes=2)),
    })
    _seed_sitting(fake_db, exam, uid, reading_attempt_id=aid,
                  reading_submitted_at=_iso(start + timedelta(minutes=20)))

    rd = svc.sitting_pacing(_find_sitting_id(fake_db))["sections"]["reading"]
    assert rd["idle_tail_seconds"] == 18 * 60          # stopped 18 min early
    assert rd["answers_in_final_minutes"] == 0


def test_pacing_states_its_own_caveats(fake_db, svc):
    """answered_at is the LAST touch, so a UI must not present these as exact
    per-question think-time. The payload says so itself."""
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    uid = _seed_student(fake_db, cohort, "An")
    _seed_sitting(fake_db, exam, uid)
    out = svc.sitting_pacing(_find_sitting_id(fake_db))
    assert out["caveats"]["answered_at_is_last_touch"] is True
    assert out["caveats"]["gap_is_time_since_previous_answer"] is True


def test_pacing_missing_sitting_raises(fake_db, svc):
    with pytest.raises(svc.NotFoundError):
        svc.sitting_pacing(str(uuid4()))


def _find_sitting_id(fake):
    return fake.rows("mock_exam_sittings")[0]["id"]


def test_missing_exam_raises_not_found(fake_db, svc):
    with pytest.raises(svc.NotFoundError):
        svc.admin_live_monitor(str(uuid4()))
