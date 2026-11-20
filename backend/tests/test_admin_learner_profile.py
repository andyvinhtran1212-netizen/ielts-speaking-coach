"""G09-T04 (ADMINIA-0074 FR-024, FR-030, FR-031): the profile's Tổng quan tab.

Runs the real service (services/admin_learner_profile.py) and route
(routers/admin_learner_profile.py) over the in-memory stand-in of
test_admin_learners. Made-up people only; no AI or network call.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import admin_learner_profile as mod
from routers import admin_learners as learners_mod
from services import admin_learner_directory as directory
from services import admin_learner_profile as profile
from services import learner_attention, ops_thresholds, staff_scope, test_data_visibility
from test_admin_learners import (DEFAULTS, NOW, S_LAN, S_OFFLINE, U_ADMIN, U_LAN, U_MINH, _DB, _ago)


@pytest.fixture
def db(monkeypatch):
    fake = _DB()
    for module in (directory, learner_attention, staff_scope, profile):
        monkeypatch.setattr(module, "supabase_admin", fake)
    monkeypatch.setattr(ops_thresholds, "get", AsyncMock(return_value=dict(DEFAULTS)))
    monkeypatch.setattr(test_data_visibility, "hide_for", lambda **_k: False)
    monkeypatch.setattr(mod, "require_admin", AsyncMock(return_value={"id": U_ADMIN}))
    return fake


def _overview(ref):
    return asyncio.run(mod.get_learner_overview(ref, "Bearer x"))


def _vn_day(days_ago: int) -> str:
    """An instant at noon Vietnam time, ``days_ago`` days before today there."""
    day = NOW.astimezone(profile.VN).date() - timedelta(days=days_ago)
    from datetime import datetime, time
    return datetime.combine(day, time(12), profile.VN).isoformat()


def test_the_overview_has_every_block_and_nothing_failed(db):
    out = _overview(f"u-{U_LAN}")
    assert set(out) == {"alerts", "goal", "continuity", "assigned", "scores", "side", "sources_failed"}
    assert out["sources_failed"] == []
    # Alerts: the one attention function's reason, with its action; inactive was checked and is off.
    assert out["alerts"] == {"open": [{"code": "late_streak", "text": "trễ 2 bài liên tiếp",
                                       "action": "Xem bài được giao"}],
                             "checked_off": ["inactive"]}
    # No source yet: null, never 0.
    assert out["side"] == {"due_notes": None, "courses": None, "credits_left": None, "credits_carried": None}


def test_assigned_counts_only_past_deadline_work_and_lists_the_rest_as_open(db):
    a = _overview(f"u-{U_LAN}")["assigned"]
    assert (a["on_time"], a["late"], a["missing"], a["undecided"]) == (1, 0, 2, 0)
    assert [r["title"] for r in a["open"]] == ["Buổi 11 · Speaking"]
    assert [(r["title"], r["days_overdue"]) for r in a["overdue"]] == [("Buổi 9 · Reading", 5),
                                                                        ("Buổi 10 · Listening", 2)]
    assert all(r["last_reminded_at"] is None for r in a["overdue"])


def test_an_undecided_lesson_item_is_counted_apart_and_reported(db):
    """A lesson item with an empty ledger and one ended quiz: a read cannot
    tell whether it was handed in, so it is in none of the three counts nor in
    the overdue list, and the overview names the assignment source."""
    for a in db.rows["class_assignments"]:
        if a["id"] == "a3":
            a["skill"] = "course"
    db.rows["quiz_sessions"] = [{"id": "q1", "class_assignment_item_id": "i3", "ended_at": _ago(days=3)}]
    out = _overview(f"u-{U_LAN}")
    a = out["assigned"]
    assert (a["on_time"], a["late"], a["missing"], a["undecided"]) == (1, 0, 1, 1)
    assert [r["title"] for r in a["overdue"]] == ["Buổi 9 · Reading"]
    assert "assignments" in out["sources_failed"]
    # The late streak is undecided too, so the alerts are not shown as fine.
    assert out["alerts"] is None and "alerts" in out["sources_failed"]


def test_goal_shows_both_sources_and_a_conflict_is_not_an_alert(db):
    g = _overview(f"u-{U_LAN}")["goal"]
    assert g == {"admin": {"target_band": 7.0, "target_date": "2027-01-10"},
                 "learner": {"target_band": 7.0, "exam_date": "2027-01-10"},
                 "conflict": False, "estimated_band": None}
    db.rows["users"][1]["target_band"] = 7.5          # Minh's own goal differs from the admin's
    out = _overview(f"u-{U_MINH}")
    assert out["goal"]["conflict"] is True
    assert all(a["code"] != "goal" for a in out["alerts"]["open"])


def test_estimated_band_needs_a_released_mock_with_all_four_skills(db):
    db.rows["mock_exam_sittings"] = [{"id": "s1", "user_id": U_LAN, "status": "released"},
                                     {"id": "s2", "user_id": U_LAN, "status": "released"}]
    db.rows["mock_exam_reviews"] = [
        {"sitting_id": "s1", "status": "released", "released_at": _ago(days=20),
         "final_bands": {"listening": 7, "reading": 7.5, "writing": 6, "speaking": 6.5, "overall": 7.0}},
        # Newer, but only three skills: no Overall to estimate from.
        {"sitting_id": "s2", "status": "released", "released_at": _ago(days=2),
         "final_bands": {"listening": 8, "reading": 8, "writing": 7, "overall": None}},
    ]
    out = _overview(f"u-{U_LAN}")
    assert out["goal"]["estimated_band"] == 7.0
    assert [p["band"] for p in out["scores"]["mock"]] == [7.0]


def test_continuity_grid_is_vietnam_days_with_the_current_week_last(db):
    db.rows["sessions"] = [{"id": f"x{i}", "user_id": U_LAN, "started_at": _vn_day(i), "status": "abandoned"}
                           for i in (0, 1, 2, 9)]
    db.rows["quiz_sessions"] = [{"id": "q1", "user_id": U_LAN, "bank_id": "b-g", "started_at": _vn_day(0),
                                 "duration_sec": 600, "kind": "run", "ended_at": _vn_day(0), "accuracy": 0.8}]
    c = _overview(f"u-{U_LAN}")["continuity"]
    assert len(c["weeks"]) == 8 and all(len(w) == 7 for w in c["weeks"])
    today = NOW.astimezone(profile.VN).date()
    last = c["weeks"][-1]
    assert last[today.weekday()] is True
    assert all(v is None for v in last[today.weekday() + 1:])          # days after today are empty
    assert c["streak_days"] == 3
    assert c["minutes_this_week"] == 10 and c["minutes_last_week"] == 0


def test_scores_over_time(db):
    db.rows["quiz_banks"] = [{"id": "b-g", "skill_area": "grammar", "lesson_no": 4},
                             {"id": "b-v", "skill_area": "vocab", "lesson_no": None}]
    db.rows["quiz_sessions"] = [
        {"id": "q1", "user_id": U_LAN, "bank_id": "b-g", "kind": "run", "ended_at": _ago(days=3), "accuracy": 0.75},
        {"id": "q2", "user_id": U_LAN, "bank_id": "b-g", "kind": "retake", "ended_at": _ago(days=2), "accuracy": 1},
        {"id": "q3", "user_id": U_LAN, "bank_id": "b-v", "kind": "run", "ended_at": _ago(days=1), "accuracy": 0.5},
    ]
    # A mock-exam essay is mock work, not a Writing practice band (FR-104).
    db.rows["writing_essays"].append({"id": "e-mock", "student_id": S_LAN, "status": "delivered",
                                      "is_flagged": False, "deleted_at": None, "sitting_id": "sit-1",
                                      "delivered_at": _ago(days=1), "writing_feedback": {"overall_band_score": 4.0}})
    s = _overview(f"u-{U_LAN}")["scores"]
    assert [(p["pct"], p["lesson_no"]) for p in s["grammar"]] == [(75, 4)]   # first runs of grammar only
    assert [p["band"] for p in s["writing"]] == [8.5, 8.0, 7.5, 7.0, 6.5]     # oldest first
    assert [p["band"] for p in s["speaking"]] == [6.5]
    assert s["milestones"] is None                                           # no source yet


def test_one_failed_block_keeps_the_others(db):
    db.fail.add("writing_essays")
    out = _overview(f"u-{U_LAN}")
    assert out["scores"] is None and out["sources_failed"] == ["scores"]
    assert out["assigned"]["missing"] == 2 and out["goal"] is not None


def test_unreadable_thresholds_fail_the_alerts_block_not_the_page(db, monkeypatch):
    monkeypatch.setattr(ops_thresholds, "get", AsyncMock(side_effect=ops_thresholds.ThresholdsUnavailable()))
    out = _overview(f"u-{U_LAN}")
    assert out["alerts"] is None and out["sources_failed"] == ["alerts"]


def test_a_profile_without_an_account(db):
    out = _overview(f"s-{S_OFFLINE}")
    assert out["sources_failed"] == []
    assert out["alerts"]["checked_off"] == ["late_streak"]       # no account: inactivity is not checked
    assert out["goal"]["estimated_band"] is None
    assert out["scores"]["speaking"] == [] and out["scores"]["grammar"] == []


def test_the_overview_writes_nothing(db):
    _overview(f"u-{U_LAN}")
    assert db.writes == []


def test_only_an_admin_reads_the_overview(db, monkeypatch):
    monkeypatch.setattr(mod, "require_admin", AsyncMock(side_effect=HTTPException(403, "admin only")))
    with pytest.raises(HTTPException) as caught:
        _overview(f"u-{U_LAN}")
    assert caught.value.status_code == 403
