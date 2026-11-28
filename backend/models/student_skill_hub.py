"""Response model for GET /api/student/skill-hub (LEARNERCORE-0063 T25, FR-111..118)."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Skill = Literal["speaking", "writing", "listening", "reading"]


class SkillHubCredits(BaseModel):
    total: int
    # FR-116: computed by G04 charge_plan for this skill, never inferred from
    # the balance. `unknown` (the plan could not be read) is not "out of credits".
    metering: Literal["metered", "not_metered", "unknown"]


class SkillHubResumeItem(BaseModel):
    kind: Literal["speaking", "writing", "listening", "dictation", "reading"]
    title: str
    state: Literal["in_progress", "draft"]
    href: str
    updated_at: Optional[str] = None


class SkillHubStarter(BaseModel):
    title: str
    meta: Optional[str] = None
    uses_credit: bool = False
    href: str


class SkillHubSuggestion(BaseModel):
    kind: Literal["course_lesson", "assigned", "error_review", "least_practised"]
    title: str
    why: str
    href: str


class SkillHubCatalogGroup(BaseModel):
    group: str
    label: str
    # None when the group has no paper count (Speaking full test).
    count: Optional[int] = None
    # None until the learner has a submitted attempt in this skill (FR-114).
    done: Optional[int] = None
    href: str


class SkillHubResult(BaseModel):
    """FR-077: a band only when it is valid; `correct`/`total` only with total > 0."""
    band: Optional[float] = None
    correct: Optional[int] = None
    total: Optional[int] = None
    pending: bool = False


class SkillHubHistoryItem(BaseModel):
    submitted_at: Optional[str] = None
    title: str
    kind: str
    source: Literal["ai_instant", "teacher_review", "auto"]
    result: SkillHubResult
    href: Optional[str] = None


class SkillHubAccess(BaseModel):
    blocked: bool = False


class StudentSkillHubResponse(BaseModel):
    skill: Skill
    credits: Optional[SkillHubCredits] = None
    resume: list[SkillHubResumeItem] = Field(default_factory=list)
    starter: Optional[SkillHubStarter] = None
    suggestions: list[SkillHubSuggestion] = Field(default_factory=list)
    catalog: list[SkillHubCatalogGroup] = Field(default_factory=list)
    catalog_href: str
    history: list[SkillHubHistoryItem] = Field(default_factory=list)
    history_href: str
    access: SkillHubAccess = Field(default_factory=SkillHubAccess)
    degraded: list[Literal["credits", "resume", "suggestions", "catalog", "history"]] = Field(
        default_factory=list)
