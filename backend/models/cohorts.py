"""Typed superset for the admin cohort picker and rollup directory."""

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _StrictOut(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CohortCourseOut(_StrictOut):
    id: str
    code: str
    name: str
    sort_order: int
    is_active: bool


ARCHIVE_FIELDS = ("archived_at", "archived_by", "archive_reason")
# Migration 441 + the route's `instructor`: always emitted (null before 441
# and for a class without a teacher), so the picker shape does not change
# when the migration lands.
TEACHER_FIELDS = ("instructor_id", "weekly_schedule", "start_date", "instructor")


class CohortTeacherOut(_StrictOut):
    id: str
    name: str | None = None


class CohortScheduleSlotOut(_StrictOut):
    dow: int
    start: str


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
    # Migration 337 (CLASSARCHIVE-0030). The service reads cohorts with
    # select("*"), so these must be accepted the moment 337 is applied or
    # extra="forbid" turns every row into a 500. They are always emitted (null
    # before 337 and on live classes), so the picker shape does not change when
    # the migration lands. archive_reason is admin-only: this route requires
    # an admin.
    archived_at: datetime | None = None
    archived_by: str | None = None
    archive_reason: str | None = None
    # Migration 441 (G09-T24): select("*") returns these once 441 is applied,
    # so they are accepted (null before). `instructor` is the class teacher,
    # resolved by the route; `name` is null when the user row is missing.
    instructor_id: str | None = None
    weekly_schedule: list[CohortScheduleSlotOut] | None = None
    start_date: date | None = None
    instructor: CohortTeacherOut | None = None
    # Rollup-only fields are omitted from picker responses through
    # response_model_exclude_unset=True on the route.
    course: CohortCourseOut | None = None
    member_count: int | None = Field(default=None, ge=0)
    unactivated_count: int | None = Field(default=None, ge=0)

    @model_validator(mode="before")
    @classmethod
    def _archive_fields_always_present(cls, data: Any) -> Any:
        # Supplied as input, they count as set, so exclude_unset keeps them.
        if isinstance(data, dict):
            data = {key: None for key in ARCHIVE_FIELDS + TEACHER_FIELDS} | data
        return data


class AdminCohortListOut(_StrictOut):
    cohorts: list[AdminCohortOut]
    rollup_failed: bool | None = None
    course_lookup_failed: bool | None = None
    # G09-T24: teacher names could not be read; `instructor.name` is null.
    instructor_lookup_failed: bool | None = None


class CohortArchiveCountsOut(_StrictOut):
    """`fn_cohort_archive_counts` (migration 337)."""
    active_members: int = Field(ge=0)
    open_writing_gives: int = Field(ge=0)
    open_class_items: int = Field(ge=0)
    unused_class_codes: int = Field(ge=0)


class CohortArchivePreviewOut(_StrictOut):
    cohort_id: str
    counts: CohortArchiveCountsOut
