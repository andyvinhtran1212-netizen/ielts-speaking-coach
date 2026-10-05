"""Assignment-scoped MASTER30 teaching and practice API."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from models.grammar_content import GrammarArticleRef as Article

from routers.auth import get_supabase_user
from services import grammar_lesson_service as service
from services.runtime_flags import require_flag


router = APIRouter(
    prefix="/api/grammar/lessons", tags=["grammar-lesson"],
)


class Question(BaseModel):
    id: str
    prompt: str
    options: list[str]
    selected_index: int | None = None
    is_correct: bool | None = None
    correct_index: int | None = None
    explanation: str | None = None


class LessonState(BaseModel):
    assignment_item_id: str
    assignment_id: str
    lesson_id: str
    title: str
    instructions: str | None = None
    due_at: str | None = None
    status: Literal["not_started", "scheduled", "expired", "paused", "in_progress", "completed"]
    can_submit: bool
    answered_count: int
    correct_count: int
    question_count: int
    attempt_id: str | None = None
    focus: str
    article: Article | None = None
    lesson_notes: str | None = None
    learning_objectives: list[str] = Field(default_factory=list)
    questions: list[Question]


class AnswerBody(BaseModel):
    question_id: str = Field(min_length=1, max_length=160)
    selected_index: int = Field(ge=0, le=20)


@router.get("/items/{item_id}", response_model=LessonState)
async def read_item(item_id: str, authorization: str | None = Header(default=None)):
    user = await get_supabase_user(authorization)
    return service.read_item(user["id"], item_id)


@router.post("/items/{item_id}/start", response_model=LessonState,
             dependencies=[Depends(require_flag(service.FLAG, default=False))])
async def start_item(item_id: str, authorization: str | None = Header(default=None)):
    user = await get_supabase_user(authorization)
    return service.start_item(user["id"], item_id)


@router.post("/items/{item_id}/answers", response_model=LessonState,
             dependencies=[Depends(require_flag(service.FLAG, default=False))])
async def answer_item(item_id: str, body: AnswerBody,
                      authorization: str | None = Header(default=None)):
    user = await get_supabase_user(authorization)
    return service.answer_item(user["id"], item_id,
                               body.question_id, body.selected_index)
