"""Public response contracts for the learner Speaking session spine.

The underlying Supabase rows pre-date Pydantic response models and still carry
operational columns used by admin tooling.  ``extra="allow"`` keeps those
columns backwards-compatible while the fields consumed by learner surfaces are
made explicit in OpenAPI.  This is intentionally a read contract, not a second
copy of the database schema.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class SessionWireModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class SessionRetention(SessionWireModel):
    days_until_audio_purge: int | None
    days_until_content_purge: int | None
    is_audio_purged: bool
    is_content_purged: bool
    is_hidden: bool


class SessionRow(SessionWireModel):
    id: str
    user_id: str | None = None
    mode: str
    part: int
    topic: str
    status: str
    started_at: str
    overall_band: float | None = None
    band_fc: float | None = None
    band_lr: float | None = None
    band_gra: float | None = None
    band_p: float | None = None
    sitting_id: str | None = None
    full_test_attempt_id: str | None = None
    class_assignment_item_id: str | None = None
    renderer_affinity: str | None = None
    last_accessed_at: str | None = None
    audio_purged_at: str | None = None
    content_purged_at: str | None = None
    retention: SessionRetention


class SessionPageResponse(BaseModel):
    sessions: list[SessionRow]
    total: int
    page: int
    page_size: int
    total_pages: int


SessionListResponse = list[SessionRow] | SessionPageResponse


class SessionStatsRow(SessionWireModel):
    id: str
    started_at: str
    mode: str
    part: int
    topic: str
    band_fc: float | None = None
    band_lr: float | None = None
    band_gra: float | None = None
    band_p: float | None = None
    overall_band: float | None = None
    status: str


class SessionStatsSummary(BaseModel):
    total_sessions: int
    avg_band_30d: float | None
    current_streak: int
    last_topic: str | None
    last_part: int | None
    last_mode: str | None
    last_session_at: str | None


class SessionStatsResponse(BaseModel):
    sessions: list[SessionStatsRow]
    summary: SessionStatsSummary


class SessionQuestion(SessionWireModel):
    id: str
    session_id: str | None = None
    part: int | None = None
    order_num: int | None = None
    question_text: str = ""
    subtopic: str | None = None
    cue_card_bullets: list[str] | None = None
    cue_card_reflection: str | None = None
    listen_only: bool | None = None
    audio_url: str | None = None


class SessionResponse(SessionWireModel):
    id: str
    session_id: str | None = None
    question_id: str
    transcript: str | None = None
    feedback: dict[str, Any] | str | None = None
    overall_band: float | None = None
    final_band_p: float | None = None
    final_overall_band: float | None = None
    grading_status: str | None = None
    stt_status: str | None = None
    persisted_at: str | None = None
    duration_seconds: float | None = None
    audio_url: str | None = None
    audio_playback_url: str | None = None
    audio_available: bool = False
    audio_lookup_failed: bool = False


class SessionResponseReceipt(BaseModel):
    id: str
    question_id: str
    persisted_at: str | None


class SessionClassTask(BaseModel):
    item_id: str
    title: str | None
    due_at: str | None
    submitted_at: str | None
    accepting: bool


class SessionDetailResponse(SessionRow):
    session_id: str
    questions: list[SessionQuestion]
    responses: list[SessionResponse]
    response_receipts: list[SessionResponseReceipt]
    question_lookup_failed: bool
    response_lookup_failed: bool
    results_sealed: bool
    class_task: SessionClassTask | None = None


class SessionAudioUrl(BaseModel):
    response_id: str
    question_id: str
    url: str
    expires_in: int
