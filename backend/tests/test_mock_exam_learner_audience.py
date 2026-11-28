"""EXAMMOCK-0071 T004 (G08-T22 PR 1): the learner side of assigned mock exams.

MOCKORG-0086 plan 5.5 contract behind the runtime flag mock_exam_audiences_learner:
- an exam with audience rows seats only selected learners on its list, and
  anyone else gets the unknown-code 404 (FR-014);
- a self-paced sitting created after its audience row runs its sections back
  to back on the shared ``self_paced_timeline``: one start, the server stamps
  each next start, no state between two sections, the chain runs past the
  window once started;
- a retake sitting from before the row keeps the old section menu (option A);
- flag off: nothing changes.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from config import settings
from routers import mock_exams as mock_router
from tests.test_mock_exam_workflow import (  # noqa: F401 — fixtures
    _attach_domain_submitted, _do_speaking, _expire_section, _seed_exam, _seed_retake,
    fake_db, svc, wf,
)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


# Read the clock when each test starts, not when the module is imported: a
# long suite run otherwise pushes the windows below (open_from = NOW + 1h,
# retake_open_until, the 60-minute section chain) past real time.
NOW = datetime.now(timezone.utc)


@pytest.fixture(autouse=True)
def _fresh_now():
    global NOW
    NOW = datetime.now(timezone.utc)


def _learner_flag(monkeypatch, on):
    """The runtime flag mock_exam_audiences_learner as both sides read it: the
    admin helper ``learner_gate_enabled`` and the learner side's strict read.
    ``on=None`` makes the flag lookup itself fail (state unknown)."""
    from services import mock_exam_audience_service, runtime_flags
    real_strict = runtime_flags.is_enabled_strict

    def strict(key, default=False):
        if key != mock_exam_audience_service.LEARNER_GATE_FLAG:
            return real_strict(key, default)
        if on is None:
            raise runtime_flags.FlagLookupError(key)
        return on

    monkeypatch.setattr(runtime_flags, "is_enabled_strict", strict)
    monkeypatch.setattr(mock_exam_audience_service, "learner_gate_enabled", lambda: bool(on))


@pytest.fixture
def flag_on(monkeypatch):
    _learner_flag(monkeypatch, True)
    monkeypatch.setattr(settings, "MOCK_SELF_PACED_GAP_SECONDS", 0)


def _audience(fake, exam, user_id, *, skills=None, selected=True, open_from=None,
              open_until=None, added_at=None, purpose="main"):
    row = {
        "id": str(uuid4()), "exam_id": exam["id"], "user_id": str(user_id) if user_id else None,
        "student_id": str(uuid4()), "source_kind": "learner",
        "skills": skills or ["listening", "reading", "writing"], "selected": selected,
        "open_from": open_from, "open_until": open_until, "purpose": purpose,
        "added_at": added_at or _iso(NOW - timedelta(days=1)),
    }
    fake.seed("mock_exam_audiences", row)
    return row


def _self_paced_exam(fake, user_id, skills=("reading", "writing"), **audience):
    """A self-paced (legacy name ``retake``) exam with one audience row; the old
    assignment row (writing only) is there too, as the 0086 double write leaves
    it, so a test can tell which of the two decided."""
    exam = _seed_retake(fake, user_id, ["writing"])
    _audience(fake, exam, user_id, skills=list(skills), **audience)
    return exam


def _set(fake, sitting_id, **values):
    row = next(r for r in fake.rows("mock_exam_sittings") if r["id"] == sitting_id)
    row.update(values)
    return row


# ── gate ──────────────────────────────────────────────────────────────


def test_flag_off_keeps_the_old_gate_even_with_audience_rows(fake_db, svc, monkeypatch):
    _learner_flag(monkeypatch, False)
    exam = _seed_exam(fake_db, cohort_id=str(uuid4()))
    stranger = uuid4()
    _audience(fake_db, exam, stranger)
    # Not in the cohort: refused as today, not seated by the audience row.
    with pytest.raises(svc.NotEligibleError):
        svc.create_sitting(stranger, "MOCK-TEST-A")
    assert all(e["id"] != exam["id"] for e in svc.list_open_exams(str(stranger)))


def test_not_on_the_list_is_a_404_like_an_unknown_code(fake_db, svc, flag_on):
    exam = _seed_exam(fake_db)  # no cohort: the old gate would seat anyone
    _audience(fake_db, exam, uuid4())
    outsider = uuid4()
    with pytest.raises(svc.NotFoundError, match="Không tìm thấy kỳ thi"):
        svc.create_sitting(outsider, "MOCK-TEST-A")
    assert all(e["id"] != exam["id"] for e in svc.list_open_exams(str(outsider)))


def test_unselected_learner_is_not_seated(fake_db, svc, flag_on):
    exam = _seed_exam(fake_db)
    learner = uuid4()
    _audience(fake_db, exam, learner, selected=False)
    with pytest.raises(svc.NotFoundError):
        svc.create_sitting(learner, "MOCK-TEST-A")


def test_live_exam_seats_the_list_instead_of_cohort_id(fake_db, svc, flag_on):
    # A learner added singly (not in the exam's first class) sits a live exam.
    exam = _seed_exam(fake_db, cohort_id=str(uuid4()))
    learner = uuid4()
    _audience(fake_db, exam, learner)
    sitting = svc.create_sitting(learner, "MOCK-TEST-A")
    assert sitting["mock_exam_id"] == exam["id"]
    listed = [e for e in svc.list_open_exams(str(learner)) if e["id"] == exam["id"]]
    assert listed and listed[0]["my_sitting_id"] == sitting["id"]


def test_live_exam_with_list_still_needs_the_room_open(fake_db, svc, flag_on):
    exam = _seed_exam(fake_db, is_open=False)
    learner = uuid4()
    _audience(fake_db, exam, learner)
    with pytest.raises(svc.WindowClosedError):
        svc.create_sitting(learner, "MOCK-TEST-A")
    assert all(e["id"] != exam["id"] for e in svc.list_open_exams(str(learner)))


def test_exam_without_audience_rows_keeps_the_old_gate(fake_db, svc, flag_on):
    cohort = str(uuid4())
    _seed_exam(fake_db, cohort_id=cohort)
    with pytest.raises(svc.NotEligibleError):
        svc.create_sitting(uuid4(), "MOCK-TEST-A")


def test_self_paced_uses_the_rows_skills_and_window(fake_db, svc, flag_on):
    learner = uuid4()
    until = _iso(NOW + timedelta(days=2))
    _self_paced_exam(fake_db, learner, skills=("reading", "writing"), open_until=until)
    # The old assignment says writing only; the audience row wins.
    sitting = svc.create_sitting(learner, "MOCK-TEST-A")
    assert sitting["assigned_skills"] == ["reading", "writing"]
    assert sitting["retake_open_until"] == until


def test_self_paced_window_comes_from_the_row(fake_db, svc, flag_on):
    learner = uuid4()
    _self_paced_exam(fake_db, learner, open_from=_iso(NOW + timedelta(hours=1)))
    with pytest.raises(svc.WindowClosedError):
        svc.create_sitting(learner, "MOCK-TEST-A")
    assert svc.list_open_exams(str(learner)) == []


def test_one_attempt_released_sitting_refuses_a_second(fake_db, svc, flag_on):
    learner = uuid4()
    exam = _self_paced_exam(fake_db, learner)
    fake_db.seed("mock_exam_sittings", {
        "id": str(uuid4()), "mock_exam_id": exam["id"], "user_id": str(learner),
        "status": "released",
    })
    with pytest.raises(svc.SittingConflictError, match="thi bù"):
        svc.create_sitting(learner, "MOCK-TEST-A")


# ── back to back ──────────────────────────────────────────────────────


def _chain_sitting(fake_db, svc, learner, **audience):
    exam = _self_paced_exam(fake_db, learner, **audience)
    sitting = svc.create_sitting(learner, "MOCK-TEST-A")
    exam = svc.get_published_exam_by_id(exam["id"])
    assert svc.is_self_paced_chain(svc.get_sitting(sitting["id"]), exam)
    return exam, sitting


def test_only_the_first_section_is_started_by_the_learner(fake_db, svc, flag_on):
    learner = uuid4()
    _exam, sitting = _chain_sitting(fake_db, svc, learner)
    with pytest.raises(svc.SittingConflictError, match="tự động"):
        svc.start_section(sitting["id"], learner, "writing")
    started = svc.start_section(sitting["id"], learner, "reading")
    assert started["reading_started_at"]


def test_early_submit_starts_the_next_section_at_that_moment(fake_db, svc, flag_on):
    learner = uuid4()
    exam, sitting = _chain_sitting(fake_db, svc, learner)
    now = datetime.now(timezone.utc)
    start = now - timedelta(minutes=20)
    submit = now - timedelta(minutes=5)
    _set(fake_db, sitting["id"], status="lrw_in_progress",
         reading_started_at=_iso(start), reading_submitted_at=_iso(submit))

    state = mock_router._sitting_state_sync(sitting["id"], str(learner))

    # The server stamped Writing at the Reading submit, not "now", and there
    # is no not_started answer between the two sections.
    row = svc.get_sitting(sitting["id"])
    assert datetime.fromisoformat(row["writing_started_at"]) == submit
    assert state["active_section"] == "writing"
    left = state["section_time_left_seconds"]
    assert 60 * 55 - 30 <= left <= 60 * 55
    sp = state["self_paced"]
    assert sp["state"] == "in_progress" and sp["current_section"] == "writing"
    assert [(x["section"], x["status"]) for x in sp["sections"]] == [
        ("reading", "submitted"), ("writing", "in_progress")]
    assert datetime.fromisoformat(sp["expected_end_at"]) == submit + timedelta(minutes=60)
    # A second poll never moves the stamp.
    mock_router._sitting_state_sync(sitting["id"], str(learner))
    assert svc.get_sitting(sitting["id"])["writing_started_at"] == row["writing_started_at"]

    # Writing submits on the server-stamped clock (no "not started" refusal).
    done = svc.submit_section(sitting["id"], learner, "writing", "essay a", "essay b")
    assert done["status"] == "all_submitted"


def test_gap_reports_seconds_until_the_next_section_opens(fake_db, svc, flag_on, monkeypatch):
    # MOCK_SELF_PACED_GAP_SECONDS > 0: the next section opens after the gap.
    # The block says how long is left, relative, so the runner can show a
    # fixed countdown instead of opening the section early (FR-014).
    monkeypatch.setattr(settings, "MOCK_SELF_PACED_GAP_SECONDS", 120)
    learner = uuid4()
    exam, sitting = _chain_sitting(fake_db, svc, learner)
    now = datetime.now(timezone.utc)
    _set(fake_db, sitting["id"], status="lrw_in_progress",
         reading_started_at=_iso(now - timedelta(minutes=10)),
         reading_submitted_at=_iso(now - timedelta(seconds=30)))

    sp = mock_router._sitting_state_sync(sitting["id"], str(learner))["self_paced"]
    assert sp["current_section"] == "writing" and sp["gap_seconds"] == 120
    assert 85 <= sp["starts_in_seconds"] <= 90
    # Not stamped yet: the start is still in the future.
    assert not svc.get_sitting(sitting["id"]).get("writing_started_at")

    # Gap over: the stamp lands and nothing is left to wait for.
    _set(fake_db, sitting["id"], reading_submitted_at=_iso(now - timedelta(seconds=200)))
    sp = mock_router._sitting_state_sync(sitting["id"], str(learner))["self_paced"]
    assert sp["starts_in_seconds"] == 0
    assert svc.get_sitting(sitting["id"]).get("writing_started_at")


def test_unsubmitted_section_ends_at_its_deadline_and_the_reaper_walks_the_chain(
        fake_db, svc, flag_on):
    learner = uuid4()
    exam, sitting = _chain_sitting(
        fake_db, svc, learner, open_until=_iso(NOW + timedelta(days=1)))
    # Reading (60 min) started 70 min ago, never submitted: Writing started at
    # its deadline 10 min ago, and only Reading is due for collection.
    start = NOW - timedelta(minutes=70)
    _set(fake_db, sitting["id"], status="lrw_in_progress", reading_started_at=_iso(start))

    svc.reap_expired_retake_sittings(grace_seconds=0)

    row = svc.get_sitting(sitting["id"])
    assert row["reading_submitted_at"]
    assert datetime.fromisoformat(row["writing_started_at"]) == start + timedelta(minutes=60)
    assert not row.get("writing_submitted_at")
    active, left = svc.retake_active_section(row, exam)
    assert active == "writing" and 60 * 49 <= left <= 60 * 50


def test_state_follows_the_chain_before_the_reaper_collects_an_overdue_section(
        fake_db, svc, flag_on):
    # Codex P1 on #2581: Reading (60 min) started 70 min ago and never
    # submitted. Before any sweep, a poll must name Writing in both
    # active_section and self_paced, with Writing's clock, never Reading at 0 s.
    learner = uuid4()
    exam, sitting = _chain_sitting(
        fake_db, svc, learner, open_until=_iso(NOW + timedelta(days=1)))
    start = NOW - timedelta(minutes=70)
    _set(fake_db, sitting["id"], status="lrw_in_progress", reading_started_at=_iso(start))

    state = mock_router._sitting_state_sync(sitting["id"], str(learner))

    row = svc.get_sitting(sitting["id"])
    assert not row.get("reading_submitted_at")  # only the reaper collects it
    assert datetime.fromisoformat(row["writing_started_at"]) == start + timedelta(minutes=60)
    assert state["active_section"] == "writing"
    assert state["self_paced"]["current_section"] == "writing"
    assert 60 * 49 <= state["section_time_left_seconds"] <= 60 * 50
    assert state["section_time_left_seconds"] == state["self_paced"]["section_time_left_seconds"]


def test_started_chain_runs_past_the_window(fake_db, svc, flag_on):
    learner = uuid4()
    _exam, sitting = _chain_sitting(
        fake_db, svc, learner, open_until=_iso(NOW + timedelta(days=1)))
    _set(fake_db, sitting["id"], status="lrw_in_progress",
         reading_started_at=_iso(NOW - timedelta(minutes=10)),
         retake_open_until=_iso(NOW - timedelta(minutes=1)))

    svc.reap_expired_retake_sittings(grace_seconds=0)

    row = svc.get_sitting(sitting["id"])
    # Window closed, but the running section is not force-collected.
    assert not row.get("reading_submitted_at")
    assert row["status"] == "lrw_in_progress"


def test_whole_chain_past_its_end_is_collected_in_one_sweep(fake_db, svc, flag_on):
    learner = uuid4()
    _exam, sitting = _chain_sitting(fake_db, svc, learner)
    start = NOW - timedelta(minutes=150)
    _set(fake_db, sitting["id"], status="lrw_in_progress", reading_started_at=_iso(start))

    svc.reap_expired_retake_sittings(grace_seconds=0)

    row = svc.get_sitting(sitting["id"])
    assert row["reading_submitted_at"] and row["writing_submitted_at"]
    assert datetime.fromisoformat(row["writing_started_at"]) == start + timedelta(minutes=60)
    assert row["status"] != "lrw_in_progress"


def test_not_started_chain_shows_the_entry_state(fake_db, svc, flag_on):
    learner = uuid4()
    _exam, sitting = _chain_sitting(fake_db, svc, learner)
    state = mock_router._sitting_state_sync(sitting["id"], str(learner))
    assert state["active_section"] == "not_started"
    assert state["self_paced"]["state"] == "not_started"
    assert state["self_paced"]["total_seconds"] == 120 * 60
    assert state["self_paced"]["sections"] == []
    assert state["self_paced"]["starts_in_seconds"] == 0


# ── old retake sittings keep the menu (option A) ─────────────────────────


def test_retake_sitting_from_before_the_row_keeps_the_section_menu(fake_db, svc, flag_on):
    learner = uuid4()
    exam = _seed_retake(fake_db, learner, ["reading", "writing"])
    sitting = svc.create_sitting(learner, "MOCK-TEST-A")      # old assignment path
    _set(fake_db, sitting["id"], status="lrw_in_progress",
         created_at=_iso(NOW - timedelta(days=3)),
         reading_started_at=_iso(NOW - timedelta(hours=3)),
         reading_submitted_at=_iso(NOW - timedelta(hours=2, minutes=30)))
    _audience(fake_db, exam, learner, skills=["reading", "writing"],
              added_at=_iso(NOW - timedelta(days=1)))         # double write, later

    fresh = svc.get_sitting(sitting["id"])
    assert not svc.is_self_paced_chain(fresh, exam)
    state = mock_router._sitting_state_sync(sitting["id"], str(learner))
    # Paused between sections as before: no stamp, no clock, nothing reaped.
    assert state["active_section"] == "not_started"
    assert state["self_paced"] is None
    svc.reap_expired_retake_sittings(grace_seconds=0)
    assert not svc.get_sitting(sitting["id"]).get("writing_started_at")


def test_flag_off_state_has_no_self_paced_block(fake_db, svc, monkeypatch):
    _learner_flag(monkeypatch, False)
    learner = uuid4()
    _self_paced_exam(fake_db, learner)
    sitting = svc.create_sitting(learner, "MOCK-TEST-A")
    # Old gate: the assignment row (writing only) decides the skills.
    assert sitting["assigned_skills"] == ["writing"]
    state = mock_router._sitting_state_sync(sitting["id"], str(learner))
    assert state["self_paced"] is None
    assert state["exam_mode"] == "retake" and state["exam_mode_v2"] == "self_paced"


# ── audience read failure and the reaper's one read (CR #2581 items 2, 4) ──


def _audience_table_fails(monkeypatch, fake):
    calls = {"audience": 0}
    original = type(fake).table

    def table(self, name):
        if name == "mock_exam_audiences":
            calls["audience"] += 1
            raise RuntimeError('relation "mock_exam_audiences" does not exist')
        return original(self, name)

    monkeypatch.setattr(type(fake), "table", table)
    return calls


def test_unreadable_audience_list_is_a_503_never_a_500_or_an_open_gate(
        fake_db, svc, flag_on, monkeypatch):
    import asyncio
    from fastapi import HTTPException

    learner = uuid4()
    _self_paced_exam(fake_db, learner)
    _audience_table_fails(monkeypatch, fake_db)
    with pytest.raises(svc.AudienceUnavailableError):
        svc.list_open_exams(str(learner))
    with pytest.raises(svc.AudienceUnavailableError):
        svc.create_sitting(learner, "MOCK-TEST-A")
    assert fake_db.rows("mock_exam_sittings") == []

    async def user(_authorization):
        return {"id": str(learner)}

    monkeypatch.setattr(mock_router, "get_supabase_user", user)
    for call in (mock_router.list_open(authorization="Bearer x"),
                 mock_router.open_sitting("MOCK-TEST-A", authorization="Bearer x")):
        with pytest.raises(HTTPException) as error:
            asyncio.run(call)
        assert error.value.status_code == 503
        assert "danh sách thí sinh" in error.value.detail


def test_state_of_a_sitting_with_unreadable_audience_is_a_503(fake_db, svc, flag_on, monkeypatch):
    import asyncio
    from fastapi import HTTPException

    learner = uuid4()
    _exam, sitting = _chain_sitting(fake_db, svc, learner)
    _audience_table_fails(monkeypatch, fake_db)

    async def user(_authorization):
        return {"id": str(learner)}

    monkeypatch.setattr(mock_router, "get_supabase_user", user)
    with pytest.raises(HTTPException) as error:
        asyncio.run(mock_router.get_sitting_state(sitting["id"], authorization="Bearer x"))
    assert error.value.status_code == 503


def test_reaper_reads_the_audience_rows_once_per_sweep(fake_db, svc, flag_on, monkeypatch):
    sittings = []
    first = uuid4()
    exam = _self_paced_exam(fake_db, first)
    for index in range(3):
        learner = first if index == 0 else uuid4()
        if index:
            _audience(fake_db, exam, learner, skills=["reading", "writing"])
        sitting = svc.create_sitting(learner, "MOCK-TEST-A")
        _set(fake_db, sitting["id"], status="lrw_in_progress",
             reading_started_at=_iso(NOW - timedelta(minutes=70)))
        sittings.append(sitting)
    calls = {"audience": 0}
    original = type(fake_db).table

    def table(self, name):
        if name == "mock_exam_audiences":
            calls["audience"] += 1
        return original(self, name)

    monkeypatch.setattr(type(fake_db), "table", table)
    svc.reap_expired_retake_sittings(grace_seconds=0)

    assert calls["audience"] == 1
    for sitting in sittings:
        assert svc.get_sitting(sitting["id"])["reading_submitted_at"]


def test_reaper_skips_the_sweep_when_the_audience_rows_cannot_be_read(
        fake_db, svc, flag_on, monkeypatch):
    learner = uuid4()
    _exam, sitting = _chain_sitting(fake_db, svc, learner)
    _set(fake_db, sitting["id"], status="lrw_in_progress",
         reading_started_at=_iso(NOW - timedelta(minutes=70)))
    _audience_table_fails(monkeypatch, fake_db)

    svc.reap_expired_retake_sittings(grace_seconds=0)

    # Nothing is reaped by the old per-section rule while the chain is unknown.
    row = svc.get_sitting(sitting["id"])
    assert not row.get("reading_submitted_at") and not row.get("writing_started_at")


# ── flag lookup failure is "unknown", never "off" (HOLD on #2581) ──


def test_unreadable_flag_is_a_503_on_list_and_create_never_the_old_gate(
        fake_db, svc, monkeypatch):
    import asyncio
    from fastapi import HTTPException

    learner = uuid4()
    _self_paced_exam(fake_db, learner)  # the old gate would seat this learner
    _learner_flag(monkeypatch, None)
    with pytest.raises(svc.AudienceUnavailableError):
        svc.list_open_exams(str(learner))
    with pytest.raises(svc.AudienceUnavailableError):
        svc.create_sitting(learner, "MOCK-TEST-A")
    assert fake_db.rows("mock_exam_sittings") == []

    async def user(_authorization):
        return {"id": str(learner)}

    monkeypatch.setattr(mock_router, "get_supabase_user", user)
    for call in (mock_router.list_open(authorization="Bearer x"),
                 mock_router.open_sitting("MOCK-TEST-A", authorization="Bearer x")):
        with pytest.raises(HTTPException) as error:
            asyncio.run(call)
        assert error.value.status_code == 503
    assert fake_db.rows("mock_exam_sittings") == []


def test_flag_confirmed_off_keeps_the_old_gate(fake_db, svc, monkeypatch):
    learner = uuid4()
    _self_paced_exam(fake_db, learner)
    _learner_flag(monkeypatch, False)
    assert any(e["code"] == "MOCK-TEST-A" for e in svc.list_open_exams(str(learner)))
    assert svc.create_sitting(learner, "MOCK-TEST-A")["assigned_skills"] == ["writing"]


def test_unreadable_flag_state_read_is_a_503(fake_db, svc, flag_on, monkeypatch):
    import asyncio
    from fastapi import HTTPException

    learner = uuid4()
    _exam, sitting = _chain_sitting(fake_db, svc, learner)
    _learner_flag(monkeypatch, None)

    async def user(_authorization):
        return {"id": str(learner)}

    monkeypatch.setattr(mock_router, "get_supabase_user", user)
    with pytest.raises(HTTPException) as error:
        asyncio.run(mock_router.get_sitting_state(sitting["id"], authorization="Bearer x"))
    assert error.value.status_code == 503


def test_reaper_skips_the_sweep_when_the_flag_cannot_be_read(fake_db, svc, flag_on, monkeypatch):
    learner = uuid4()
    _exam, sitting = _chain_sitting(fake_db, svc, learner)
    _set(fake_db, sitting["id"], status="lrw_in_progress",
         reading_started_at=_iso(NOW - timedelta(minutes=70)))
    _learner_flag(monkeypatch, None)

    svc.reap_expired_retake_sittings(grace_seconds=0)

    row = svc.get_sitting(sitting["id"])
    assert not row.get("reading_submitted_at") and not row.get("writing_started_at")

def test_speaking_only_self_paced_goes_straight_to_speaking_and_review(fake_db, svc, wf, flag_on):
    user = uuid4()
    exam = _self_paced_exam(fake_db, user, skills=["speaking"])
    exam["speaking_topic_set"] = {"part1": ["Travel"]}
    sitting = svc.create_sitting(user, exam["code"])
    assert sitting["status"] == "speaking_pending"
    state = mock_router._sitting_state_sync(sitting["id"], str(user))
    assert state["assigned_skills"] == ["speaking"]
    assert state["exam"]["speaking_topic_set"] == exam["speaking_topic_set"]
    assert state["exam"]["reading_test_code"] is None
    _set(fake_db, sitting["id"], status="registered")
    assert svc.create_sitting(user, exam["code"])["status"] == "speaking_pending"
    assert _do_speaking(svc, fake_db, sitting["id"], user)["status"] == "all_submitted"
    assert wf._required_skills_for(exam, sitting) == ("speaking",)
    assert len(fake_db.rows("mock_exam_reviews")) == 1
    assert svc.live_sitting_for_user(user) is None


def test_live_reading_only_is_scoped_to_learner_at_delivery_and_review(fake_db, svc, wf, flag_on):
    exam = _seed_exam(fake_db, speaking=True)
    user, other = uuid4(), uuid4()
    _audience(fake_db, exam, user, skills=["reading"])
    _audience(fake_db, exam, other, skills=["listening", "speaking"])
    learner = svc.create_sitting(user, exam["code"])
    peer = svc.create_sitting(other, exam["code"])
    assert svc.pending_in_section(exam["id"], "writing") == 0
    exam["active_section"] = "listening"
    state = mock_router._sitting_state_sync(learner["id"], str(user))
    assert state["assigned_skills"] == ["reading"] and state["active_section"] == "not_started"
    assert not state["exam"]["speaking_topic_set"] and state["exam"]["listening_test_id"] is None
    assert not svc._sitting_may_open_section(learner, exam, "listening")
    assert svc._sitting_may_open_section(peer, exam, "listening")
    assert wf._required_skills_for(exam, learner) == ("reading",)
    assert set(wf._required_skills_for(exam, peer)) == {"listening", "speaking"}
    exam["active_section"] = "reading"
    assert svc._sitting_may_open_section(learner, exam, "reading")
    _expire_section(fake_db, exam["id"], "reading")
    _attach_domain_submitted(svc, fake_db, exam, learner["id"], user, "reading")
    assert svc.submit_section(learner["id"], user, "reading")["status"] == "all_submitted"
    assert svc.get_sitting(peer["id"])["status"] == "registered"
