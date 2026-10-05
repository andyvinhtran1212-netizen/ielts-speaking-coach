"""Admin analytics read contract. Historical grades remain unchanged."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from models.dictation_grading import (
    DictationErrorTrends, DictationSentenceResult, PolicyVersion, Sha256,
)


class DictationMissedWord(BaseModel):
    word: str
    count: int = Field(ge=1)


class DictationWrongWord(BaseModel):
    expected: str
    count: int = Field(ge=1)


class DictationPunctuationTrend(BaseModel):
    token: str
    count: int = Field(ge=1)


class DictationVersionAggregate(BaseModel):
    grading_version: PolicyVersion
    session_count: int = Field(ge=1)
    mean_accuracy: float = Field(ge=0, le=1)


class DictationAggregateResponse(BaseModel):
    session_count: int = Field(ge=0)
    mean_accuracy: float = Field(ge=0, le=1)
    mean_accuracy_basis: Literal['mean_of_session_sentence_scores']
    versions: list[DictationVersionAggregate]
    trend_classification: Literal['lexical-v1']
    trend_complete_session_count: int = Field(ge=0)
    trend_unavailable_session_count: int = Field(ge=0)
    top_missed: list[DictationMissedWord]
    top_wrong: list[DictationWrongWord]
    punctuation_missed: list[DictationPunctuationTrend]
    punctuation_wrong: list[DictationPunctuationTrend]
    punctuation_missed_total: int = Field(ge=0)
    punctuation_wrong_total: int = Field(ge=0)
    missing_token_missed_total: int = Field(ge=0)
    missing_token_wrong_total: int = Field(ge=0)


class AdminDictationUser(BaseModel):
    id: str | None
    email: str | None
    display_name: str | None


class AdminDictationReportItem(BaseModel):
    # Preserve older optional projections; absence is not a fabricated zero.
    model_config = ConfigDict(extra='allow')
    id: str
    user_id: str | None = None
    test_id_external: str | None = None
    section_num: int | None = None
    section_title: str | None = None
    total_sentences: int | None = Field(default=None, ge=0)
    correct_count: int | None = Field(default=None, ge=0)
    accuracy: float | None = Field(default=None, ge=0, le=1)
    total_time_seconds: int | None = None
    completed_at: str | None = None
    created_at: str | None = None
    user: AdminDictationUser
    grading_version: PolicyVersion
    reference_sha256: Sha256 | None


class AdminDictationReportListResponse(BaseModel):
    items: list[AdminDictationReportItem]
    total: int = Field(ge=0)
    limit: int = Field(ge=1)
    offset: int = Field(ge=0)
    association_lookup_failed: bool
    association_lookup_failures: list[Literal['users']]


class AdminDictationReportDetailResponse(AdminDictationReportItem):
    test_id: str | None = None
    attempt_id: str | None = None
    client_request_id: str | None = None
    total_words: int | None = Field(default=None, ge=0)
    correct_words: int | None = Field(default=None, ge=0)
    results: list[DictationSentenceResult]
    error_trends: DictationErrorTrends | None = None
    association_lookup_failed: bool
    association_lookup_failures: list[Literal['users']]
