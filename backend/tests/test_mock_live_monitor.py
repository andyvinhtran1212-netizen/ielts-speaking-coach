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



def _seed_listening_length(fake_db, test_id, n=40):
    """Give a listening test a REAL length, the way prod stores one.

    `listening_tests` has no total_questions column — mig 065 never defined one,
    and the one in mig 056 belongs to listening_sessions. These tests used to
    write that phantom column onto the fake, which accepts any key, so a green
    suite sat on top of a query that 500'd against the real database
    (prod outage 2026-07-26). The length lives in the exercises' answer key,
    which is also what the grader scores against.
    """
    fake_db.seed("listening_content", {"id": f"sec-{test_id}", "test_id": test_id})
    fake_db.seed("listening_exercises", {
        "id": f"ex-{test_id}", "content_id": f"sec-{test_id}",
        "payload": {"template_kind": "gap_fill",
                    "answers": [{"q_num": i, "accepted": ["x"]} for i in range(1, n + 1)]},
    })


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


def test_no_cohort_exam_does_not_call_everyone_off_roster(fake_db, svc):
    """Codex #833 (correct): returning {} for "no cohort" made `uid in roster`
    False for every real sitting, so the console reported ZERO arrivals and an
    outside-the-list warning while the class was actively sitting the exam."""
    exam = _seed_exam(fake_db, cohort_id=None)
    uid = str(uuid4())
    fake_db.seed("users", {"id": uid, "display_name": "An", "email": None})
    _seed_sitting(fake_db, exam, uid)

    res = svc.admin_live_monitor(exam["id"])
    assert res["roster"]["expected"] is None      # still honestly unknown
    assert res["roster"]["started"] == 1          # ...but they DID arrive
    assert res["roster"]["off_roster"] == []      # nobody can be "outside" it
    assert _find(res, "An")["in_roster"] is True


def test_empty_cohort_is_zero_not_unknown(fake_db, svc):
    """An empty cohort is a real answer. Only a MISSING cohort is unknown."""
    exam = _seed_exam(fake_db, cohort_id=str(uuid4()))
    assert svc.admin_live_monitor(exam["id"])["roster"]["expected"] == 0


def test_cohort_member_without_an_account_still_counts(fake_db, svc):
    """Codex #833 P1 (correct): students.user_id is NULLABLE by design (mig 033
    — "link to user account when student gets login"), so an unactivated cohort
    member is a REAL roster member. Dropping them reproduced the exact bug this
    endpoint exists to kill — a class of 20 with two unactivated reported 18."""
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    activated = _seed_student(fake_db, cohort, "An")
    fake_db.seed("students", {"id": str(uuid4()), "user_id": None,
                              "cohort_id": cohort, "full_name": "Bình chưa kích hoạt"})
    _seed_sitting(fake_db, exam, activated)

    res = svc.admin_live_monitor(exam["id"])
    assert res["roster"]["expected"] == 2                       # not 1
    assert res["roster"]["not_started"] == ["Bình chưa kích hoạt"]
    # name comes off the students row — there is no `users` row to resolve
    row = _find(res, "Bình chưa kích hoạt")
    assert row["started"] is False and row["in_roster"] is True


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
    _seed_listening_length(fake_db, exam["listening_test_id"])
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


def test_working_student_with_no_attempt_counts_as_blank(fake_db, svc):
    """Codex #833 (correct): a student in the OPEN section with no attempt bound
    (runner still loading, or attempt creation failed) left `answered` as None.
    The console's "trắng" filter only matches 0, so the one person who most
    needed checking on was the one the invigilator could not see."""
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    fake_db.table("mock_exams").update({"active_section": "listening"}).eq(
        "id", exam["id"]).execute()
    uid = _seed_student(fake_db, cohort, "An")
    _seed_sitting(fake_db, exam, uid)          # no listening_attempt_id

    sec = _find(svc.admin_live_monitor(exam["id"]), "An")["sections"]["listening"]
    assert sec["state"] == "working"
    assert sec["answered"] == 0                # visible to the problem filter


def test_waiting_student_with_no_attempt_is_not_called_blank(fake_db, svc):
    """Before their section opens there is nothing to be blank about."""
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    fake_db.table("mock_exams").update({"active_section": "listening"}).eq(
        "id", exam["id"]).execute()
    uid = _seed_student(fake_db, cohort, "An")
    _seed_sitting(fake_db, exam, uid)
    assert _find(svc.admin_live_monitor(exam["id"]), "An")["sections"]["reading"]["answered"] is None


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


