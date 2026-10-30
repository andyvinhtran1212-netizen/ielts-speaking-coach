"""Typed response contracts for the native admin overview dashboard."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _StrictOut(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DashboardWindowMetricOut(_StrictOut):
    count: int | None = Field(default=None, ge=0)
    window_days: Literal[7, 30, 90]


class DashboardVisitorsOut(DashboardWindowMetricOut):
    authenticated: int | None = Field(default=None, ge=0)
    anonymous: int | None = Field(default=None, ge=0)


class DashboardAttentionOut(_StrictOut):
    errors_undismissed: int | None = Field(default=None, ge=0)
    writing_pending: int | None = Field(default=None, ge=0)


class DashboardOverviewOut(_StrictOut):
    total_users: int | None = Field(default=None, ge=0)
    active_codes: int | None = Field(default=None, ge=0)
    distinct_visitors: DashboardVisitorsOut
    total_practices: int | None = Field(default=None, ge=0)
    grading_minutes: float | None = Field(default=None, ge=0)
    tokens_called: DashboardWindowMetricOut
    attention: DashboardAttentionOut
    computed_at: datetime


class DashboardTrendPointOut(_StrictOut):
    date: date
    value: int = Field(ge=0)


class DashboardTrendSeriesOut(_StrictOut):
    visitors: list[DashboardTrendPointOut]
    practices: list[DashboardTrendPointOut]
    tokens: list[DashboardTrendPointOut]


class DashboardTrendsOut(_StrictOut):
    days: Literal[7, 30, 90]
    series: DashboardTrendSeriesOut
    computed_at: datetime


class CohortStudentCountOut(_StrictOut):
    cohort_id: str | None = None
    cohort_name: str | None = None
    count: int = Field(ge=0)


class AdminStudentsOverviewOut(_StrictOut):
    total: int = Field(ge=0)
    active_7d: int = Field(ge=0)
    active_30d: int = Field(ge=0)
    by_cohort: list[CohortStudentCountOut]


class SpeakingOverviewOut(_StrictOut):
    sessions_total: int = Field(ge=0)
    sessions_7d: int = Field(ge=0)
    avg_band_7d: float | None = Field(default=None, ge=0, le=9)


class WritingOverviewOut(_StrictOut):
    essays_total: int = Field(ge=0)
    essays_7d: int = Field(ge=0)
    feedback_pending: int = Field(ge=0)


class ReadingOverviewOut(_StrictOut):
    attempts_total: int = Field(ge=0)
    attempts_7d: int = Field(ge=0)
    avg_score_7d: float | None = Field(default=None, ge=0, le=1)


class ListeningOverviewOut(ReadingOverviewOut):
    content_count: int = Field(ge=0)
    dictation_total: int = Field(ge=0)
    dictation_7d: int = Field(ge=0)


class VocabularyOverviewOut(_StrictOut):
    words_total: int = Field(ge=0)
    due_review_today: int = Field(ge=0)


class GrammarOverviewOut(_StrictOut):
    articles_viewed_7d: int = Field(ge=0)


class AdminSkillsOverviewOut(_StrictOut):
    speaking: SpeakingOverviewOut
    writing: WritingOverviewOut
    listening: ListeningOverviewOut
    reading: ReadingOverviewOut
    vocab: VocabularyOverviewOut
    grammar: GrammarOverviewOut


class AdminErrorOverviewOut(_StrictOut):
    undismissed: int = Field(ge=0)
    last_24h: int = Field(ge=0)
    last_7d: int = Field(ge=0)


class AccessCodeTypeOverviewOut(_StrictOut):
    mass: int = Field(ge=0)
    direct: int = Field(ge=0)
    staff: int = Field(ge=0)


class AccessCodeOverviewOut(_StrictOut):
    active: int = Field(ge=0)
    by_type: AccessCodeTypeOverviewOut


class RecentAdminActivityOut(_StrictOut):
    timestamp: datetime
    user_id: str | None = None
    user_email: str = ""
    skill: str
    action: str
    score: float | str | None = None
    link: str


class AdminOverviewOut(_StrictOut):
    students: AdminStudentsOverviewOut
    skills: AdminSkillsOverviewOut
    errors: AdminErrorOverviewOut
    access_codes: AccessCodeOverviewOut
    recent_activity: list[RecentAdminActivityOut]
    generated_at: datetime
