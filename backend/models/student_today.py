"""Response models for GET /api/student/today (LEARNERCORE-0063 T13, plan.md)."""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import AwareDatetime, BaseModel, Field


class TodayStudent(BaseModel):
    name: str


class TodayResumeItem(BaseModel):
    kind: Literal["speaking", "reading", "listening", "dictation"]
    title: str
    progress: Optional[dict[str, int]] = None
    href: str
    expires_at: Optional[str] = None


class TodayGoal(BaseModel):
    target_band: float
    exam_date: Optional[str] = None
    weeks_left: Optional[int] = None


class TodayNewResult(BaseModel):
    kind: Literal["writing", "speaking"]
    title: str
    returned_at: str
    key: str
    href: str


class TodaySeenCursor(BaseModel):
    seen_until: str
    seen_key: str


class TodayRepeatError(BaseModel):
    label: str
    count: int
    of: int
    review_href: Optional[str] = None
    total_errors: int


class StudentTodayResumeResponse(BaseModel):
    resume: list[TodayResumeItem]
    degraded: list[Literal["resume"]]


class StudentTodayResponse(BaseModel):
    student: TodayStudent
    next_lesson: Optional[dict[str, Any]] = None
    # Same element shape as /api/class/my-assignments (routers/class_student).
    assigned: list[dict[str, Any]] = Field(default_factory=list)
    assigned_total_open: int = 0
    assigned_due_soon: int = 0
    assigned_due_later: int = 0
    resume: list[TodayResumeItem] = Field(default_factory=list)
    state: Literal["learning", "first_day", "order_pending", "no_course"]
    banner: Optional[Literal["expiring", "expired", "out_of_credits"]] = None
    access: list[dict[str, Any]] = Field(default_factory=list)
    credits: Optional[dict[str, Any]] = None
    orders_open: list[dict[str, Any]] = Field(default_factory=list)
    goal: Optional[TodayGoal] = None
    new_results: list[TodayNewResult] = Field(default_factory=list)
    new_results_cursor: Optional[TodaySeenCursor] = None
    repeat_error: Optional[TodayRepeatError] = None
    trial_today_left: Optional[int] = None
    open_surveys: list[dict[str, Any]] = Field(default_factory=list)
    mock_exams: list[dict[str, Any]] = Field(default_factory=list)
    degraded: list[str] = Field(default_factory=list)


class TodaySeenRequest(BaseModel):
    seen_until: AwareDatetime
    seen_key: str = Field(min_length=3, max_length=80)