def test_missed_is_suppressed_while_the_sweep_could_still_be_running(fake_db, svc):
    """Codex #844 (correct): the sweep runs in the BACKGROUND, so immediately
    after /advance every not-yet-processed sitting legitimately has no stamp.
    Flagging those raised the interruption banner on EVERY normal advance and
    offered a "Thu lại" that would start a second concurrent sweep."""
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    # Reading opened seconds ago — the Listening sweep is plausibly still going.
    fake_db.table("mock_exams").update({
        "active_section": "reading",
        "reading_started_at": _iso(_now() - timedelta(seconds=5)),
    }).eq("id", exam["id"]).execute()
    uid = _seed_student(fake_db, cohort, "An")
    _seed_sitting(fake_db, exam, uid)

    res = svc.admin_live_monitor(exam["id"])
    assert _find(res, "An")["sections"]["listening"]["state"] == "waiting"
    assert res["sections"]["listening"]["missed"] == 0     # no false banner


def test_missed_surfaces_once_the_sweep_has_clearly_died(fake_db, svc):
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    fake_db.table("mock_exams").update({
        "active_section": "reading",
        "reading_started_at": _iso(_now() - timedelta(minutes=10)),
    }).eq("id", exam["id"]).execute()
    uid = _seed_student(fake_db, cohort, "An")
    _seed_sitting(fake_db, exam, uid)

    res = svc.admin_live_monitor(exam["id"])
    assert _find(res, "An")["sections"]["listening"]["state"] == "missed"
    assert res["sections"]["listening"]["missed"] == 1


def test_collect_rejects_a_section_the_exam_has_not_reached(fake_db, svc):
    """Codex #844 (correct): preflight only checked the section was CONFIGURED.
    /collect?section=writing while Listening is active would stamp every
    student's future Writing as submitted — taking papers that do not exist."""
    exam = _seed_exam(fake_db)
    fake_db.table("mock_exams").update({"active_section": "listening"}).eq(
        "id", exam["id"]).execute()
    with pytest.raises(svc.SittingConflictError):
        svc.collect_preflight(exam["id"], "writing")
    # the open section and an earlier one are both fine
    assert svc.collect_preflight(exam["id"], "listening")["section"] == "listening"


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


def test_pacing_keeps_timestamped_clears_in_the_timeline(fake_db, svc):
    """Codex #848 (correct): both save paths persist a CLEARED answer with a
    fresh answered_at. Filtering those out made the last touch look older than
    it was, inflated idle_tail_seconds and reconstructed the wrong work order.
    The answered KPI still counts only non-empty values."""
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
            {"q_num": 1, "user_answer": "cat", "answered_at": _iso(start + timedelta(seconds=30))},
            {"q_num": 2, "user_answer": "",    "answered_at": _iso(start + timedelta(seconds=90))},
        ],
    })
    _seed_sitting(fake_db, exam, uid, listening_attempt_id=aid,
                  listening_submitted_at=_iso(start + timedelta(minutes=5)))

    lis = svc.sitting_pacing(_find_sitting_id(fake_db))["sections"]["listening"]
    assert [r["q_num"] for r in lis["timeline"]] == [1, 2]   # the clear is activity
    assert lis["answered"] == 1                              # ...but not an answer
    # last touch is the clear at +90s, so the idle tail is 5min − 90s
    assert lis["idle_tail_seconds"] == 210


def test_pacing_omits_writing_for_an_lr_only_retake(fake_db, svc):
    """assigned_skills is the canonical retake scope; a blank Writing block told
    the teacher the student was missing work nobody asked them for."""
    exam = _seed_exam(fake_db)
    fake_db.table("mock_exams").update({"exam_mode": "retake"}).eq(
        "id", exam["id"]).execute()
    uid = str(uuid4())
    fake_db.seed("users", {"id": uid, "display_name": "An", "email": None})
    _seed_sitting(fake_db, exam, uid, assigned_skills=["reading"])

    out = svc.sitting_pacing(_find_sitting_id(fake_db))
    assert "writing" not in out["sections"]
    assert out["exam_id"] == exam["id"]          # back-link target


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


def test_repeat_attempt_shows_the_live_sitting_not_the_released_one(fake_db, svc):
    """A released attempt sitting alongside a fresh one must not win.

    The one-live-per-user index only covers registered/lrw_in_progress, so a
    student who sat this exam before AND is sitting it again legitimately has
    two non-void rows. Keying by user without ordering kept whichever row came
    back last, which could paint the console with the old attempt's answers.
    """
    exam = _seed_exam(fake_db)
    uid = str(uuid4())
    fake_db.seed("users", {"id": uid, "display_name": "An", "email": None})
    old_stamp = _iso(_now() - timedelta(days=3))
    # seeded LAST so an unordered dict would keep it
    _seed_sitting(fake_db, exam, uid, status="lrw_in_progress",
                  created_at=_iso(_now()))
    _seed_sitting(fake_db, exam, uid, status="released",
                  created_at=old_stamp,
                  listening_submitted_at=old_stamp,
                  reading_submitted_at=old_stamp,
                  writing_submitted_at=old_stamp)

    rows = [r for r in svc.admin_live_monitor(exam["id"])["students"]
            if str(r.get("user_id")) == uid]
    assert len(rows) == 1
    assert rows[0]["sections"]["listening"]["state"] != "submitted"


