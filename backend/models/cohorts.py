"""Typed superset for the admin cohort picker and rollup directory."""

from datetime import datetime
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
            data = {key: None for key in ARCHIVE_FIELDS} | data
        return data


class AdminCohortListOut(_StrictOut):
    cohorts: list[AdminCohortOut]
    rollup_failed: bool | None = None
    course_lookup_failed: bool | None = None
