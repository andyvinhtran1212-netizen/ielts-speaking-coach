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


class StudentQuizQuestion(_StrictModel):
    """One question as the learner's player may see it (SA-BANK-ANSWERS §5.1).

    `extra='forbid'` makes a column added to `quiz_questions` fail closed
    instead of riding `select("*")` to every learner.  The key-bearing fields
    are optional: Grammar/Vocab self-study still grades in the browser (QĐ-5,
    until J412), while Course banks never carry them (graded on the server).
    Value types stay permissive: the allowlist is the security boundary, and a
    surprising JSONB shape must not take a working learner page down.
    """
    id: Any = None
    qid: StrictStr
    item_key: Any = None
    type: Any = None
    subtype: Any = None
    input: Any = None
    skill: Any = None
    pair: Any = None
    counts_toward_mastery: Any = None
    prompt: Any = None
    options: Any = None
    segments: Any = None
    mask: Any = None
    points: Any = None
    order: Any = None
    audio_url: Any = None
    article_url: Any = None
    grammar_article_slug: Any = None
    answer: Any = None
    accept: Any = None
    explain: Any = None
    why_wrong: Any = None
    hint: Any = None


class QuizBankPlayResponse(_StrictModel):
    bank: dict[str,Any]
    questions: list[StudentQuizQuestion]
    word_cards: dict[str,Any]
    grammar: ManagedGrammarSessionState | None = None
    mastery: dict[str,Any] | None = None


class AdminQuizQuestion(BaseModel):
    """Teacher/admin editor row: every stored column, keys included.

    Deliberately a separate model: the learner allowlist above must never be
    reused for the editor (it would drop keys), nor this one for learners.
    """
    model_config = ConfigDict(extra='allow')
    qid: StrictStr
    answer: Any = None
    accept: Any = None
    explain: Any = None
    why_wrong: Any = None
    hint: Any = None
    pairs: Any = None
    mask: Any = None
    segments: Any = None


class AdminQuizBankDetailResponse(_StrictModel):
    bank: dict[str,Any]
    questions: list[AdminQuizQuestion]


class QuizSessionStartResponse(_StrictModel):
    session_id: UUID
    resume: list[dict[str,Any]]
    grammar: ManagedGrammarSessionState | None = None
    # Course sessions only: the canonical assignment clock at session start.
    timer: dict[str,Any] | None = None


class QuizAttemptFeedback(_StrictModel):
    """Server verdict for ONE Course mastery answer that is already recorded."""
    qid: StrictStr
    client_id: StrictStr | None = None
    is_correct: StrictBool
    answer: int | None = None
    why_wrong: StrictStr | None = None
    explain: StrictStr | None = None


class QuizSessionProgressResponse(_StrictModel):
    ok: StrictBool
    attempts: int = Field(ge=0,le=200)
    word_stats: int = Field(ge=0,le=200)
    grammar: ManagedGrammarSessionState | None = None
    # Course mastery only, and only for rows this request now has on record.
    feedback: list[QuizAttemptFeedback] | None = None


class QuizSessionEndResponse(BaseModel):
    model_config = ConfigDict(extra='allow')
    id: UUID
    bank_id: UUID | None = None
    grammar_revision: Sha256 | None = None
    grammar: ManagedGrammarSessionState | None = None
