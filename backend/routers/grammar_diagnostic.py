"""Authenticated MASTER30 Grammar Diagnostic API."""

from __future__ import annotations

from typing import Literal, Optional

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


@router.get("/availability")
async def availability(authorization: str | None = Header(default=None)):
    await get_supabase_user(authorization)
    return {
        "assigned_only": not runtime_flags.is_enabled(
            "master30_grammar_self_serve", default=False,
        ),
    }


@router.post("/sessions")
async def create_session(body: SessionCreate, authorization: str | None = Header(default=None)):
    user = await get_supabase_user(authorization)
    return service.create_session(user["id"], **body.model_dump())


@router.get("/sessions")
async def list_sessions(authorization: str | None = Header(default=None)):
    user = await get_supabase_user(authorization)
    return {"sessions": service.learner_history(user["id"])}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, authorization: str | None = Header(default=None)):
    user = await get_supabase_user(authorization)
    return service.session_summary(user["id"], session_id)


@router.post("/sessions/{session_id}/next")
async def next_item(session_id: str, authorization: str | None = Header(default=None)):
    user = await get_supabase_user(authorization)
    return service.next_item(user["id"], session_id)


@router.post("/sessions/{session_id}/responses")
async def submit_response(
    session_id: str,
    body: ResponseCreate,
    authorization: str | None = Header(default=None),
):
    user = await get_supabase_user(authorization)
    return service.record_response(user["id"], session_id, **body.model_dump())


@router.post("/sessions/{session_id}/complete")
async def complete_session(session_id: str, authorization: str | None = Header(default=None)):
    user = await get_supabase_user(authorization)
    return service.finalize_session(user["id"], session_id)


@router.get("/sessions/{session_id}/report")
async def get_report(session_id: str, authorization: str | None = Header(default=None)):
    user = await get_supabase_user(authorization)
    return service.learner_report(user["id"], session_id)
