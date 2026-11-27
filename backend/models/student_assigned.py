"""Response model for GET /api/student/assigned (LEARNERCORE-0063 amendment 3,
T30a, FR-095..FR-099, FR-102, FR-103; plan.md "Bài được giao")."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

AssignedGroup = Literal["overdue", "todo", "awaiting_review", "returned"]
AssignedAction = Literal["start", "resume", "review_submitted", "result", "self_practice", "none"]


class StudentAssignedItem(BaseModel):
    """One element of /api/class/my-assignments, unchanged, plus four fields the
    new page reads instead of deriving them in the browser."""

    # The base element (item_id, state, submitted_at, assignment, ...) is passed
    # through exactly as `_visible_assignments` builds it.
    model_config = ConfigDict(extra="allow")

    item_id: str
    group: AssignedGroup
    action: AssignedAction
    accepting: bool
    self_practice_available: bool


class StudentAssignedResponse(BaseModel):
    has_class: bool
    items: list[StudentAssignedItem] = Field(default_factory=list)
    # G04 class-source "repractice" grants (same data as FR-032). Empty until G04
    # ships them; the page hides the block when empty.
    repractice: list[dict[str, Any]] = Field(default_factory=list)
    homework_stale: bool = False
    degraded: list[Literal["items", "repractice"]] = Field(default_factory=list)
