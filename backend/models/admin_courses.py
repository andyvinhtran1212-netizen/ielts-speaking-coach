"""Response contracts for the admin course ladder picker."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class _StrictOut(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AdminCourseOut(_StrictOut):
    id: str
    code: str
    name: str
    description: str | None = None
    sort_order: int
    is_active: bool
    created_by: str | None = None
    created_at: datetime
    updated_at: datetime


class AdminCourseListOut(_StrictOut):
    courses: list[AdminCourseOut]
