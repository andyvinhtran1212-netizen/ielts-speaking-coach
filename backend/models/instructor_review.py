"""Pydantic models for the Instructor tier review queue (Sprint 2.7d.1).

Maps to the `instructor_reviews` table (migration 047). One row per
Instructor-tier essay; created after AI Standard Pass 1 completes,
flips to 'delivered' when an instructor reviews and ships.

The student-facing instructor note keeps using the existing
`writing_essays.instructor_note` column (migration 043) — the
`InstructorReview.instructor_note` field below is the audit-trail
copy at the queue/review level. The deliver action mirrors the text
onto both columns; see `services/instructor_workflow.deliver`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class InstructorReviewStatus(str, Enum):
    """Workflow state. Lifecycle:

      queued    — created post-Pass 1, awaiting an instructor
      claimed   — an instructor has locked it for editing
      edited    — instructor saved feedback edits but hasn't delivered
                  (optional waypoint — deliver from claimed is also fine)
      delivered — student can see; final state for the happy path
      released  — instructor abandoned claim; status flips back to
                  'queued' with claimed_by NULL (RELEASED is a
                  transient label the workflow uses; the row's
                  resting state is 'queued' again)
    """
    QUEUED = "queued"
    CLAIMED = "claimed"
    EDITED = "edited"
    DELIVERED = "delivered"
    RELEASED = "released"


class InstructorReview(BaseModel):
    """One row from the `instructor_reviews` table."""

    id: UUID
    essay_id: UUID
    status: InstructorReviewStatus

    claimed_by: Optional[UUID] = None
    claimed_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None

    # Audit-trail copy of the instructor's note at delivery. The
    # student-facing copy lives on writing_essays.instructor_note
    # (migration 043). Both are populated by the deliver action so
    # the student-result page's existing rendering path keeps
    # working unchanged.
    instructor_note: Optional[str] = None

    created_at: datetime
    updated_at: datetime

    @property
    def age_hours(self) -> float:
        """Soft SLA tracking. Display-only — there's no enforcement
        on overdue reviews in 2.7d.1 (per spec: 'soft track only').
        Comparison uses timezone-aware UTC so this works regardless
        of whether the DB returned naive or tz-aware timestamps."""
        now = datetime.now(timezone.utc)
        created = self.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        return (now - created).total_seconds() / 3600.0

    @property
    def is_overdue(self) -> bool:
        """Soft flag — the queue UI colors overdue rows red but the
        backend doesn't auto-flag, auto-assign, or page on this. >48h
        is the threshold the spec calls out for the Instructor tier
        SLA promise (24-48h turnaround)."""
        return self.age_hours > 48 and self.status != InstructorReviewStatus.DELIVERED


class InstructorQueueItem(BaseModel):
    """Aggregate shape for queue list display.

    Joins `instructor_reviews` with the essay + student so the
    queue page can render a row with student email, level, task
    type, and submission age in one fetch.

    The student email field is stripped to None for student-facing
    callers (none today — the queue is admin-only); the queue
    endpoint always returns the full shape because admin needs to
    see who the row is for.
    """

    review: InstructorReview
    essay_id: UUID
    student_email: Optional[str] = None
    student_level: int = Field(ge=1, le=5)
    task_type: str
    submitted_at: datetime
    age_hours: float
    is_overdue: bool


class DeliverRequest(BaseModel):
    """POST /admin/instructor/reviews/{id}/deliver payload."""

    instructor_note: Optional[str] = None
