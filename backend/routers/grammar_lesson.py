"""Assignment-scoped MASTER30 teaching and practice API."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field, model_validator
from models.grammar_content import GrammarArticleRef as Article

from routers.auth import get_supabase_user
from services import grammar_lesson_service as service
from services.runtime_flags import require_flag


router = APIRouter(
    prefix="/api/grammar/lessons", tags=["grammar-lesson"],
)


class WritingFeedback(BaseModel):
    model_answer: str
    accepted_variants: list[str]
    rubric: str
    detailed_rubric: str
    writing_skill: str


class Question(BaseModel):
    id: str
    prompt: str
    options: list[str]
    selected_index: int | None = None
    is_correct: bool | None = None
    correct_index: int | None = None
    explanation: str | None = None
    type: Literal["mcq", "writing"] = "mcq"
    format_code: str | None = None
    supplementary: bool = False
    output_requirements: str | None = None
    answer_text: str | None = None
    writing_feedback: WritingFeedback | None = None
    distractor_explanations: list[str] | None = None


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
    content_version: str | None = None
    objective_count: int | None = None
    writing_count: int = 0
    writing_answered_count: int = 0
    core_count: int | None = None
    supplementary_count: int = 0
    attempt_id: str | None = None
    focus: str
    article: Article | None = None
    lesson_notes: str | None = None
    learning_objectives: list[str] = Field(default_factory=list)
    questions: list[Question]


class AnswerBody(BaseModel):
    question_id: str = Field(min_length=1, max_length=160)
    selected_index: int | None = Field(default=None, ge=0, le=20)
    answer_text: str | None = Field(default=None, min_length=1, max_length=8000)

    @model_validator(mode="after")
    def one_answer(self):
        if ((self.selected_index is None) == (self.answer_text is None)
                or self.answer_text is not None and not self.answer_text.strip()):
            raise ValueError("Submit one choice or a nonempty writing answer")
        return self


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
                               body.question_id, body.selected_index,
                               answer_text=body.answer_text)
