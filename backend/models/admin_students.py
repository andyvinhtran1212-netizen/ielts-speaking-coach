"""Response contracts for the native admin student directory."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class _StrictOut(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AdminStudentCohortOut(_StrictOut):
    id: str
    name: str | None = None
    is_primary: bool


class AdminStudentDirectoryRowOut(_StrictOut):
    id: str
    student_code: str
    full_name: str
    target_band: float | None = Field(default=None, ge=0, le=9)
    target_date: date | None = None
    persona_notes: str | None = None
    current_band_estimate: float | None = Field(default=None, ge=0, le=9)
    user_id: str | None = None
    created_by: str | None = None
    created_at: datetime
    updated_at: datetime
    flag_count: int = Field(ge=0)
    last_flagged_at: datetime | None = None
    is_under_review: bool
    instructor_id: str | None = None
    cohort_id: str | None = None
    # Enrichment is canonical list truth from student_service._attach_cohort_memberships.
    cohorts: list[AdminStudentCohortOut]
    cohort_name: str | None = None
    cohort_lookup_failed: bool
    membership_lookup_failed: bool
