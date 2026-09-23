"""Response contract for the admin Writing grading queue."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _StrictOut(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AdminWritingQueueRowOut(_StrictOut):
    id: str
    student_id: str
    task_type: Literal["task1_academic", "task1_general", "task2"]
    status: Literal["pending", "grading", "graded", "reviewed", "delivered", "failed"]
    analysis_level: int = Field(ge=1, le=5)
    selected_model: str
    word_count: int = Field(ge=0)
    created_at: datetime
    delivered_at: datetime | None = None
    error_message: str | None = None
    sitting_id: str | None = None
    grading_skipped_at: datetime | None = None
    student_full_name: str | None = None
    student_code: str | None = None
    band: float | None = Field(default=None, ge=0, le=9)
    deadline: datetime | None = None
    task1_image_missing: bool


class AdminWritingQueuePageOut(_StrictOut):
    items: list[AdminWritingQueueRowOut]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)
    total_complete: bool
