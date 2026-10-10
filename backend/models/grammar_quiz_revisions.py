"""Bounded Grammar-only revision contracts (GRAMMARCUTOVER-0014).

The private cohort proof never enters these public wire models.
"""
from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID
from services.grammar_quiz_policy import CANONICAL_CODES

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr, model_validator

Sha256 = Annotated[StrictStr, Field(pattern=r'^[0-9a-f]{64}$')]
CanonicalCode = Literal[*sorted(CANONICAL_CODES)]
TextMatchPolicy = Literal['qid-exact-v1']
MAX_SOURCE_BYTES = 256 * 1024


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class GrammarRevisionFootprint(_StrictModel):
    actors: int = Field(ge=0, le=128)
    sessions: int = Field(ge=0, le=2048)
    stats: int = Field(ge=0, le=8192)
    attempts: int = Field(ge=0, le=32768)
    assignments: int = Field(ge=0)
    open_sessions: int = Field(ge=0)
    paused_sessions: int = Field(ge=0)
    classifications: dict[StrictStr, int]
    authoritative_review_required: bool


class GrammarRevisionRead(_StrictModel):
    canonical_code: CanonicalCode
    original_bank_id: UUID
    canonical_root_bank_id: UUID
    publication_available: bool
    bank_ids: list[UUID] = Field(min_length=1, max_length=3)
    current_bank_id: UUID
    topic_id: UUID
    revision: Sha256
    current_bank_revision: Sha256
    original_questions_sha256: Sha256
    original_metadata_sha256: Sha256
    is_managed: bool
    new_starts_enabled: bool
    footprint: GrammarRevisionFootprint


class GrammarRevisionPreviewRequest(_StrictModel):
    source_markdown: StrictStr
    expected_revision: Sha256

    @model_validator(mode='after')
    def bounded_source(self):
        try:
            size = len(self.source_markdown.encode('utf-8'))
        except UnicodeError:
            raise ValueError('source must be valid UTF-8') from None
        if not self.source_markdown or size > MAX_SOURCE_BYTES:
            raise ValueError('source must contain 1..256KiB UTF-8 bytes')
        return self


class GrammarRevisionCommitRequest(GrammarRevisionPreviewRequest):
    preview_fingerprint: Sha256
    operation_id: UUID


class GrammarRevisionChange(_StrictModel):
    qid: StrictStr
    fields: list[StrictStr]
    before_sha256: Sha256
    after_sha256: Sha256


class GrammarRevisionPreview(_StrictModel):
    canonical: GrammarRevisionRead
    source_sha256: Sha256
    manifest_sha256: Sha256
    preview_fingerprint: Sha256
    proposed_revision: Sha256
    changed_questions: list[GrammarRevisionChange]
    validation_messages: list[StrictStr]


class GrammarRevisionCommitResult(_StrictModel):
    canonical_code: CanonicalCode
    operation_id: UUID
    outcome: Literal['applied', 'already_applied']
    original_bank_id: UUID
    corrected_bank_id: UUID
    source_sha256: Sha256
    committed_revision: Sha256
    current_revision: Sha256
    current_matches_committed: bool
    original_questions_sha256: Sha256
    original_history_sha256: Sha256
    canonical: GrammarRevisionRead


class GrammarRevisionErrorDetail(_StrictModel):
    error_code: StrictStr
    message: StrictStr
    current_revision: Sha256 | None = None


class GrammarRevisionValidationIssue(BaseModel):
    loc: list[str | int]
    msg: str
    type: str
    input: object | None = None
    ctx: dict[str, object] | None = None


class GrammarRevisionErrorResponse(_StrictModel):
    detail: GrammarRevisionErrorDetail | list[GrammarRevisionValidationIssue]


class ManagedGrammarStart(_StrictModel):
    grammar_revision: Sha256
    admission_kind: Literal['run', 'review'] = 'run'
    text_match_policy: TextMatchPolicy | None = None


class ManagedGrammarSessionState(_StrictModel):
    canonical_code: CanonicalCode
    bank_id: UUID
    bank_revision: Sha256
    content_state: Literal['original', 'current', 'legacy']
    new_starts_enabled: StrictBool
    can_continue_legacy: StrictBool
    can_continue_current: StrictBool = False
    mastery_retained: StrictBool = False
    current_bank_id: UUID
    current_bank_revision: Sha256
    text_match_policy: TextMatchPolicy | None = None


class QuizBankPlayResponse(BaseModel):
    model_config = ConfigDict(extra='allow')
    bank: dict[str,Any]
    questions: list[dict[str,Any]]
    word_cards: dict[str,Any]
    grammar: ManagedGrammarSessionState | None = None


class QuizSessionStartResponse(BaseModel):
    model_config = ConfigDict(extra='allow')
    session_id: UUID
    resume: list[dict[str,Any]]
    grammar: ManagedGrammarSessionState | None = None


class QuizSessionProgressResponse(BaseModel):
    model_config = ConfigDict(extra='allow')
    ok: StrictBool
    attempts: int = Field(ge=0,le=200)
    word_stats: int = Field(ge=0,le=200)
    grammar: ManagedGrammarSessionState | None = None


class QuizSessionEndResponse(BaseModel):
    model_config = ConfigDict(extra='allow')
    id: UUID
    bank_id: UUID | None = None
    grammar_revision: Sha256 | None = None
    grammar: ManagedGrammarSessionState | None = None
