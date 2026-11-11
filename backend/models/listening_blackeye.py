"""Strict Black Eye U1 wire contract. No answer-set identity on learner DTOs."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PROGRAMME = "blackeye-v5-upper-listening"
COLLECTION = "blackeye-v5-upper"
CONTRACT = "blackeye_u1_v1"
Revision = Annotated[str, Field(min_length=1)]


class BlackEyeModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class BlackEyeLearnerBinding(BlackEyeModel):
    programme_id: Literal["blackeye-v5-upper-listening"]
    collection_id: Literal["blackeye-v5-upper"]
    source_contract: Literal["blackeye_u1_v1"]
    unit_id: Literal["U1"]
    activity_id: Annotated[str, Field(pattern=r"^U1-A(0[1-9]|1[0-9]|20)$")]
    content_revision: Revision
    policy_revision: Revision

    @field_validator("content_revision", "policy_revision")
    @classmethod
    def immutable_revision(cls, value):
        if value == "latest" or not value.strip():
            raise ValueError("immutable revision required")
        return value


class BlackEyeRevisionBinding(BlackEyeLearnerBinding):
    answer_set_revision: Revision

    @field_validator("answer_set_revision")
    @classmethod
    def opaque_answer_identity(cls, value):
        from uuid import UUID
        UUID(value)
        return value


class BlackEyePublicItem(BlackEyeModel):
    source_item_id: Annotated[str, Field(min_length=1)]
    q_num: Annotated[int, Field(ge=1, le=48)]
    source_display_number: str
    interaction: Literal["text", "keep_change"]
    prompt: str
    instruction: str
    givens: list[str]
    group_id: str | None
    row_id: str | None
    column_id: str | None


class BlackEyeDictation(BlackEyeModel):
    available: Literal[False]
    reason: Literal["separate_release_required"]


class BlackEyeActivityPublic(BlackEyeModel):
    binding: BlackEyeLearnerBinding
    test_id: str | None
    title: str
    order: int
    readiness: Literal["locked", "candidate", "ready"]
    readiness_reasons: list[str]
    selectable: bool
    response_cell_count: Annotated[int, Field(ge=1, le=48)]
    scoring_policy: Literal["report_only"]
    objective_denominator: Literal[0]
    dictation: BlackEyeDictation
    items: list[BlackEyePublicItem]
    media_handle: str | None

    @model_validator(mode="after")
    def cells(self):
        n = self.response_cell_count
        if (len(self.items) != n or [i.q_num for i in self.items] != list(range(1, n + 1))
                or len({i.source_item_id for i in self.items}) != n
                or (self.binding.activity_id == "U1-A13" and n != 48)):
            raise ValueError("invalid Black Eye cell map")
        if self.selectable != (self.readiness == "ready"):
            raise ValueError("readiness mismatch")
        if self.binding.activity_id in {"U1-A03", "U1-A04"} and any(i.interaction != "keep_change" for i in self.items):
            raise ValueError("composite interaction required")
        locked = {"U1-A08": "audio_incomplete_download", "U1-A14": "audio_not_found",
                  "U1-A19": "original_options_unreviewed"}
        if self.binding.activity_id in locked:
            if self.readiness != "locked" or locked[self.binding.activity_id] not in self.readiness_reasons:
                raise ValueError("locked activity")
        return self


class BlackEyeUnitPublic(BlackEyeModel):
    collection_id: Literal["blackeye-v5-upper"]
    unit_id: Literal["U1"]
    activities: list[BlackEyeActivityPublic]


class BlackEyeContext(BlackEyeModel):
    kind: Literal["standalone", "assigned"]
    class_assignment_item_id: str | None
    assignment_id: str | None
    cohort_id: str | None

    @model_validator(mode="after")
    def scoped(self):
        ids = (self.class_assignment_item_id, self.assignment_id, self.cohort_id)
        if (self.kind == "standalone" and any(v is not None for v in ids)
                or self.kind == "assigned" and not all(ids)):
            raise ValueError("invalid context")
        return self


class BlackEyeAnswer(BlackEyeModel):
    q_num: int
    source_item_id: str
    user_answer: str


class BlackEyeResultSummary(BlackEyeModel):
    submitted: Literal[True]
    item_count: int
    blank_count: int
    unscored_count: int
    objective_denominator: Literal[0]
    score: None
    band_estimate: None


class BlackEyeAttemptState(BlackEyeModel):
    attempt_id: str
    test_id: str
    binding: BlackEyeLearnerBinding
    context: BlackEyeContext
    status: Literal["in_progress", "submitted"]
    answers: list[BlackEyeAnswer]
    submitted_at: str | None
    result_summary: BlackEyeResultSummary | None


class BlackEyeInProgress(BlackEyeModel):
    attempt: BlackEyeAttemptState | None


class BlackEyeKeepChange(BlackEyeModel):
    version: Literal["blackeye_keep_change_v1"]
    action: Literal["KEEP", "CHANGE"] | None
    correction_text: str


class BlackEyeKeepChangeReference(BlackEyeModel):
    version: Literal["blackeye_keep_change_v1"]
    action: Literal["KEEP", "CHANGE"]
    correction_text: str


class BlackEyeReviewItem(BlackEyeModel):
    source_item_id: str
    q_num: int
    saved_response: str
    blank: bool
    source_status: Literal["UNRESOLVED", "CONFIRMED", "DISAGREEMENT"]
    scoring_mode: Literal["SELF-CHECK"]
    academic_verdict: Literal["CONFIRMED", "SUSPECT", "AMBIGUOUS", "UNRESOLVED"]
    reference: None | str | list[str] | BlackEyeKeepChangeReference
    reference_provenance: Literal["literal_key", "derived", "editorial"]
    explanation_vi: str | None
    limitation_vi: str | None
    evidence_pointer: str | None

    @model_validator(mode="after")
    def source_limit(self):
        if self.source_status in {"UNRESOLVED", "DISAGREEMENT"} and not self.limitation_vi:
            raise ValueError("source limitation required")
        return self


class BlackEyeTranscript(BlackEyeModel):
    text: str
    start: float | None
    end: float | None


class BlackEyeReviewAudio(BlackEyeModel):
    url: str | None
    granularity: Literal["whole_activity"]
    expires_in: int | None


class BlackEyeActivityReview(BlackEyeModel):
    attempt: BlackEyeAttemptState
    items: list[BlackEyeReviewItem]
    transcript: list[BlackEyeTranscript]
    audio: BlackEyeReviewAudio


class BlackEyeSaveAck(BlackEyeModel):
    attempt_id: str
    answer_count: int
    performance_event_recorded: bool


class BlackEyePlayer(BlackEyeModel):
    activity: BlackEyeActivityPublic
    attempt: BlackEyeAttemptState | None
    replay_policy: Literal['allowed']
    audio: BlackEyeReviewAudio


class BlackEyePlaybackAck(BlackEyeModel):
    attempt_id: str
    accepted: Literal[True]
    replay_policy: Literal['allowed']
    playback_started_at: str


class BlackEyeActivityAdmin(BlackEyeActivityPublic):
    binding: BlackEyeRevisionBinding


class BlackEyeUnitAdmin(BlackEyeModel):
    collection_id: Literal['blackeye-v5-upper']
    unit_id: Literal['U1']
    activities: list[BlackEyeActivityAdmin]


class BlackEyeSourceCatalog(BlackEyeModel):
    inventory: BlackEyeUnitAdmin
    eligible_recipient_ids: list[str]
    lookup_errors: list[str]


class BlackEyeAssignmentCreate(BlackEyeModel):
    request_id: Annotated[str, Field(pattern=r'^[0-9a-fA-F-]{36}$')]
    activities: Annotated[list[BlackEyeRevisionBinding], Field(min_length=1, max_length=17)]
    recipient_ids: Annotated[list[str], Field(min_length=1, max_length=500)]
    due_at: str
    deadline_timezone: Literal['Asia/Ho_Chi_Minh']
    replay_policy: Literal['allowed'] = 'allowed'

    @model_validator(mode='after')
    def frozen_selection(self):
        from datetime import datetime
        from uuid import UUID
        UUID(self.request_id)
        if len(set(self.recipient_ids)) != len(self.recipient_ids):
            raise ValueError('duplicate recipient')
        if len({a.activity_id for a in self.activities}) != len(self.activities):
            raise ValueError('duplicate activity')
        if any(a.activity_id in {'U1-A08', 'U1-A14', 'U1-A19'} for a in self.activities):
            raise ValueError('activity locked')
        deadline = datetime.fromisoformat(self.due_at.replace('Z', '+00:00'))
        if deadline.tzinfo is None:
            raise ValueError('deadline offset required')
        return self


class BlackEyeAssignmentReceipt(BlackEyeModel):
    assignment_id: str
    request_id: str
    cohort_id: str
    activities: list[BlackEyeRevisionBinding]
    recipient_ids: list[str]
    due_at: str
    deadline_timezone: Literal['Asia/Ho_Chi_Minh']
    replay_policy: Literal['allowed']
    completion_denominator: int


class BlackEyeProgressCell(BlackEyeModel):
    student_id: str
    activity_id: str
    item_id: str
    attempt_id: str | None
    status: Literal['not_started', 'in_progress', 'submitted', 'expired', 'unavailable']
    submitted_at: str | None
    blank_count: int | None


class BlackEyeAssignmentProgress(BlackEyeModel):
    assignment_id: str
    cohort_id: str
    cells: list[BlackEyeProgressCell]
    dictation: BlackEyeDictation
