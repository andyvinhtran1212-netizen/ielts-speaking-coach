"""Course 5 educator catalog and per-attempt correction report."""

from __future__ import annotations

from fastapi import APIRouter, Header
from pydantic import BaseModel
from models.grammar_content import GrammarArticleRef

from routers.admin import require_admin
from routers.admin_class_assignments import _require_course_five
from services import grammar_lesson_service as service


router = APIRouter(prefix="/admin", tags=["admin", "grammar-lesson"])


class CatalogEntry(BaseModel):
    id: str
    lesson_no: int
    title: str
    ready: bool
    reason: str | None = None
    focus: str | None = None
    question_count: int
    article: GrammarArticleRef | None = None
    content_version: str | None = None


class ReportQuestion(BaseModel):
    id: str
    prompt: str
    options: list[str]
    selected_index: int | None = None
    is_correct: bool | None = None
    correct_index: int | None = None
    explanation: str | None = None


class EducatorReport(BaseModel):
    attempt_id: str
    assignment_item_id: str
    assignment_title: str
    lesson_id: str
    status: str
    correct_count: int
    question_count: int
    completed_at: str | None = None
    focus: str
    article: GrammarArticleRef | None = None
    questions: list[ReportQuestion]


@router.get("/cohorts/{cohort_id}/grammar-lessons/catalog",
            response_model=list[CatalogEntry])
async def catalog(cohort_id: str, authorization: str | None = Header(default=None)):
    await require_admin(authorization)
    _require_course_five(cohort_id)
    return service.catalog()


@router.get("/grammar-lessons/attempts/{attempt_id}",
            response_model=EducatorReport)
async def report(attempt_id: str, authorization: str | None = Header(default=None)):
    await require_admin(authorization)
    return service.educator_report(attempt_id)
