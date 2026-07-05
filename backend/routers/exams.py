"""routers/exams.py — multi-source exam player (Phase 3, student-facing).

Auth: get_supabase_user (Bearer JWT). Answer key + solution are stripped from the
detail fetch and revealed only in the post-submit review — mirrors the reading
module's strip-keys posture.

  GET  /api/exams?source=toeic_rc          — list published exams (by source).
  GET  /api/exams/{test_id}                — exam questions (key + solution stripped).
  POST /api/exams/{test_id}/attempts       — submit answers → grade + KP evidence.
  GET  /api/exams/attempts/{attempt_id}/review — post-submit solution review.
"""
from __future__ import annotations

from fastapi import APIRouter, Header, Query
from pydantic import BaseModel, Field

from routers.auth import get_supabase_user
from services import exam_service

router = APIRouter(prefix="/api/exams", tags=["exams"])


class ExamAnswer(BaseModel):
    q_num: int
    user_answer: str | None = ""


class SubmitBody(BaseModel):
    answers: list[ExamAnswer] = Field(default_factory=list)


@router.get("")
async def list_exams(
    source: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    await get_supabase_user(authorization)
    return {"exams": exam_service.list_published(source)}


@router.get("/{test_id}")
async def get_exam(test_id: str, authorization: str | None = Header(default=None)):
    await get_supabase_user(authorization)
    return exam_service.get_for_play(test_id)


@router.post("/{test_id}/attempts")
async def submit_exam_attempt(
    test_id: str, body: SubmitBody, authorization: str | None = Header(default=None)
):
    user = await get_supabase_user(authorization)
    return exam_service.submit_attempt(
        user["id"], test_id, [a.model_dump() for a in body.answers])


@router.get("/attempts/{attempt_id}/review")
async def review_exam_attempt(
    attempt_id: str, authorization: str | None = Header(default=None)
):
    user = await get_supabase_user(authorization)
    return exam_service.get_review(user["id"], attempt_id)
