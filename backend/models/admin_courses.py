"""Response contracts for the admin course ladder picker."""

from datetime import datetime
from typing import Literal

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
    # Migration 383 adds `courses.kind` (NOT NULL DEFAULT 'class'). The route
    # reads `select("*")`, so under extra="forbid" a missing field here turns
    # every row into a 500. Optional so the shape is the same before and after
    # 383 lands.
    kind: Literal["class", "online"] | None = None


class AdminCourseListOut(_StrictOut):
    courses: list[AdminCourseOut]
