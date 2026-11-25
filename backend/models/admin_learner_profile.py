"""Response shape of the learner profile's Tổng quan tab (ADMINIA-0074 plan
5.4 ``GET /admin/learners/{ref}/overview``; G09-T04).

A block is ``null`` when its source could not be read; the block's name is
then in ``sources_failed``. A field with no source yet (G04, term
milestones) is ``null`` too, and is never reported as failed.
"""

from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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
    # Codes a read cannot decide (a lesson item's hand-in): shown as "chưa
    # xác định", never as "Không bật". The overview then names "assignments".
    undecided: list[_CODE]


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


class _SeenAdminGoal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_band: Optional[float]
    target_date: Optional[date]


class _SeenLearnerGoal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_band: Optional[float]
    exam_date: Optional[date]


class GoalSeen(BaseModel):
    """Both goals as the page showed them (the overview's goal.admin and
    goal.learner, every field present, null included)."""
    model_config = ConfigDict(extra="forbid")
    admin: _SeenAdminGoal
    learner: _SeenLearnerGoal


class GoalResolveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    use: Literal["admin", "learner"]
    # Compared under the row locks: a goal that changed since is refused.
    seen: GoalSeen


class GoalResolveOut(_StrictOut):
    # The goal block read back after the write (both sources now agree).
    goal: OverviewGoal


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


class DueNote(_StrictOut):
    """A care note's booked work (G09-T35): open, with a due day."""
    id: str
    due_on: date
    next_action: Optional[str]
    body: str


class OverviewSide(_StrictOut):
    # null: the care notes could not be read (named "care_notes").
    due_notes: Optional[list[DueNote]]
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


# ── Care notes (G09-T35, FR-032; mig 442) ─────────────────────────────────

class CareNote(_StrictOut):
    # null only for the virtual initial note built from students.persona_notes.
    id: Optional[str]
    author_name: Optional[str]
    created_at: Optional[str]
    body: str
    next_action: Optional[str]
    due_on: Optional[date]
    done_at: Optional[str]
    is_initial: bool
    editable: bool


class CareNotes(_StrictOut):
    items: list[CareNote]


class CareNoteOut(_StrictOut):
    note: CareNote


class CareNoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: str = Field(min_length=1, max_length=4000)
    next_action: Optional[str] = Field(default=None, max_length=500)
    due_on: Optional[date] = None

    @field_validator("body")
    @classmethod
    def _body(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("body must not be blank")
        return value


class CareNotePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: Optional[str] = Field(default=None, min_length=1, max_length=4000)
    next_action: Optional[str] = Field(default=None, max_length=500)
    due_on: Optional[date] = None
    done: Optional[bool] = None

    @field_validator("body")
    @classmethod
    def _body(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and not value.strip():
            raise ValueError("body must not be blank")
        return value

    @model_validator(mode="after")
    def _something(self) -> "CareNotePatch":
        if not self.model_fields_set:
            raise ValueError("nothing to change")
        if "body" in self.model_fields_set and self.body is None:
            raise ValueError("body cannot be cleared")
        if "done" in self.model_fields_set and self.done is None:
            raise ValueError("done must be true or false")
        return self


# ── Khoá và quyền: AI cost (FR-026; G09-T04c) ──────────────────────────────

class AiCostFeature(_StrictOut):
    # ai_usage_logs.feature; null for a call logged before features existed.
    feature: Optional[str]
    calls: int
    cost_usd: float
    unpriced_calls: int


class LearnerAiCost(_StrictOut):
    window_days: Literal[7, 30, 90]
    # USD, two decimals. A call with no price adds nothing here and is
    # counted in unpriced_calls instead.
    total_usd: float
    unpriced_calls: int
    by_feature: list[AiCostFeature]


# ── Nhật ký hệ thống (FR-027; G09-T04c) ────────────────────────────────────

LogSource = Literal["access_code", "security", "class", "role", "entitlement", "credit", "order", "goal"]


class LearnerLogItem(_StrictOut):
    id: str
    # UTC, e.g. 2026-11-23T04:30:00.000000Z.
    at: str
    actor_name: Optional[str]
    source: LogSource
    text: str


class LearnerLog(_StrictOut):
    items: list[LearnerLogItem]
    # Pass back as ``cursor`` for the next, older page; null on the last page.
    next_cursor: Optional[str]
    # A source that could not be read ("actors": who did it is unknown).
    sources_failed: list[str]
    # Sources with no read API yet (G04): not an empty history.
    sources_unavailable: list[LogSource]


# ── Học tập: attempts (FR-025; G09-T04c) ───────────────────────────────────

AttemptSkill = Literal["speaking", "writing", "reading", "listening", "mock"]
AttemptState = Literal["in_progress", "submitted", "done", "failed", "abandoned", "other"]


class LearnerAttempt(_StrictOut):
    skill: AttemptSkill
    # practice | full_test (Speaking), essay, test (Reading/Listening), sitting (mock).
    kind: str
    id: str
    title: str
    state: AttemptState
    # e.g. "Band 6.5 · 30/40"; null until a result is out.
    result_text: Optional[str]
    submitted_at: Optional[str]
    # The admin view that opens this attempt; null when none exists yet.
    open_href: Optional[str]


class RepeatedWritingError(_StrictOut):
    # feedback_json.mistakeAnalysis[].mistakeType, as the grader names it.
    mistake_type: str
    count: int
    criterion: Optional[str]


class WeakGrammarGroup(_StrictOut):
    # The same item as the learner's grammar dashboard weak_areas.
    tag: str
    label_vi: str
    category: str
    occurrence_count: int
    last_seen_at: Optional[str]


class LearnerAttempts(_StrictOut):
    items: list[LearnerAttempt]
    next_cursor: Optional[str]
    # Over the newest five essays; null until there are five graded essays
    # (or no student profile, or the read failed: then named in sources_failed).
    writing_repeated_errors: Optional[list[RepeatedWritingError]]
    # Over 30 days of grammar recommendations; null without an account (or
    # when the read failed: then named in sources_failed).
    weak_grammar_groups: Optional[list[WeakGrammarGroup]]
    sources_failed: list[str]
