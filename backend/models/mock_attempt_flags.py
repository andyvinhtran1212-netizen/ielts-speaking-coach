"""Owner-scoped, per-question review flag protocol; no answer replacement."""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class QuestionReviewFlag(BaseModel):
    q_num: int = Field(ge=1, le=40, strict=True)
    question_id: str = Field(min_length=1, max_length=160)
    flagged: bool = Field(strict=True)
    revision: int = Field(ge=0, strict=True)
    updated_at: datetime | None = None


class ReviewFlagStateResponse(BaseModel):
    attempt_id: UUID
    protocol: Literal["question-cas-v1"] = "question-cas-v1"
    review_flags: list[QuestionReviewFlag]


class ReviewFlagPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    q_num: int = Field(ge=1, le=40, strict=True)
    flagged: bool = Field(strict=True)
    expected_revision: int = Field(ge=0, le=9223372036854775806, strict=True)
    operation_id: UUID


class ReviewFlagWriteResponse(QuestionReviewFlag):
    attempt_id: UUID
    protocol: Literal["question-cas-v1"] = "question-cas-v1"
    operation_id: UUID
    accepted: bool
    reason: Literal["applied", "replayed", "conflict"]
