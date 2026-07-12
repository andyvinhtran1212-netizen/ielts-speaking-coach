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
  POST  /admin/mock-exams/sittings/{id}/retest   — early "cần test lại" toggle
  GET   /admin/mock-exams/reading-tests          — published reading tests for the
                                                    create-exam picker (a test may be
                                                    reused across several mock exams)
  GET   /admin/mock-exams/{id}/retest-summary    — per-skill "cần test lại" counts
  GET   /admin/mock-exams/{id}/roster            — class roster grid (per-skill snapshot)
  POST  /admin/mock-exams/{id}/writing/bulk-grade — queue many sittings' Writing at once
  GET   /admin/mock-exams/{id}/assignments       — per-student retake assignments
  POST  /admin/mock-exams/{id}/assignments       — assign retake exam to students
  DELETE /admin/mock-exams/{id}/assignments/{sid}— un-assign one student
"""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException
from pydantic import BaseModel, Field

from routers.admin import require_admin
from services import essay_service
from services import mock_exam_assignment_service as assign_svc
from services import mock_exam_service as svc
from services import mock_review_workflow as wf

router = APIRouter(prefix="/admin/mock-exams", tags=["admin-mock-exams"])


class ExamCreate(BaseModel):
    code: str
    title: str
    exam_mode: str = Field(default="sequential", pattern=r"^(sequential|retake)$")
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
    exam_mode: str | None = Field(default=None, pattern=r"^(sequential|retake)$")
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


class AssignRow(BaseModel):
    user_id: str
    skills: list[str] = Field(default_factory=list)
    open_from: str | None = None
    open_until: str | None = None


class AssignBody(BaseModel):
    assignments: list[AssignRow] = Field(default_factory=list)
    source_exam_id: str | None = None


class VoidBody(BaseModel):
    reason: str = ""


class OpenBody(BaseModel):
    is_open: bool


class RetestBody(BaseModel):
    needs_retest: bool
    reason: str = ""


class BulkGradeBody(BaseModel):
    sitting_ids: list[str] = Field(default_factory=list)
    grading_tier: str = Field(default="standard", pattern=r"^(standard|instructor)$")
    analysis_level: int = Field(default=3, ge=1, le=5)
    selected_model: str = Field(
        default="gemini-2.5-pro",
        pattern=r"^(gemini-2\.5-pro|gemini-2\.5-flash|gemini-3\.5-flash)$",
    )


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


@router.get("/{exam_id}/roster")
async def roster(exam_id: str, authorization: str | None = Header(default=None)):
    """Class roster grid for the review console — one row per sitting with a
    per-skill preliminary snapshot (L/R correct count, Writing word counts,
    Speaking session count) + claim status. Replaces the flat review queue."""
    await require_admin(authorization)
    return {"roster": wf.roster(exam_id)}


@router.get("/{exam_id}/assignments")
async def list_assignments(exam_id: str, authorization: str | None = Header(default=None)):
    """Per-student retake assignments for this exam (with student names)."""
    await require_admin(authorization)
    return {"assignments": assign_svc.list_assignments(exam_id)}


@router.post("/{exam_id}/assignments")
async def create_assignments(
    exam_id: str, body: AssignBody, authorization: str | None = Header(default=None),
):
    """Assign a retake exam to specific students (each with a skill subset +
    time window). Idempotent per student — re-posting refreshes the row. The
    admin UI builds `assignments` from the source exam's retest_summary."""
    admin = await require_admin(authorization)
    rows = [r.model_dump() for r in body.assignments]
    return assign_svc.assign(
        exam_id, rows, created_by=admin["id"], source_exam_id=body.source_exam_id,
    )


@router.delete("/{exam_id}/assignments/{student_id}")
async def delete_assignment(
    exam_id: str, student_id: str, authorization: str | None = Header(default=None),
):
    """Un-assign one student from a retake exam."""
    await require_admin(authorization)
    assign_svc.remove(exam_id, student_id)
    return {"ok": True}


@router.post("/{exam_id}/writing/bulk-grade", status_code=202)
async def bulk_grade_writing(
    exam_id: str,
    body: BulkGradeBody,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    """Send the promoted Writing essays of several sittings into the grading
    queue in one action (2026-07-12) — the roster-grid bulk version of the
    per-essay start-grading button. For each requested sitting (validated to
    belong to THIS exam), each task's essay that is still 'pending' is claimed
    atomically and queued; anything already grading/graded is skipped and
    reported. A sitting the admin flagged for retest (needs_retest) is skipped
    entirely — no point grading a retaker's Writing (server-side guard; the
    roster UI already excludes it). Reuses the same claim + background task as
    the single endpoint, so the downstream pipeline is unchanged."""
    await require_admin(authorization)

    queued: list[str] = []
    skipped: list[str] = []
    retest_skipped: list[str] = []
    for sitting_id in body.sitting_ids:
        sitting = svc.get_sitting(sitting_id)
        # Only grade essays for a sitting that actually belongs to this exam —
        # never let a stray id reach into another exam's work.
        if not sitting or str(sitting.get("mock_exam_id")) != str(exam_id):
            continue
        # Early retest flag → this student is retaking; don't grade their Writing.
        if sitting.get("needs_retest"):
            retest_skipped.append(str(sitting_id))
            continue
        for essay_id in (sitting.get("essay_task1_id"), sitting.get("essay_task2_id")):
            if not essay_id:
                continue
            job_info = essay_service.claim_pending_for_grading(
                str(essay_id),
                grading_tier=body.grading_tier,
                analysis_level=body.analysis_level,
                selected_model=body.selected_model,
            )
            if job_info is None:
                skipped.append(str(essay_id))   # not 'pending' (already queued/graded)
                continue
            background_tasks.add_task(
                essay_service._bg_grade_essay, str(essay_id), job_info["job_id"],
            )
            queued.append(str(essay_id))

    return {
        "queued":         queued,
        "skipped":        skipped,
        "retest_skipped": retest_skipped,
        "grading_tier":   body.grading_tier,
    }


@router.post("/sittings/{sitting_id}/retest")
async def set_sitting_retest(
    sitting_id: str, body: RetestBody, authorization: str | None = Header(default=None),
):
    """Toggle the EARLY 'cần test lại' flag on a sitting (mig 153) — set from the
    roster off the auto-graded L/R results so Writing bulk-grade skips a retaker
    before any grading budget is spent."""
    admin = await require_admin(authorization)
    try:
        return svc.set_sitting_retest(
            sitting_id, admin["id"], body.needs_retest, body.reason,
        )
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))


@router.post("/sittings/{sitting_id}/void")
async def void_sitting(
    sitting_id: str, body: VoidBody, authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    try:
        return svc.void_sitting(sitting_id, admin["id"], body.reason)
    except svc.NotFoundError as e:
        raise HTTPException(404, str(e))
