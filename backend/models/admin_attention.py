"""Response contracts for Việc cần làm (ADMINIA-0074 FR-090…093, FR-104;
plan 5.4 ``GET /admin/attention``; G09-T06).

Every queue row is a :class:`QueueOut`. ``count`` is ``None`` when its source
failed (``error``) or the package it needs has not shipped (``unavailable``);
it is never a stand-in 0. The teacher shape (``InstructorAttentionOut``) has
no admin-only rows and no ``ops_week`` block at all.
"""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class _StrictOut(BaseModel):
    model_config = ConfigDict(extra="forbid")


class QueueOut(_StrictOut):
    count: Optional[int] = Field(default=None, ge=0)
    oldest_at: Optional[datetime] = None
    overdue: bool = False
    error: bool = False
    unavailable: bool = False


class WritingQueueOut(QueueOut):
    # AI-failed essays, part of ``count`` (FR-090 "AI lỗi nằm trong số Writing").
    ai_failed: Optional[int] = Field(default=None, ge=0)


class InstructorQueuesOut(_StrictOut):
    writing_review: WritingQueueOut
    speaking_mock_pending: QueueOut
    course_tests_awaiting_release: QueueOut
    assignments_overdue: QueueOut
    regrade_new: QueueOut
    care_due_today: QueueOut
    entitlements_expiring: QueueOut


class AdminQueuesOut(InstructorQueuesOut):
    exams_today: QueueOut
    enrollments_reported: QueueOut
    incident_groups_open: QueueOut
    feedback_open: QueueOut
    classes_unmetered: QueueOut


class LessonOut(_StrictOut):
    lesson_id: str
    lesson_no: Optional[int] = None
    date: date
    starts_at: Optional[time] = None


class ClassWeekOut(_StrictOut):
    cohort_id: str
    name: Optional[str] = None
    next_lesson: LessonOut
    following_lesson: Optional[LessonOut] = None
    has_assignment: bool
    pending_review: int = Field(ge=0)
    last_assignment_id: Optional[str] = None


class ReasonOut(_StrictOut):
    code: str
    text: str


class CohortRefOut(_StrictOut):
    id: str
    name: Optional[str] = None


class AttentionLearnerOut(_StrictOut):
    ref: str
    name: str
    cohort: Optional[CohortRefOut] = None
    reasons: list[ReasonOut]


class OnTimeRateOut(_StrictOut):
    value: float = Field(ge=0, le=1)
    lowest_cohort_id: Optional[str] = None


class OpsWeekOut(_StrictOut):
    # ``None``: no data or the read failed (``sources_failed`` says which).
    on_time_rate: Optional[OnTimeRateOut] = None
    inactive_learners: Optional[int] = Field(default=None, ge=0)
    review_wait_median_hours: Optional[float] = Field(default=None, ge=0)


class InstructorAttentionOut(_StrictOut):
    queues: InstructorQueuesOut
    # ``None`` when the block could not be read (never an empty stand-in).
    classes_week: Optional[list[ClassWeekOut]] = None
    attention_learners: Optional[list[AttentionLearnerOut]] = Field(default=None, max_length=8)
    # Block or source names that failed or are only partly decided, e.g.
    # "writing_review", "classes_week", "attention_learners.assignments", "thresholds".
    sources_failed: list[str] = Field(default_factory=list)
    generated_at: datetime


class AdminAttentionOut(InstructorAttentionOut):
    queues: AdminQueuesOut
    ops_week: OpsWeekOut
