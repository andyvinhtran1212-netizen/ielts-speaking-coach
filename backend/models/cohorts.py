"""Typed superset for the admin cohort picker and rollup directory."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class _StrictOut(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CohortCourseOut(_StrictOut):
    id: str
    code: str
    name: str
    sort_order: int
    is_active: bool


class AdminCohortOut(_StrictOut):
    id: str
    name: str
    code_prefix: str | None = None
    description: str | None = None
    is_active: bool
    created_by: str | None = None
    created_at: datetime
    updated_at: datetime
    course_id: str | None = None
    # Rollup-only fields are omitted from picker responses through
    # response_model_exclude_unset=True on the route.
    course: CohortCourseOut | None = None
    member_count: int | None = Field(default=None, ge=0)
    unactivated_count: int | None = Field(default=None, ge=0)


class AdminCohortListOut(_StrictOut):
    cohorts: list[AdminCohortOut]
    rollup_failed: bool | None = None
    course_lookup_failed: bool | None = None