def test_pacing_totals_come_from_the_test_not_the_grading_output(fake_db, svc):
    """Codex #848 (correct): grading_details is populated only on SUBMISSION,
    but the primary caller is the live console — a student still working. Their
    attempt has answers and an empty grading_details, so the page rendered "1"
    instead of "1/40" for the whole section."""
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    start = _now() - timedelta(minutes=5)
    fake_db.table("mock_exams").update({
        "active_section": "listening", "listening_started_at": _iso(start),
    }).eq("id", exam["id"]).execute()
    # the exam's listening test knows its own length
    _seed_listening_length(fake_db, exam["listening_test_id"])
    uid = _seed_student(fake_db, cohort, "An")
    aid = str(uuid4())
    fake_db.seed("listening_test_attempts", {
        "id": aid, "status": "in_progress", "grading_details": [],   # NOT graded yet
        "answers": [
            {"q_num": 1, "user_answer": "cat", "answered_at": _iso(start + timedelta(seconds=30))},
        ],
    })
    _seed_sitting(fake_db, exam, uid, listening_attempt_id=aid)

    lis = svc.sitting_pacing(_find_sitting_id(fake_db))["sections"]["listening"]
    assert lis["answered"] == 1
    assert lis["total"] == 40


def test_pacing_final_minutes_kpi_ignores_a_cleared_field(fake_db, svc):
    """Codex #848 (correct): the timeline deliberately keeps a timestamped
    clear as activity, but counting it as an ANSWER incremented "Đáp án 5 phút
    cuối" past what the `answered` KPI allows — and drew an answer bar for a
    blank."""
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    start = _now() - timedelta(minutes=60)
    fake_db.table("mock_exams").update({
        "active_section": "listening", "listening_started_at": _iso(start),
    }).eq("id", exam["id"]).execute()
    uid = _seed_student(fake_db, cohort, "An")
    aid = str(uuid4())
    end = start + timedelta(minutes=30)
    fake_db.seed("listening_test_attempts", {
        "id": aid, "status": "in_progress", "grading_details": [{}] * 40,
        "answers": [
            # both land inside the final 5 minutes; only one is an answer
            {"q_num": 1, "user_answer": "cat", "answered_at": _iso(end - timedelta(minutes=2))},
            {"q_num": 2, "user_answer": "",    "answered_at": _iso(end - timedelta(minutes=1))},
        ],
    })
    _seed_sitting(fake_db, exam, uid, listening_attempt_id=aid,
                  listening_submitted_at=_iso(end))

    lis = svc.sitting_pacing(_find_sitting_id(fake_db))["sections"]["listening"]
    assert len(lis["timeline"]) == 2                 # the clear is still activity
    assert lis["answers_in_final_minutes"] == 1      # ...but not an answer
    assert [r["is_answered"] for r in lis["timeline"]] == [True, False]


def test_pacing_reports_unknown_order_when_nothing_was_answered(fake_db, svc):
    """Codex #848 (correct): comparing two EMPTY lists is trivially equal, so a
    sitting with no timestamped answers rendered "Làm theo thứ tự đề: Có" right
    beside its own message that nothing was saved. With no observations the
    order is unknown."""
    cohort = str(uuid4())
    exam = _seed_exam(fake_db, cohort_id=cohort)
    uid = _seed_student(fake_db, cohort, "An")
    aid = str(uuid4())
    fake_db.seed("listening_test_attempts", {
        "id": aid, "status": "in_progress", "grading_details": [], "answers": [],
    })
    _seed_sitting(fake_db, exam, uid, listening_attempt_id=aid)

    lis = svc.sitting_pacing(_find_sitting_id(fake_db))["sections"]["listening"]
    assert lis["timeline"] == []
    assert lis["worked_in_paper_order"] is None


def test_pacing_shows_an_assigned_section_with_no_attempt(fake_db, svc):
    """Codex #848 (correct): creating the L/R entries only when an attempt id
    exists made an ASSIGNED section vanish when the attempt had not been created
    yet — or its creation failed, a state admin_live_monitor() explicitly
    supports — so an L/R-only retake opened a completely blank pacing page
    instead of saying that no answers were saved."""
    exam = _seed_exam(fake_db)
    fake_db.table("mock_exams").update({"exam_mode": "retake"}).eq(
        "id", exam["id"]).execute()
    fake_db.seed("reading_tests", {"id": exam["reading_test_id"],
                                   "total_questions": 40})
    uid = str(uuid4())
    fake_db.seed("users", {"id": uid, "display_name": "An", "email": None})
    _seed_sitting(fake_db, exam, uid, assigned_skills=["reading"],
                  reading_attempt_id=None)

    out = svc.sitting_pacing(_find_sitting_id(fake_db))
    assert "reading" in out["sections"], out["sections"].keys()
    rd = out["sections"]["reading"]
    assert rd["timeline"] == []
    assert rd["answered"] == 0
    assert rd["total"] == 40
    assert rd["worked_in_paper_order"] is None
