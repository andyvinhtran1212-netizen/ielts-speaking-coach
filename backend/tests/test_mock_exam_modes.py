"""MOCKORG-0086 plan 5.5: mode names and the self-paced timeline (pure, fake clock)."""
from datetime import datetime, timedelta, timezone

import pytest

from services.mock_exam_modes import (
    MISSED,
    NOT_STARTED,
    SUBMITTED,
    IN_PROGRESS,
    is_live,
    is_self_paced,
    legacy_name,
    normalize,
    self_paced_timeline,
)

T0 = datetime(2026, 12, 1, 8, 0, tzinfo=timezone.utc)
DUR = {"listening": 30 * 60, "reading": 60 * 60, "writing": 60 * 60}
EXAM = {"exam_mode": "self_paced"}


def at(minutes: float) -> datetime:
    return T0 + timedelta(minutes=minutes)


def iso(minutes: float) -> str:
    return at(minutes).isoformat().replace("+00:00", "Z")


def sitting(**fields):
    base = {"assigned_skills": ["listening", "reading", "writing"], "listening_started_at": iso(0)}
    base.update(fields)
    return base


def timeline(s, now_min, **kw):
    return self_paced_timeline(s, EXAM, at(now_min), durations=DUR, **kw)


@pytest.mark.parametrize("raw,new,old", [
    ("sequential", "live", "sequential"), ("retake", "self_paced", "retake"),
    ("live", "live", "sequential"), ("self_paced", "self_paced", "retake"),
])
def test_mode_names_map_both_ways(raw, new, old):
    assert normalize(raw) == new
    assert legacy_name(raw) == old
    assert is_live(raw) is (new == "live")
    assert is_self_paced(raw) is (new == "self_paced")


def test_unknown_mode_is_none():
    assert normalize("practice") is None and normalize(None) is None
    assert not is_live("practice") and not is_self_paced("")


def test_submit_part1_at_20_starts_part2_at_20_without_a_gap_state():
    s = sitting(listening_submitted_at=iso(20))
    for minute in (20, 20.01, 25):
        t = timeline(s, minute)
        assert t.state == IN_PROGRESS
        assert t.current_section == "reading"
    t = timeline(s, 20)
    assert t.sections[1].starts_at == at(20)
    assert t.section_time_left_seconds == 60 * 60
    assert t.due_start_stamps == ("reading",)
    assert t.expected_end_at == at(140)


def test_no_submit_part1_starts_part2_at_30_and_auto_submits_part1():
    s = sitting()
    t = timeline(s, 31)
    assert t.current_section == "reading"
    assert t.sections[1].starts_at == at(30)
    assert t.section_time_left_seconds == 59 * 60
    assert t.due_auto_submit == ("listening",)
    assert t.due_start_stamps == ("reading",)
    assert timeline(s, 29.5).current_section == "listening"


def test_past_150_minutes_without_action_is_submitted():
    t = timeline(sitting(), 150)
    assert t.state == SUBMITTED
    assert t.current_section is None
    assert t.due_auto_submit == ("listening", "reading", "writing")
    assert t.expected_end_at == at(150)


def test_all_parts_submitted_early_is_submitted_at_last_submit():
    s = sitting(listening_submitted_at=iso(10), reading_submitted_at=iso(40), writing_submitted_at=iso(70))
    t = timeline(s, 71)
    assert t.state == SUBMITTED and t.expected_end_at == at(70) and t.due_auto_submit == ()


def test_not_started_inside_window_then_missed_after_it_closes():
    s = {"assigned_skills": ["listening", "reading"]}
    assert timeline(s, 0, open_until=at(60)).state == NOT_STARTED
    assert timeline(s, 60, open_until=at(60)).state == MISSED
    assert timeline(s, 600).state == NOT_STARTED  # no window given: never missed


def test_started_before_window_closes_runs_to_the_end():
    t = timeline(sitting(), 100, open_until=at(45))
    assert t.state == IN_PROGRESS and t.current_section == "writing"


def test_extra_300_seconds_on_running_part2_moves_expected_end():
    s = sitting(listening_submitted_at=iso(20))
    before = timeline(s, 30)
    after = timeline({**s, "extra_seconds": {"reading": 300}}, 30)
    assert after.expected_end_at - before.expected_end_at == timedelta(seconds=300)
    assert after.section_time_left_seconds - before.section_time_left_seconds == 300
    assert after.sections[2].starts_at == at(85)


def test_gap_seconds_delays_next_part_and_counts_in_expected_end():
    s = sitting(listening_submitted_at=iso(20))
    t = timeline(s, 20.5, gap_seconds=60)
    assert t.sections[1].starts_at == at(21)
    assert t.current_section == "reading"  # never a "between parts" state
    assert t.due_start_stamps == ()
    assert t.expected_end_at == at(142)


def test_skill_subset_follows_fixed_order():
    s = {"assigned_skills": ["reading", "listening"], "listening_started_at": iso(0)}
    t = timeline(s, 50)
    assert [w.section for w in t.sections] == ["listening", "reading"]
    assert t.current_section == "reading" and t.expected_end_at == at(90)


def test_exam_skills_used_when_sitting_has_none():
    s = {"reading_started_at": iso(0)}
    t = self_paced_timeline(s, {"skills": ["reading", "writing"]}, at(10), durations=DUR)
    assert [w.section for w in t.sections] == ["reading", "writing"]


def test_now_is_required():
    with pytest.raises(ValueError):
        self_paced_timeline(sitting(), EXAM, None, durations=DUR)


def test_speaking_only_sitting_is_never_submitted_from_the_start():
    """CR #2565 nit: no timed section → not_started, then missed; never submitted."""
    s = {"assigned_skills": ["speaking"]}
    assert timeline(s, 0, open_until=iso(60)).state == NOT_STARTED
    assert timeline(s, 61, open_until=iso(60)).state == MISSED
