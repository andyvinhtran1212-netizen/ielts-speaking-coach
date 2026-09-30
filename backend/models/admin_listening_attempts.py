"""Admin attempt reads preserve the scoring policy frozen at start."""
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class AdminListeningAttemptUser(BaseModel):
    id: str | None
    email: str | None
    display_name: str | None


class AdminListeningAttemptTest(BaseModel):
    id: str | None
    test_id: str | None
    title: str | None
    test_type: str | None


class AdminListeningAttemptItem(BaseModel):
    id: str
    status: Literal['in_progress', 'submitted', 'abandoned']
    scoring_policy: Literal['diagnostic', 'report_only']
    score: int | None
    total_questions: int | None
    accuracy: float | None
    duration_seconds: int | None
    started_at: str | None
    submitted_at: str | None
    created_at: str | None
    user: AdminListeningAttemptUser
    test: AdminListeningAttemptTest


class AdminListeningAttemptListResponse(BaseModel):
    items: list[AdminListeningAttemptItem]
    total: int
    limit: int
    offset: int
    association_lookup_failed: bool
    association_lookup_failures: list[Literal['users', 'listening_tests']]


class AdminListeningQuestionRead(BaseModel):
    # Older diagnostic results may carry extra trap/display fields. Retain them
    # and preserve null correctness for blank/unscored report-only responses.
    model_config = ConfigDict(extra='allow')
    q_num: int
    correct: bool | None
    user_answer: str | int | float | bool | list[str] | None = None
    expected: str | int | float | bool | list[str] | None = None
    source_item_id: str | None = None
    response_type: str | None = None
    state: Literal['blank', 'checked', 'unscored', 'technical_error'] | None = None


class AdminListeningAttemptDetailResponse(AdminListeningAttemptItem):
    grading_details: list[AdminListeningQuestionRead]
    trap_analytics: dict[str, Any]
    band_estimate: float | None
    association_lookup_failed: bool
    association_lookup_failures: list[Literal['users', 'listening_tests']]
