"""Learner and admin routes for assignment-led Advanced Vocabulary lessons."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from routers.admin import require_admin
from routers.auth import get_supabase_user
from services import advanced_vocab_service

router = APIRouter(prefix="/api/advanced-vocab", tags=["advanced-vocabulary"])
admin_router = APIRouter(prefix="/admin/advanced-vocab", tags=["admin-advanced-vocabulary"])


class VocabularyCompleteBody(BaseModel):
    bank_id: str
    item_id: str
    seen_lexeme_ids: list[str] = Field(default_factory=list, max_length=100)


class PracticeStartBody(BaseModel):
    bank_id: str
    item_id: str
    stage: str


class PracticeAnswerBody(PracticeStartBody):
    qid: str
    answer: Any
    response_time_ms: int | None = Field(default=None, ge=0, le=12 * 60 * 60 * 1000)


class SectionSubmitBody(BaseModel):
    bank_id: str
    item_id: str
    answers: dict[str, str] = Field(default_factory=dict, max_length=100)
    duration_sec: int = Field(default=0, ge=0, le=12 * 60 * 60)


class ControlledRewriteCompleteBody(BaseModel):
    bank_id: str
    item_id: str
    attempted_item_ids: list[str] = Field(default_factory=list, max_length=30)


@router.get("/lessons/{bank_id}")
async def lesson(bank_id: UUID, item: UUID, authorization: str | None = Header(None)):
    user = await get_supabase_user(authorization)
    return advanced_vocab_service.learner_lesson(
        user_id=user["id"], bank_id=str(bank_id), item_id=str(item),
    )


@router.post("/vocabulary/complete")
async def complete_vocabulary(
    body: VocabularyCompleteBody, authorization: str | None = Header(None),
):
    user = await get_supabase_user(authorization)
    return advanced_vocab_service.complete_vocabulary(
        user_id=user["id"], bank_id=body.bank_id, item_id=body.item_id,
        seen_lexeme_ids=body.seen_lexeme_ids,
    )


@router.post("/practice/start")
async def start_practice(body: PracticeStartBody, authorization: str | None = Header(None)):
    user = await get_supabase_user(authorization)
    return advanced_vocab_service.start_practice(
        user_id=user["id"], bank_id=body.bank_id,
        item_id=body.item_id, stage=body.stage,
    )


@router.post("/practice/answer")
async def answer_practice(body: PracticeAnswerBody, authorization: str | None = Header(None)):
    user = await get_supabase_user(authorization)
    return advanced_vocab_service.answer_practice(
        user_id=user["id"], bank_id=body.bank_id, item_id=body.item_id,
        stage=body.stage, qid=body.qid, answer=body.answer,
        response_time_ms=body.response_time_ms,
    )


@router.post("/reading")
async def submit_reading(body: SectionSubmitBody, authorization: str | None = Header(None)):
    user = await get_supabase_user(authorization)
    return advanced_vocab_service.submit_reading(
        user_id=user["id"], bank_id=body.bank_id, item_id=body.item_id,
        answers=body.answers, duration_sec=body.duration_sec,
    )


@router.post("/controlled-rewrite/complete")
async def complete_controlled_rewrite(
    body: ControlledRewriteCompleteBody,
    authorization: str | None = Header(None),
):
    user = await get_supabase_user(authorization)
    return advanced_vocab_service.complete_controlled_rewrite(
        user_id=user["id"], bank_id=body.bank_id, item_id=body.item_id,
        attempted_item_ids=body.attempted_item_ids,
    )


@router.post("/listening")
async def submit_listening(body: SectionSubmitBody, authorization: str | None = Header(None)):
    user = await get_supabase_user(authorization)
    return advanced_vocab_service.submit_listening(
        user_id=user["id"], bank_id=body.bank_id, item_id=body.item_id,
        answers=body.answers, duration_sec=body.duration_sec,
    )


@admin_router.get("/assignments/{assignment_id}/results")
async def assignment_results(
    assignment_id: UUID, authorization: str | None = Header(None),
):
    await require_admin(authorization)
    return advanced_vocab_service.assignment_results(assignment_id=str(assignment_id))
