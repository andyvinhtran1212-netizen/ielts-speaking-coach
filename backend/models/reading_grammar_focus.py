"""Bounded admin-only grammar-focus wire contracts (READINGGRAMMAR-0012)."""
from __future__ import annotations

import json
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AwareDatetime, BaseModel, ConfigDict, Field, StrictStr,
    field_validator, model_serializer, model_validator,
)


MAX_REQUEST_BYTES = 256 * 1024
Sha256 = Annotated[StrictStr, Field(pattern=r'^[0-9a-f]{64}$')]


class ReadingGrammarFocusItem(BaseModel):
    """Legacy reads preserve omitted keys and do not invent empty strings."""
    model_config = ConfigDict(extra='forbid')
    point: StrictStr
    example: StrictStr = ''
    analysis: StrictStr = ''
    review: StrictStr = ''
    tip: StrictStr = ''

    @field_validator('point')
    @classmethod
    def nonblank_point(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('point must not be blank')
        return value

    @model_serializer(mode='wrap')
    def preserve_optional_keys(self, handler):
        return {key: value for key, value in handler(self).items()
                if key == 'point' or key in self.model_fields_set}


class ReadingGrammarFocusEditItem(ReadingGrammarFocusItem):
    point: StrictStr = Field(max_length=500)
    example: StrictStr = Field(default='', max_length=5000)
    analysis: StrictStr = Field(default='', max_length=10000)
    review: StrictStr = Field(default='', max_length=5000)
    tip: StrictStr = Field(default='', max_length=3000)


class ReadingGrammarFocusEditRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_revision: Sha256
    operation_id: UUID
    grammar_focus: list[ReadingGrammarFocusEditItem] = Field(max_length=20)

    @model_validator(mode='after')
    def bounded_utf8(self):
        # The router also checks the ORIGINAL request bytes before decoding.
        # This protects direct service callers and multi-byte accepted text.
        value = self.model_dump(mode='json')
        size = len(json.dumps(value, ensure_ascii=False, separators=(',', ':'),
                              allow_nan=False).encode('utf-8'))
        if size > MAX_REQUEST_BYTES:
            raise ValueError('request exceeds 256KiB UTF-8 JSON')
        return self


class ReadingGrammarFocusRead(BaseModel):
    model_config = ConfigDict(extra='forbid')
    passage_id: UUID
    slug: StrictStr
    library: Literal['l1_vocab']
    title: StrictStr
    status: Literal['draft', 'published', 'archived']
    body_markdown: StrictStr
    grammar_focus: list[ReadingGrammarFocusItem]
    updated_at: AwareDatetime
    revision: Sha256
    source_sha256: Sha256
    unrelated_metadata_sha256: Sha256
    questions_sha256: Sha256


class ReadingGrammarFocusEditResult(BaseModel):
    model_config = ConfigDict(extra='forbid')
    passage_id: UUID
    slug: StrictStr
    library: Literal['l1_vocab']
    outcome: Literal['updated', 'unchanged', 'already_applied']
    operation_id: UUID
    committed_revision: Sha256
    current_revision: Sha256
    current_matches_committed: bool
    updated_at: AwareDatetime
    grammar_focus: list[ReadingGrammarFocusItem]
    source_sha256: Sha256 = Field(description='Committed operation source fingerprint, retained in its receipt.')
    unrelated_metadata_sha256: Sha256 = Field(description='Committed operation unrelated-metadata fingerprint.')
    questions_sha256: Sha256 = Field(description='Committed operation question fingerprint; never raw answers.')
    current_source_sha256: Sha256
    current_unrelated_metadata_sha256: Sha256
    current_questions_sha256: Sha256


class ReadingGrammarFocusErrorDetail(BaseModel):
    model_config = ConfigDict(extra='forbid')
    error_code: Literal[
        'reading_grammar_focus_not_found', 'reading_grammar_focus_invalid_state',
        'reading_grammar_focus_unavailable', 'reading_grammar_focus_lock_unavailable',
        'reading_grammar_focus_revision_conflict', 'reading_grammar_focus_operation_conflict',
        'reading_grammar_focus_receipt_invalid', 'reading_grammar_focus_request_invalid',
    ]
    message: str
    current_revision: Sha256 | None = None


class ReadingGrammarFocusErrorResponse(BaseModel):
    detail: ReadingGrammarFocusErrorDetail
