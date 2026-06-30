"""routers/quiz.py — Quick-Check player (student-facing, Pha 2).

Auth: get_supabase_user (Bearer JWT). The bank is served WITH answers so the
client grades instantly (QĐ-5); the Adaptive Mastery loop runs in the browser
and posts progress back here.

  GET   /api/quiz/banks?skill_area=&topic_id=   — list published banks.
  GET   /api/quiz/banks/{bank_id}               — bank META + questions (+answers).
  GET   /api/quiz/banks/{bank_id}/resume        — carry-over word_stats.
  POST  /api/quiz/sessions                       — start a session (+resume).
  POST  /api/quiz/sessions/{id}/progress         — batch log attempts + word_stats.
  PATCH /api/quiz/sessions/{id}                  — end a session (totals).
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Header, Query
from pydantic import BaseModel

from routers.auth import get_supabase_user
from services import quiz_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/quiz", tags=["quiz-player"])


class StartSessionBody(BaseModel):
    bank_id: str


class ProgressBody(BaseModel):
    attempts: list[dict] = []
    word_stats: list[dict] = []


class EndSessionBody(BaseModel):
    duration_sec: int | None = None
    total_questions: int = 0
    total_correct: int = 0
    total_wrong: int = 0
    words_mastered: int = 0
    words_carried_over: int = 0
    ended_by: str | None = None


@router.get("/banks")
async def list_banks(
    skill_area: str | None = Query(default=None),
    topic_id: str | None = Query(default=None),
    authorization: str | None = Header(None),
):
    await get_supabase_user(authorization)
    return quiz_service.list_published_banks(skill_area=skill_area, topic_id=topic_id)


@router.get("/progress")
async def my_progress(authorization: str | None = Header(None)):
    """The caller's own quiz progress — per-bank mastery + recent sessions."""
    user = await get_supabase_user(authorization)
    return quiz_service.student_progress(user_id=user["id"])


@router.get("/banks/{bank_id}")
async def get_bank(bank_id: UUID, authorization: str | None = Header(None)):
    await get_supabase_user(authorization)
    return quiz_service.get_bank_for_play(str(bank_id))


@router.get("/banks/{bank_id}/resume")
async def resume(bank_id: UUID, authorization: str | None = Header(None)):
    user = await get_supabase_user(authorization)
    return quiz_service.get_resume(user_id=user["id"], bank_id=str(bank_id))


@router.post("/sessions", status_code=201)
async def start_session(body: StartSessionBody, authorization: str | None = Header(None)):
    user = await get_supabase_user(authorization)
    return quiz_service.start_session(user_id=user["id"], bank_id=body.bank_id)


@router.post("/sessions/{session_id}/progress")
async def log_progress(
    session_id: UUID, body: ProgressBody, authorization: str | None = Header(None)
):
    user = await get_supabase_user(authorization)
    return quiz_service.log_progress(
        user_id=user["id"], session_id=str(session_id),
        attempts=body.attempts, word_stats=body.word_stats,
    )


@router.patch("/sessions/{session_id}")
async def end_session(
    session_id: UUID, body: EndSessionBody, authorization: str | None = Header(None)
):
    user = await get_supabase_user(authorization)
    return quiz_service.end_session(
        user_id=user["id"], session_id=str(session_id), data=body.model_dump(),
    )
