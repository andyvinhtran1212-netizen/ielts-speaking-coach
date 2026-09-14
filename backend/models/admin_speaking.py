"""Admin Speaking session and repair response contracts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from models.session_contracts import SessionQuestion, SessionResponse


class AdminSpeakingWireModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class AdminSpeakingSessionRow(AdminSpeakingWireModel):
    id: str
    user_id: str | None = None
    user_email: str = ""
    user_lookup_failed: bool = False
    mode: str | None = None
    part: int | None = None
    topic: str | None = None
    status: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    overall_band: float | None = None
    band_fc: float | None = None
    band_lr: float | None = None
    band_gra: float | None = None
    band_p: float | None = None
    error_code: str | None = None
    error_message: str | None = None
    failed_step: str | None = None
    last_error_at: str | None = None
    pdf_status: str | None = None


class AdminSpeakingSessionDetail(AdminSpeakingSessionRow):
    session_id: str
    user_display_name: str | None = None
    p1_session_id: str | None
    p2_session_id: str | None
    p3_session_id: str | None
    full_test_siblings_lookup_failed: bool
    questions_lookup_failed: bool
    responses_lookup_failed: bool
    questions: list[SessionQuestion]
    responses: list[SessionResponse]


class AdminResponseRegradeResponse(BaseModel):
    ok: Literal[True]
    response_id: str
    session_id: str
    overall_band: float | None
    re_transcribed: bool
    session_updated: bool
    remaining_failed: int
    session_band: float | None


class AdminSessionRegradeResponse(BaseModel):
    ok: bool
    partial_failure: bool
    session_id: str
    regraded: int
    skipped: int
    failed: int
    failed_details: list[str]
    overall_band: float | None
    band_fc: float | None
    band_lr: float | None
    band_gra: float | None
    band_p: float | None


class AdminSummaryRebuildItem(BaseModel):
    session_id: str
    ok: bool
    error: str | None = None
    overall_band: float | None = None
    band_fc: float | None = None
    band_lr: float | None = None
    band_gra: float | None = None
    band_p: float | None = None


class AdminSummaryRebuildResponse(BaseModel):
    ok: Literal[True]
    sessions: list[AdminSummaryRebuildItem]
