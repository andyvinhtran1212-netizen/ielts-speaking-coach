"""Shapes of the incident inbox API (ADMINIA-0074 FR-070, FR-071; plan 5.4;
G09-T07)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

Source = Literal["errors", "grading", "feedback"]
Status = Literal["new", "in_review", "resolved", "ignored"]


class IncidentGroupItem(BaseModel):
    source: Source
    fingerprint: str
    title: str
    area: str
    level: Optional[str] = None
    count: int
    learners: int
    first_at: Optional[str]
    last_at: Optional[str]
    status: Status
    claimed_by_name: Optional[str] = None
    overdue: bool


class IncidentCounts(BaseModel):
    """Open (Mới + Đang xem) groups per source; ``None`` when the source failed."""
    errors: Optional[int]
    grading: Optional[int]
    feedback: Optional[int]


class IncidentGroupsOut(BaseModel):
    items: list[IncidentGroupItem] = Field(max_length=25)
    total: int
    page: int
    page_size: int
    counts: IncidentCounts
    # Open answer reports, a count only: they are handled in "Câu cần kiểm".
    review_items_open: Optional[int]
    # Sources whose read failed: their groups are absent, not empty.
    sources_failed: list[Source]
    # Sources with more than 5,000 rows: only the newest 5,000 were grouped.
    truncated: bool
    sources_truncated: list[Source]
    generated_at: str


class IncidentLearner(BaseModel):
    ref: str            # learner profile link: /admin/learners/{ref}
    name: str


class IncidentNote(BaseModel):
    body: str
    auto: bool
    actor_name: Optional[str] = None
    created_at: Optional[str] = None


class IncidentGroupDetail(IncidentGroupItem):
    description: str
    claimed_at: Optional[str] = None
    resolved_at: Optional[str] = None
    learner_list: list[IncidentLearner]
    # Collapsed by default on the page ("Chi tiết kỹ thuật").
    technical: dict
    notes: list[IncidentNote]


class IncidentGroupRef(BaseModel):
    source: Source
    fingerprint: str = Field(pattern=r"^[0-9a-f]{40}$")
    expected_count: int = Field(ge=0)
    # The group's ``last_at`` as the page showed it. For a source that was cut
    # at the scan limit the count can shift without a new record, so there only
    # a newer record than this is a conflict (CR M1).
    expected_last_at: Optional[datetime] = None


class IncidentBulkIn(BaseModel):
    groups: list[IncidentGroupRef] = Field(min_length=1, max_length=500)
    action: Literal["resolve", "claim", "ignore", "reopen"]
    note: Optional[str] = Field(default=None, max_length=2000)


class IncidentConflict(BaseModel):
    source: Source
    fingerprint: str
    status: int                  # 409 count changed · 404 unknown group · 503 write failed
    code: Literal["count_changed", "not_found", "write_failed"]
    expected_count: Optional[int] = None
    actual_count: Optional[int] = None
    expected_last_at: Optional[str] = None
    actual_last_at: Optional[str] = None


class IncidentBulkOut(BaseModel):
    changed: int
    conflicts: list[IncidentConflict]
    # Resolved error groups whose error_logs rows could not all be dismissed;
    # the group itself is resolved.
    dismiss_failed: list[str]
