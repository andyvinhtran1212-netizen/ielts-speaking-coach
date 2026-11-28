"""Response model for GET /api/student/tests (LEARNERCORE-0063 T16, plan.md)."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Skill = Literal["listening", "reading", "writing", "speaking"]


class AssignedExamRow(BaseModel):
    exam_id: str
    title: str
    mode: Optional[Literal["live", "self_paced"]] = None
    state: Literal["upcoming", "open", "submitted", "released", "closed_missed"]
    opens_at: Optional[str] = None
    closes_at: Optional[str] = None
    skills: Optional[list[Skill]] = None
    total_minutes: Optional[int] = None
    has_sitting_in_progress: bool = False
    href: str


class ExamResultRow(BaseModel):
    kind: Literal["listening_full", "listening_mini", "reading_full", "reading_mini",
                  "speaking_full", "writing_full", "mock"]
    id: str
    title: str
    submitted_at: str
    # Mock sittings only: `released` carries scores; every other state carries none.
    state: Optional[Literal["submitted", "grading", "reviewing", "released"]] = None
    band: Optional[float] = None
    correct: Optional[int] = None
    total: Optional[int] = None
    pending_skills: Optional[list[Skill]] = None
    overall: Optional[float] = None
    href: str


class ExamCredits(BaseModel):
    total: int


class StudentTestsResponse(BaseModel):
    assigned_exams: list[AssignedExamRow] = Field(default_factory=list)
    results: list[ExamResultRow] = Field(default_factory=list)
    results_next_cursor: Optional[str] = None
    credits: Optional[ExamCredits] = None
    degraded: list[Literal["assigned_exams", "results", "credits"]] = Field(default_factory=list)
