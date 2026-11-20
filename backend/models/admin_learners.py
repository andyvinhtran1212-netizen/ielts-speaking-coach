"""Response shapes of the learner directory (ADMINIA-0074 plan 5.4; G09-T03)."""

from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel


class LearnerCohort(BaseModel):
    id: str
    name: Optional[str]


class AttentionReason(BaseModel):
    code: Literal["late_streak", "inactive", "course_expiring", "low_credits"]
    text: str


class LearnerRow(BaseModel):
    ref: str
    name: str
    email: Optional[str]
    student_code: Optional[str]
    account_state: Literal["active", "locked", "none"]
    profile_state: Literal["active", "archived", "none"]
    # G04 has no read API yet: null, never a guess.
    kind: Optional[Literal["offline", "online", "both", "none"]]
    courses: Optional[list[dict]]
    credits_left: Optional[int]
    # null when the class lookup failed (sources_failed names "cohorts").
    cohorts: Optional[list[LearnerCohort]]
    attention: list[AttentionReason]
    last_active_at: Optional[str]


class LearnerDirectory(BaseModel):
    items: list[LearnerRow]
    total: int
    page: int
    page_size: int
    sources_failed: list[str]


class LearnerStatus(BaseModel):
    # null: nothing found but a source could not be read (never "Đang ổn").
    level: Optional[Literal["ok", "attention"]]
    reasons: list[AttentionReason]


class LearnerGoal(BaseModel):
    target_band: Optional[float]
    exam_date: Optional[date]
    source: Literal["admin", "learner", "both_equal", "conflict", "none"]


class LearnerOverdue(BaseModel):
    count: int
    latest_title: Optional[str]


class LearnerRecentBands(BaseModel):
    # [] no returned work yet; null the source could not be read.
    writing: Optional[list[float]]
    speaking: Optional[list[float]]


class LearnerNote(BaseModel):
    author: Optional[str]
    at: str
    text: str


class LearnerSummary(BaseModel):
    """CHUAN-ADMIN mục H: exactly these seven fields (name and classes count as one)."""
    name: str
    cohorts: Optional[list[LearnerCohort]]
    courses: Optional[list[dict]]
    status: LearnerStatus
    goal: LearnerGoal
    overdue: Optional[LearnerOverdue]
    recent_bands: LearnerRecentBands
    last_active_at: Optional[str]
    latest_note: Optional[LearnerNote]


class LearnerSummaryOut(LearnerSummary):
    sources_failed: list[str]


class LearnerDetail(BaseModel):
    ref: str
    canonical_ref: str
    summary: LearnerSummary
    sources_failed: list[str]
