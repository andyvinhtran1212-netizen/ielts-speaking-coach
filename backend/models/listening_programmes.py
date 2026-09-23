"""Public API contracts for LISTENING-0005 programme content."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ListeningProgrammeCard(BaseModel):
    id: str
    title: str
    description: str
    lesson_count: int = 0
    form_count: int = 0
    completed_form_count: int = 0
    independent_completed_form_count: int = 0
    in_progress_form_count: int = 0


class ListeningResumeCard(BaseModel):
    attempt_id: str
    test_id: str
    title: str
    programme_id: str
    lesson_id: str
    answered_count: int = 0
    item_count: int = 0
    assisted: bool = False
    resume_expires_at: str | None = None
    href: str


class ListeningRecentActivity(BaseModel):
    attempt_id: str
    test_id: str
    title: str
    programme_id: str
    status: str
    submitted_at: str | None = None
    checked_count: int = 0
    correct_count: int = 0
    unscored_count: int = 0
    assisted: bool = False
    href: str


class ListeningOverviewResponse(BaseModel):
    tests: dict[str, int] = Field(default_factory=dict)
    practice_groups: dict[str, int] = Field(default_factory=dict)
    content: int = 0
    exercise_modes: dict[str, int] = Field(default_factory=dict)
    programmes: list[ListeningProgrammeCard] = Field(default_factory=list)
    resume: ListeningResumeCard | None = None
    recent: list[ListeningRecentActivity] = Field(default_factory=list)
    partial_data: bool = False


class ListeningLessonCard(BaseModel):
    id: str
    source_lesson_id: str
    title: str
    instructions: str | None = None
    outcomes: list[Any] = Field(default_factory=list)
    sequence_num: int
    form_count: int = 0
    completed_form_count: int = 0
    independent_completed_form_count: int = 0
    in_progress_form_count: int = 0


class ListeningLessonListResponse(BaseModel):
    programme_id: str
    items: list[ListeningLessonCard]
    total: int
    limit: int
    offset: int
    partial_data: bool = False


class ListeningFormCard(BaseModel):
    id: str
    test_id: str
    source_form_id: str
    title: str
    purpose: str
    replay_policy: str
    support_policy: str
    scoring_policy: str
    item_count: int
    duration_seconds: int = 0
    checked_item_count: int = 0
    self_review_item_count: int = 0
    status: str = "new"
    assisted: bool = False
    attempt_id: str | None = None


class ListeningLessonDetailResponse(BaseModel):
    id: str
    programme_id: str
    source_lesson_id: str
    title: str
    instructions: str | None = None
    outcomes: list[Any] = Field(default_factory=list)
    forms: list[ListeningFormCard] = Field(default_factory=list)
    partial_data: bool = False


class ListeningPlayerResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    test_id: str | None = None
    title: str | None = None
    test_type: str | None = None
    programme_id: str = "ielts"
    listening_lesson_id: str | None = None
    source_form_id: str | None = None
    form_purpose: str | None = None
    scoring_policy: str = "diagnostic"
    replay_policy: str | None = None
    support_policy: str | None = None
    claim_policy: str | None = None
    source_item_count: int | None = None
    audio_url: str | None = None
    audio_storage_path: str | None = None
    audio_duration_seconds: int | float | None = None
    cue_points: list[Any] = Field(default_factory=list)
    sections: list[dict[str, Any]] = Field(default_factory=list)


class ListeningTestListItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    test_id: str | None = None
    title: str | None = None
    band_target: float | None = None
    themes: dict[str, Any] = Field(default_factory=dict)
    accent_profile: list[str] = Field(default_factory=list)
    audio_assembly_mode: str | None = None
    drill_type: str | None = None
    practice_group: str | None = None
    trap: str | None = None
    level: str | None = None
    task: str | None = None
    programme_id: str = "ielts"
    listening_lesson_id: str | None = None
    source_form_id: str | None = None
    form_purpose: str | None = None
    scoring_policy: str = "diagnostic"
    replay_policy: str | None = None
    support_policy: str | None = None
    claim_policy: str | None = None
    source_item_count: int | None = None
    user_best_score: int | None = None
    user_attempt_count: int = 0
    user_submitted_attempt_count: int = 0


class ListeningTestListResponse(BaseModel):
    items: list[ListeningTestListItem] = Field(default_factory=list)
    total: int
    limit: int
    offset: int


class ListeningReportOnlyResult(BaseModel):
    attempt_id: str
    scoring_policy: str
    status: str
    checked_count: int = 0
    correct_count: int = 0
    unscored_count: int = 0
    blank_count: int = 0
    technical_error_count: int = 0
    completion_count: int = 0
    item_count: int = 0
    per_question: list[dict[str, Any]] = Field(default_factory=list)
    review: dict[str, Any] = Field(default_factory=dict)


class ListeningGuidedFeedbackItem(BaseModel):
    q_num: int
    first_answer: str
    revealed_at: str
    state: str
    correct: bool | None = None
    expected: list[str] = Field(default_factory=list)
    rationale: str = ""
    reference_answers: list[str] = Field(default_factory=list)
    required_facts: list[str] = Field(default_factory=list)
    optional_facts: list[str] = Field(default_factory=list)
    self_review_rationale: str = ""
    scoring_rule: str = ""
    core_info: str = ""
    answer_sentence: str = ""
    word_limit: str = ""
    audio_window: dict[str, float] | None = None


class ListeningGuidedStateResponse(BaseModel):
    attempt_id: str
    assisted: bool
    items: list[ListeningGuidedFeedbackItem] = Field(default_factory=list)


class ListeningReviewItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    q_num: int
    state: str | None = None
    correct: bool | None = None
    user_answer: str = ""
    expected: Any = ""
    question_type: str | None = None
    prompt: str | None = None
    audio_window: dict[str, Any] | None = None
    section: int | None = None
    transcript_anchor: int | None = None
    solution: dict[str, Any] = Field(default_factory=dict)
    self_review: dict[str, Any] = Field(default_factory=dict)
    first_answer: str | None = None


class ListeningAttemptReviewResponse(BaseModel):
    """Shared diagnostic/report-only review contract.

    Known fields are explicit for generated clients. ``extra='allow'`` keeps the
    existing diagnostic compatibility window open while programme-only fields
    become canonical.
    """

    model_config = ConfigDict(extra="allow")

    attempt_id: str | None = None
    test_id: str | None = None
    title: str | None = None
    status: str | None = None
    score: int | None = None
    max_score: int = 0
    band_estimate: float | None = None
    scoring_policy: str = "diagnostic"
    assisted: bool = False
    result_summary: dict[str, Any] = Field(default_factory=dict)
    programme_id: str = "ielts"
    listening_lesson_id: str | None = None
    form_purpose: str | None = None
    replay_policy: str | None = None
    support_policy: str | None = None
    claim_policy: str | None = None
    trap_analytics: dict[str, Any] = Field(default_factory=dict)
    audio_url: str | None = None
    audio_duration: int | float | None = None
    section_offsets: dict[str, Any] = Field(default_factory=dict)
    cue_points: list[Any] = Field(default_factory=list)
    band_conversion: list[Any] = Field(default_factory=list)
    sections: list[dict[str, Any]] = Field(default_factory=list)
    review: list[ListeningReviewItem] = Field(default_factory=list)
    controlled_transcripts: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    web_explanation_access: dict[str, Any] = Field(default_factory=dict)


class ListeningPackageStatusRequest(BaseModel):
    manifest_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class ListeningPackageStatusResponse(BaseModel):
    package_uuid: str
    status: str
    forms_changed: int
