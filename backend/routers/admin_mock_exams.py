"""routers/admin_mock_exams.py — admin CRUD for 4-skill mock exams (Phase 1).

Admin-gated (require_admin). Manages the exam DEFINITION, the SEQUENTIAL
section gate, and the per-exam sitting roster (list + void). The review
console lives in admin_mock_reviews.py.

  GET   /admin/mock-exams                       — all exams (incl. drafts)
  POST  /admin/mock-exams                        — create an exam definition
  PATCH /admin/mock-exams/{id}                   — edit / publish / archive
  POST  /admin/mock-exams/{id}/open              — live open/close toggle
  POST  /admin/mock-exams/{id}/advance           — open the NEXT seated section
  GET   /admin/mock-exams/{id}/section-progress  — active section + submitted/total
  GET   /admin/mock-exams/{id}/sittings          — sitting roster for an exam
  POST  /admin/mock-exams/sittings/{id}/void     — void a sitting (retake/tech)
  GET   /admin/mock-exams/reading-tests          — published reading tests for the
                                                    create-exam picker (a test may be
                                                    reused across several mock exams)
  GET   /admin/mock-exams/{id}/retest-summary    — per-skill "cần test lại" counts
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from routers.admin import require_admin
from services import mock_exam_service as svc
from services import mock_review_workflow as wf

router = APIRouter(prefix="/admin/mock-exams", tags=["admin-mock-exams"])


class ExamCreate(BaseModel):
    code: str
    title: str
    listening_test_id: str | None = None
    reading_test_id: str | None = None
    writing_task1_prompt_id: str | None = None
    writing_task2_prompt_id: str | None = None
    speaking_topic_set: dict = Field(default_factory=dict)
    total_minutes: int | None = None
    reading_minutes: int | None = None
    writing_minutes: int | None = None
    open_from: str | None = None
    open_until: str | None = None
    cohort_id: str | None = None
    review_sla_days: int | None = None


class ExamPatch(BaseModel):
    title: str | None = None
    listening_test_id: str | None = None
    reading_test_id: str | None = None
    writing_task1_prompt_id: str | None = None
    writing_task2_prompt_id: str | None = None
    speaking_topic_set: dict | None = None
    total_minutes: int | None = None
    reading_minutes: int | None = None
    writing_minutes: int | None = None
    open_from: str | None = None
    open_until: str | None = None
    cohort_id: str | None = None
    review_sla_days: int | None = None
    status: str | None = None      # draft | published | archived


class VoidBody(BaseModel):
    reason: str = ""


class OpenBody(BaseModel):
    is_open: bool


@router.get("")
async def list_exams(authorization: str | None = Header(default=None)):
    await require_admin(authorization)
    return {"exams": svc.admin_list_exams()}


@router.get("/reading-tests")
async def available_reading_tests(authorization: str | None = Header(default=None)):
    """Published reading tests for the "Tạo đề mới" picker. Deliberately does
    NOT hide tests already assigned to another mock exam — unlike the student
    practice list, a reading test may be reused across several mock exams."""
    await require_admin(authorization)
    return {"items": svc.admin_available_reading_tests()}


@router.post("")
async def create_exam(body: ExamCreate, authorization: str | None = Header(default=None)):
    admin = await require_admin(authorization)
    try:
        return svc.admin_create_exam(body.model_dump(exclude_none=True), admin["id"])
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/{exam_id}")
async def update_exam(
    exam_id: str, body: ExamPatch, authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    patch = body.model_dump(exclude_none=True)
    if body.status is not None and body.status not in ("draft", "published", "archived"):
        raise HTTPException(400, "status không hợp lệ.")
    try:
        return svc.admin_update_exam(exam_id, patch)
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/{exam_id}/open")
async def set_open(
    exam_id: str, body: OpenBody, authorization: str | None = Header(default=None),
):
    """Live toggle — open the exam so students can start, or close it."""
    admin = await require_admin(authorization)
    try:
        return svc.set_open(exam_id, body.is_open, admin["id"])
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))


@router.post("/{exam_id}/advance")
async def advance_section(
    exam_id: str, authorization: str | None = Header(default=None),
):
    """Open the NEXT seated section for every sitting under this exam —
    not_started → listening → reading → writing → done. Force-collects any
    straggler who hasn't submitted the section being closed."""
    admin = await require_admin(authorization)
    try:
        return svc.advance_section(exam_id, admin["id"])
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))
    except svc.SittingConflictError as e:
        raise HTTPException(409, str(e))


@router.get("/{exam_id}/section-progress")
async def section_progress(
    exam_id: str, authorization: str | None = Header(default=None),
):
    """Live "đã nộp X/Y" counts per section — informs when to advance."""
    await require_admin(authorization)
    try:
        return svc.admin_section_progress(exam_id)
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))


@router.get("/{exam_id}/sittings")
async def list_sittings(exam_id: str, authorization: str | None = Header(default=None)):
    await require_admin(authorization)
    return {"sittings": svc.admin_list_sittings(exam_id)}


@router.get("/{exam_id}/retest-summary")
async def retest_summary(exam_id: str, authorization: str | None = Header(default=None)):
    """Per-skill "cần test lại" counts for this exam's class — how many
    sittings an admin flagged, broken out per skill, plus the roster."""
    await require_admin(authorization)
    return wf.retest_summary(exam_id)


@router.post("/sittings/{sitting_id}/void")
async def void_sitting(
    sitting_id: str, body: VoidBody, authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    try:
        return svc.void_sitting(sitting_id, admin["id"], body.reason)
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))
