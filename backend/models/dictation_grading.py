"""Additive policy/evidence contracts for the existing Dictation attempt flow."""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictStr

PolicyVersion = Literal['legacy-whitespace-v1', 'lexical-v2']
Sha256 = Annotated[StrictStr, Field(pattern=r'^[0-9a-f]{64}$')]


class DictationCapabilities(BaseModel):
    new_start_versions: list[PolicyVersion]
    readable_versions: list[PolicyVersion]


class DictationSpan(BaseModel):
    segment_index: int = Field(ge=0)
    start: int = Field(ge=0)
    end: int = Field(ge=0)


class DictationSegment(BaseModel):
    kind: Literal['lexical', 'unscored', 'whitespace']
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    raw: str
    reason: str


class DictationAmbiguity(BaseModel):
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    reason: str


class DictationDiffOperation(BaseModel):
    op: Literal['match', 'miss', 'wrong', 'extra']
    expected: str | None
    actual: str | None
    filler: bool | None = None
    expected_span: DictationSpan | None = None
    actual_span: DictationSpan | None = None


class DictationGrade(BaseModel):
    score: float = Field(ge=0, le=1)
    correct_words: int = Field(ge=0)
    total_words: int = Field(ge=0)
    is_correct: bool
    diff: list[DictationDiffOperation]
    grading_version: PolicyVersion
    reference_sha256: Sha256 | None = None
    sentence_reference_sha256: Sha256 | None = None
    offset_unit: Literal['unicode_codepoint'] | None = None
    reference: str | None = None
    user_text: str | None = None
    reference_segments: list[DictationSegment] | None = None
    user_segments: list[DictationSegment] | None = None
    reference_ambiguities: list[DictationAmbiguity] | None = None
    user_ambiguities: list[DictationAmbiguity] | None = None


class DictationSavedAnswer(BaseModel):
    attempt_id: str
    sentence_idx: int = Field(ge=0)
    user_transcript: str
    score: float = Field(ge=0, le=1)
    correct_words: int = Field(ge=0)
    total_words: int = Field(ge=0)
    diff: list[DictationDiffOperation]
    listen_count: int = Field(ge=0)
    time_seconds: int | None = None
    updated_at: str | None = None
    grading_version: PolicyVersion
    reference_sha256: Sha256 | None = None
    sentence_reference_sha256: Sha256 | None = None
    grading_evidence: DictationGrade | None = None


class DictationSentenceGrade(DictationGrade, DictationSavedAnswer):
    pass


class DictationUnit(BaseModel):
    text: str
    start: float | None = None
    end: float | None = None
    hints: list[str] = Field(default_factory=list)


class DictationAttemptResponse(BaseModel):
    attempt_id: str
    test_id: str
    section_num: int
    status: Literal['in_progress', 'completed', 'abandoned']
    renderer_affinity: Literal['legacy', 'next'] | None = None
    started_at: str | None = None
    resume_expires_at: str | None = None
    units: list[DictationUnit]
    answers: list[DictationSavedAnswer]
    grading_version: PolicyVersion
    reference_sha256: Sha256 | None = None


class DictationAttemptStartResponse(DictationAttemptResponse):
    created: bool


class DictationResumeResponse(BaseModel):
    attempt: DictationAttemptResponse | None


class DictationTrendWord(BaseModel):
    word: str
    count: int = Field(ge=0)


class DictationTrendWrong(BaseModel):
    expected: str
    count: int = Field(ge=0)
    common_actual: list[str] = Field(default_factory=list)


class DictationOperationCounts(BaseModel):
    miss: int = Field(ge=0)
    wrong: int = Field(ge=0)
    extra: int = Field(ge=0)


class DictationErrorTrends(BaseModel):
    op_counts: DictationOperationCounts | None = None
    missed: dict[str, int] | None = None
    wrong: dict[str, int] | None = None
    top_missed: list[DictationTrendWord] | None = None
    top_wrong: list[DictationTrendWrong] | None = None


class DictationSentenceResult(BaseModel):
    sentence_idx: int = Field(ge=0)
    reference: str | None = None
    user_text: str
    score: float = Field(ge=0, le=1)
    correct_words: int = Field(ge=0)
    total_words: int = Field(ge=0)
    diff: list[DictationDiffOperation] | None = None
    listen_count: int = Field(ge=0)
    time_seconds: int | None = None
    ops: DictationOperationCounts | None = None
    grading_version: PolicyVersion | None = None
    reference_sha256: Sha256 | None = None
    sentence_reference_sha256: Sha256 | None = None
    grading_evidence: DictationGrade | None = None


class DictationSessionResponse(BaseModel):
    session_id: str
    attempt_id: str | None = None
    client_request_id: str | None = None
    test_title: str | None = None
    section_num: int | None = None
    total_time_seconds: int | None = None
    total_sentences: int = Field(ge=0)
    correct_count: int = Field(ge=0)
    accuracy: float = Field(ge=0, le=1)
    total_words: int = Field(ge=0)
    correct_words: int = Field(ge=0)
    error_trends: DictationErrorTrends
    results: list[DictationSentenceResult]
    grading_version: PolicyVersion
    reference_sha256: Sha256 | None = None


class DictationStoredSessionResponse(BaseModel):
    # The existing owner GET returns the persisted row, rather than the
    # completion POST's session_id projection. Keep optional historical fields.
    model_config = ConfigDict(extra='allow')
    id: str
    user_id: str | None = None
    test_id: str | None = None
    attempt_id: str | None = None
    client_request_id: str | None = None
    test_id_external: str | None = None
    section_num: int | None = None
    section_title: str | None = None
    total_sentences: int | None = Field(default=None, ge=0)
    correct_count: int | None = Field(default=None, ge=0)
    accuracy: float | None = Field(default=None, ge=0, le=1)
    total_words: int | None = Field(default=None, ge=0)
    correct_words: int | None = Field(default=None, ge=0)
    total_time_seconds: int | None = None
    results: list[DictationSentenceResult]
    error_trends: DictationErrorTrends | None = None
    grading_version: PolicyVersion
    reference_sha256: Sha256 | None


class DictationPolicyDetail(BaseModel):
    error_code: str
    message: str


class DictationValidationIssue(BaseModel):
    loc: list[str | int]
    msg: str
    type: str
    input: object | None = None
    ctx: dict[str, object] | None = None


class DictationPolicyErrorResponse(BaseModel):
    detail: DictationPolicyDetail | list[DictationValidationIssue] | str
