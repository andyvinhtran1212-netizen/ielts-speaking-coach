"""Response contracts for the native admin user directory."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _StrictOut(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AdminUserCodeSummaryRowOut(_StrictOut):
    id: str
    code: str | None = None
    code_type: str | None = None
    # The current batched summary only projects the three fields above. Keep
    # these optional for rolling compatibility with older/newer projections.
    permissions: list[str] = Field(default_factory=list)
    is_active: bool | None = None
    created_at: datetime | None = None


class AdminUserCodeSummaryOut(_StrictOut):
    codes: list[AdminUserCodeSummaryRowOut]
    code_count: int = Field(ge=0)
    code_type: str | None = None
    permissions: list[str]
    has_active_code: bool


class AdminUserDirectoryRowOut(_StrictOut):
    id: str
    email: str | None = None
    display_name: str | None = None
    created_at: datetime | None = None
    is_active: bool | None = None
    # `user` is a validated legacy database value; the frontend deliberately
    # normalizes it to the learner-facing `student` role.
    role: Literal["user", "student", "instructor", "admin"] | None = None
    sessions_today: int = Field(ge=0)
    cohort_name: str | None = None
    cohort_names: list[str]
    cohort_lookup_failed: bool
    code_summary: AdminUserCodeSummaryOut
