"""Typed public/protected transport for the source-faithful 80-day collection."""
from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

SOURCE_PROGRAMME = "ielts-80-days-listening"
SOURCE_COLLECTION = "80-days"
SOURCE_CONTRACT = "source_book_v1"
GroupKind = Literal["short_practice", "teaching", "vocabulary", "mock"]
ReviewVerdict = Literal["CONFIRMED", "SUSPECT", "AMBIGUOUS", "UNRESOLVED"]


class SourceModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class SourceAvailability(SourceModel):
    questions: str = "available"
    audio: str = "missing"
    transcript: str = "missing"
    printed_key: str = "missing"
    explanations: str = "reviewed"


class SourceInstruction(SourceModel):
    source_en: str = ""
    student_vi: str = ""
    word_limit: int | None = None
    select_count: int | None = None


class SourceOption(SourceModel):
    id: str
    label: str


class SourceResponseField(SourceModel):
    """Native blank metadata only; answer objects never belong here."""

    field_id: str = Field(strict=True, min_length=1)
    prompt: str = Field(strict=True, min_length=1)
    word_limit: int | None = Field(default=None, strict=True, gt=0)

    @field_validator("field_id", "prompt")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Source field identity/label must not be blank")
        return value


class SourceImage(SourceModel):
    asset_id: str
    url: str
    expires_in: int = 7200
    width: int
    height: int
    alt_vi: str


class SourceBlock(SourceModel):
    block_id: str
    part_id: str
    kind: str
    instruction: SourceInstruction
    item_ids: list[str] = Field(default_factory=list)
    source_question_numbers: list[int] = Field(default_factory=list)
    images: list[SourceImage] = Field(default_factory=list)
    shared_options: list[SourceOption] = Field(default_factory=list)
    description: str = ""
    display_kind: Literal["practice", "source_study", "vocabulary"] = "practice"
    study_available: bool = False


class SourceRegion(SourceModel):
    x: float
    y: float
    width: float
    height: float


class SourceEvidence(SourceModel):
    source_kind: str
    pdf_page: int | None = None
    line_index_1_based: int | None = None
    quote: str
    relation: str = "supports"
    visual_reconstruction: str | bool | None = None
    source_image_path: str | None = None
    source_image_sha256: str | None = None
    source_region: SourceRegion | None = None
    text_validation_source: str | None = None
    upstream_review_state: str | None = None
    raw_ocr_verbatim: bool | None = None
    source_pdf_sha256: str | None = None
    source_line_id: str | None = None
    insertion_after_line_index_1_based: int | None = None
    line_index_unavailable_reason: str | None = None
    start: float | None = None
    end: float | None = None


class SourceDistractor(SourceModel):
    option: str
    text: str = ""
    reason_vi: str


class SourceKeyCitation(SourceModel):
    pdf_page: int = Field(ge=1)
    line_index_1_based: int = Field(ge=1)


class SourcePrintedKey(SourceModel):
    answer: str | list[str] | dict[str, str] | None = None
    source_pdf_page: int | None = None
    source_ocr_line_index_1_based: int | None = None
    evidence_tier: str | None = None
    visual_correction: bool = False
    source_lines: list[SourceKeyCitation] = Field(default_factory=list)


class SourceExplanation(SourceModel):
    printed_key: SourcePrintedKey | None = None
    answer: str | list[str] | dict[str, str] | None = None
    evidence: list[SourceEvidence] = Field(default_factory=list)
    why_vi: str
    distractors: list[SourceDistractor] = Field(default_factory=list)
    paraphrase_vi: str = ""
    trap_vi: str = ""
    format_vi: str = ""
    source_answer_warning_vi: str | None = None
    next_action_vi: str | None = None


class SourcePosition(SourceModel):
    item_id: str
    source_display_number: str
    part_id: str
    block_id: str
    review_status: ReviewVerdict
    reason_vi: str = ""


class SourceVocabularyTerm(SourceModel):
    term: str
    related_terms: list[str] = Field(default_factory=list)
    meaning_vi: str | None = None
    editorial: bool = False
    source_pdf_page: int | None = None
    source_line_index_1_based: int | None = None


class SourceVocabularyGroup(SourceModel):
    title: str
    source_heading: str | None = None
    editorial_heading_en: str | None = None
    editorial_note_vi: str | None = None
    source_layout_note_vi: str | None = None
    terms: list[SourceVocabularyTerm] = Field(default_factory=list)


class SourceDayCard(SourceModel):
    day: int
    lesson_id: str
    title: str
    group: GroupKind
    availability: SourceAvailability
    source_position_count: int
    practice_item_count: int
    source_only_count: int
    form_count: int
    completed_form_count: int = 0
    independent_completed_form_count: int = 0
    in_progress_form_count: int = 0
    href: str


class SourceGroup(SourceModel):
    id: GroupKind
    title: str
    days: list[SourceDayCard]


class ListeningSourceCollectionResponse(SourceModel):
    collection_id: Literal["80-days"] = "80-days"
    package_id: str
    manifest_sha256: str
    title: str
    groups: list[SourceGroup]
    partial_data: bool = False


class SourceForm(SourceModel):
    id: str
    source_form_id: str
    title: str
    item_count: int
    duration_seconds: float
    status: Literal["new", "in_progress", "completed"] = "new"
    assisted: bool = False
    attempt_id: str | None = None
    href: str


class SourcePart(SourceModel):
    part_id: str
    source_label: str
    item_count: int
    source_position_count: int
    audio_status: str
    timing_granularity: Literal["whole_day", "whole_part", "question", "none"] = "none"
    form: SourceForm | None = None


class ListeningSourceDayResponse(SourceModel):
    collection_id: Literal["80-days"] = "80-days"
    package_id: str
    manifest_sha256: str
    day: int
    lesson_id: str
    title: str
    group: GroupKind
    availability: SourceAvailability
    source_position_count: int
    practice_item_count: int
    source_only_count: int
    parts: list[SourcePart]
    blocks: list[SourceBlock]
    vocabulary_groups: list[SourceVocabularyGroup] = Field(default_factory=list)
    source_only_positions: list[SourcePosition] = Field(default_factory=list)
    partial_data: bool = False


class ListeningSourceStudyRequest(SourceModel):
    block_ids: list[str] = Field(min_length=1, max_length=100)


class SourceStudyItem(SourceModel):
    item_id: str
    source_display_number: str
    review_status: ReviewVerdict
    answer_provenance: str
    explanation: SourceExplanation


class SourceStudyBlock(SourceBlock):
    items: list[SourceStudyItem] = Field(default_factory=list)
    transcript: list[SourceEvidence] = Field(default_factory=list)


class ListeningSourceStudyResponse(SourceModel):
    mode: Literal["source_study"] = "source_study"
    independent_practice: Literal[False] = False
    day: int
    blocks: list[SourceStudyBlock]
