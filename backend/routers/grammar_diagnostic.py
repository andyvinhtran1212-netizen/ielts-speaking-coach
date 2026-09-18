"""Authenticated MASTER30 Grammar Diagnostic API."""

from __future__ import annotations

from typing import Dict, Literal, Optional

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field

from routers.auth import get_supabase_user
from services import grammar_diagnostic_service as service
from services import runtime_flags
from services.runtime_flags import require_flag


router = APIRouter(
    prefix="/api/grammar/diagnostics",
    tags=["grammar-diagnostic"],
    dependencies=[Depends(require_flag("master30_grammar_diagnostic", default=False))],
)


class SessionCreate(BaseModel):
    mode: Literal["ENTRY", "REVIEW"] = "ENTRY"
    module: Literal["GENERAL", "ACADEMIC"] = "GENERAL"
    test_length: Literal["QUICK", "FULL"] = "QUICK"
    class_assignment_item_id: Optional[str] = None


class ResponseCreate(BaseModel):
    item_id: str = Field(min_length=1, max_length=160)
    selected_option: int = Field(ge=0, le=20)
    response_time_ms: Optional[int] = Field(default=None, ge=0, le=3_600_000)
    assistance_used: bool = False


class AvailabilityResponse(BaseModel):
    assigned_only: bool


class SessionResponse(BaseModel):
    id: str
    status: str
    phase: str
    mode: Literal["ENTRY", "REVIEW"]
    module: Literal["GENERAL", "ACADEMIC"]
    test_length: Literal["QUICK", "FULL"]
    objective_limit: int
    answered: int
    remaining: int
    class_assignment_item_id: Optional[str] = None
    calibration: str
    live_calibrated_ready: bool


class SessionListResponse(BaseModel):
    sessions: list[SessionResponse]


class ItemResponse(BaseModel):
    item_id: str
    prompt: str
    options: list[str]
    phase: str
    ordinal: int
    total: int
    translation_available: bool


class NextItemResponse(BaseModel):
    complete: bool
    item: Optional[ItemResponse] = None
    session: Optional[SessionResponse] = None


class ResponseAccepted(BaseModel):
    accepted: bool
    complete: bool
    answered: int
    remaining: int
    feedback_available: bool


class EvidenceStatus(BaseModel):
    independent_items: int
    assisted_excluded: int


class PriorityResponse(BaseModel):
    attribute_id: str
    title: str
    state: str
    confidence_label: str
    observed_pattern: str
    risk: str
    next_action: str
    contrast_example: str
    route_id: Optional[str] = None
    lesson_sources: str
    exit_condition: str
    evidence_status: EvidenceStatus


class StrengthResponse(BaseModel):
    attribute_id: str
    title: str
    state: str
    independent_items: int


class InsufficientEvidenceResponse(BaseModel):
    attribute_id: str
    title: str


class LearnerReportSnapshotResponse(BaseModel):
    profile_kind: str
    calibration: str
    calibration_note: str
    test_length: Literal["QUICK", "FULL"]
    mode: Literal["ENTRY", "REVIEW"]
    module: Literal["GENERAL", "ACADEMIC"]
    priorities: list[PriorityResponse]
    strengths: list[StrengthResponse]
    insufficient_evidence: list[InsufficientEvidenceResponse]
    productive_note: str


class LearnerReportResponse(LearnerReportSnapshotResponse):
    session_id: str
    created_at: Optional[str] = None
    assigned: bool = False


class AttributeEvidenceResponse(BaseModel):
    state: str
    independent_items: int
    correct: int
    incorrect: int
    process_facets: list[str]
    dominant_process_facets: list[str]
    assisted_evidence_excluded: int
    item_ids: list[str]


class EducatorReportResponse(LearnerReportResponse):
    attribute_evidence: Dict[str, AttributeEvidenceResponse]
    objective_items: int
    correct_items: int
    release_id: str


@router.get("/availability", response_model=AvailabilityResponse)
async def availability(authorization: str | None = Header(default=None)) -> AvailabilityResponse:
    await get_supabase_user(authorization)
    return AvailabilityResponse(
        assigned_only=not runtime_flags.is_enabled(
            "master30_grammar_self_serve", default=False,
        ),
    )


@router.post("/sessions", response_model=SessionResponse)
async def create_session(body: SessionCreate, authorization: str | None = Header(default=None)) -> SessionResponse:
    user = await get_supabase_user(authorization)
    return service.create_session(user["id"], **body.model_dump())


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions(authorization: str | None = Header(default=None)) -> SessionListResponse:
    user = await get_supabase_user(authorization)
    return {"sessions": service.learner_history(user["id"])}


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str, authorization: str | None = Header(default=None)) -> SessionResponse:
    user = await get_supabase_user(authorization)
    return service.session_summary(user["id"], session_id)


@router.post("/sessions/{session_id}/next", response_model=NextItemResponse)
async def next_item(session_id: str, authorization: str | None = Header(default=None)) -> NextItemResponse:
    user = await get_supabase_user(authorization)
    return service.next_item(user["id"], session_id)


@router.post("/sessions/{session_id}/responses", response_model=ResponseAccepted)
async def submit_response(
    session_id: str,
    body: ResponseCreate,
    authorization: str | None = Header(default=None),
) -> ResponseAccepted:
    user = await get_supabase_user(authorization)
    return service.record_response(user["id"], session_id, **body.model_dump())


@router.post("/sessions/{session_id}/complete", response_model=LearnerReportSnapshotResponse)
async def complete_session(
    session_id: str,
    authorization: str | None = Header(default=None),
) -> LearnerReportSnapshotResponse:
    user = await get_supabase_user(authorization)
    return service.finalize_session(user["id"], session_id)


@router.get("/sessions/{session_id}/report", response_model=LearnerReportResponse)
async def get_report(
    session_id: str,
    authorization: str | None = Header(default=None),
) -> LearnerReportResponse:
    user = await get_supabase_user(authorization)
    return service.learner_report(user["id"], session_id)
