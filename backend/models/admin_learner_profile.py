"""Response shape of the learner profile's Tổng quan tab (ADMINIA-0074 plan
5.4 ``GET /admin/learners/{ref}/overview``; G09-T04).

A block is ``null`` when its source could not be read; the block's name is
then in ``sources_failed``. A field with no source yet (G04, G09-T35, term
milestones) is ``null`` too, and is never reported as failed.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict

_CODE = Literal["late_streak", "inactive", "course_expiring", "low_credits"]


class _StrictOut(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OverviewAlert(_StrictOut):
    code: _CODE
    text: str
    action: str


class OverviewAlerts(_StrictOut):
    open: list[OverviewAlert]
    # Codes that were checked and did not fire ("Không bật").
    checked_off: list[_CODE]


class OverviewAdminGoal(_StrictOut):
    target_band: Optional[float]
    target_date: Optional[str]


class OverviewLearnerGoal(_StrictOut):
    target_band: Optional[float]
    exam_date: Optional[str]


class OverviewGoal(_StrictOut):
    admin: OverviewAdminGoal
    learner: OverviewLearnerGoal
    conflict: bool
    # Overall of the latest released mock exam with all four skills.
    estimated_band: Optional[float]


class OverviewContinuity(_StrictOut):
    # 8 weeks × 7 Vietnam-time days, Monday first, the current week last;
    # a day after today is null.
    weeks: list[list[Optional[bool]]]
    streak_days: int
    minutes_this_week: int
    minutes_last_week: int


class OverviewAssignment(_StrictOut):
    assignment_id: str
    title: str
    due_at: Optional[str]


class OverviewOverdue(OverviewAssignment):
    days_overdue: int
    last_reminded_at: Optional[str]


class OverviewAssigned(_StrictOut):
    on_time: int
    late: int
    missing: int
    # Lesson items whose hand-in a read cannot decide (counted in none of the
    # above; the overview then names "assignments" in sources_failed).
    undecided: int
    open: list[OverviewAssignment]
    overdue: list[OverviewOverdue]


class GrammarPoint(_StrictOut):
    at: Optional[str]
    pct: int
    lesson_no: Optional[int]


class BandPoint(_StrictOut):
    at: Optional[str]
    band: float


class Milestone(_StrictOut):
    at: str
    label: str


class OverviewScores(_StrictOut):
    grammar: list[GrammarPoint]
    writing: list[BandPoint]
    speaking: list[BandPoint]
    mock: list[BandPoint]
    milestones: Optional[list[Milestone]]


class CreditsCarried(_StrictOut):
    amount: int
    expires_at: str


class OverviewSide(_StrictOut):
    due_notes: Optional[list[dict]]
    courses: Optional[list[dict]]
    credits_left: Optional[int]
    credits_carried: Optional[CreditsCarried]


class LearnerOverview(_StrictOut):
    alerts: Optional[OverviewAlerts]
    goal: Optional[OverviewGoal]
    continuity: Optional[OverviewContinuity]
    assigned: Optional[OverviewAssigned]
    scores: Optional[OverviewScores]
    side: OverviewSide
    sources_failed: list[str]
