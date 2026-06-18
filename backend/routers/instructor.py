"""routers/instructor.py — W-4 instructor-ROLE surface (owner-scoped).

EVERY endpoint:
  • gates on require_instructor (role ∈ {instructor, admin}); admin uses /admin/*
    see-all and does NOT rely on these routes for its own work.
  • touches owner-scoped tables ONLY through the W-3 accessor / wrappers
    (instructor_db / instructor_essays / instructor_fan_out / instructor_list_essays)
    so the owner filter can never be forgotten. The grep-test enforces no direct
    supabase_admin on a registry owner-table here.
  • derives `me` from the auth context (require_instructor return), never the body.

Ownership violations raise PermissionError → 403 (global handler, generic message).
Non-owned column-owner objects fall out of the accessor scope → empty → 404
(uniform with non-existent: no existence leak). Essays use assert_essay_owned →
403 (uniform: non-owned-existing and non-existent both fail membership).

Grade loop (closed, no mark-delivered needed): reviews/queue → reviews/{id}/claim
(→ status 'claimed', essay-owner gated) → essays/{id}/feedback (→ essay 'reviewed')
→ reviews/{id}/deliver (instructor_workflow.deliver flips essay.status='delivered'
+ delivered_at → student-visible). mark-delivered is therefore REDUNDANT here.

DEFERRAL LEDGER — tracked so nothing silently drops; the meta-gate
(test_instructor_routes_isolation) forces an isolation test on each when added.

  OUT (won't build — admin-only or redundant):
    POST /essays (admin on-behalf = W-5 enroll) · POST /essays/{id}/mark-delivered
    (redundant — deliver does it) · POST /essays/bulk-mark-delivered · DELETE
    /essays/{id} (hard delete) · POST /extract-text · GET /stats · codes ·
    roster create/import/edit/delete · cohort-member management · tips ·
    regrade-request moderation queue · drafts.

  WIRED in W-6a (was Bucket B): GET /essays/{id}/status · GET /essays/{id}/render
    · GET /essays/{id}/export.docx · PATCH /essays/{id}/instructor-note
    (= teacher-comment, student-visible, AI-immutable) · GET /students/{id}/summary.

  WIRED in W-6a (was Bucket C, grade-loop): POST /essays/{id}/regrade ·
    POST /essays/{id}/revoke-delivery.

  AI-IMMUTABILITY: PATCH /essays/{id}/feedback (AI-mutate) is REJECTED for
    instructors (403) — the instructor's input is the SEPARATE teacher-comment
    (instructor_note); the AI grade is never mutated.

The admin_instructor.py review-queue (admin-only) and admin_writing* are untouched.
"""

from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from database import supabase_admin
from routers.admin import require_instructor
from services import essay_service, instructor_workflow
from services.instructor_access import (
    instructor_db,
    instructor_fan_out,
    instructor_list_essays,
    assert_essay_owned,
)
from services.instructor_workflow import ConflictError, NotFoundError
from services.writing_render import render_feedback_html, render_plain_text
from services.writing_word_exporter import render_essay_to_docx

router = APIRouter(prefix="/instructor", tags=["instructor"])


async def _me(authorization: str | None) -> str:
    return (await require_instructor(authorization))["id"]


def _whitelist(body: dict, allowed: tuple[str, ...]) -> dict:
    return {k: body[k] for k in allowed if k in body}


# ── Prompts (owner = created_by) ─────────────────────────────────────────────

_PROMPT_FIELDS = ("title", "task_type", "prompt_text", "difficulty", "tags")


@router.get("/prompts")
async def list_prompts(authorization: str | None = Header(None)):
    me = await _me(authorization)
    r = instructor_db(me).table("writing_prompts").select("*").order("created_at", desc=True).execute()
    return r.data or []


@router.post("/prompts", status_code=status.HTTP_201_CREATED)
async def create_prompt(body: dict, authorization: str | None = Header(None)):
    me = await _me(authorization)
    payload = _whitelist(body, _PROMPT_FIELDS)
    if not payload.get("title") or not payload.get("task_type") or not payload.get("prompt_text"):
        raise HTTPException(422, "title, task_type, prompt_text là bắt buộc.")
    r = instructor_db(me).table("writing_prompts").insert(payload).execute()  # stamps created_by
    return (r.data or [{}])[0]


@router.get("/prompts/{prompt_id}")
async def get_prompt(prompt_id: UUID, authorization: str | None = Header(None)):
    me = await _me(authorization)
    r = instructor_db(me).table("writing_prompts").select("*").eq("id", str(prompt_id)).limit(1).execute()
    if not r.data:
        raise HTTPException(404, "Không tìm thấy.")
    return r.data[0]


@router.patch("/prompts/{prompt_id}")
async def patch_prompt(prompt_id: UUID, body: dict, authorization: str | None = Header(None)):
    me = await _me(authorization)
    payload = _whitelist(body, _PROMPT_FIELDS + ("is_active",))
    if not payload:
        raise HTTPException(422, "Không có trường hợp lệ để cập nhật.")
    r = instructor_db(me).table("writing_prompts").update(payload).eq("id", str(prompt_id)).execute()
    if not r.data:
        raise HTTPException(404, "Không tìm thấy.")     # 0 rows = not owned / not exist
    return r.data[0]


@router.delete("/prompts/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_prompt(prompt_id: UUID, authorization: str | None = Header(None)):
    me = await _me(authorization)
    r = instructor_db(me).table("writing_prompts").delete().eq("id", str(prompt_id)).execute()
    if not r.data:
        raise HTTPException(404, "Không tìm thấy.")
    return None


# ── Assignments (owner = assigned_by) ────────────────────────────────────────

class FanOutBody(BaseModel):
    prompt_ids: list[UUID]
    cohort_id: UUID
    name: Optional[str] = None
    allow_soft_check: bool = False
    deadline: Optional[str] = None
    instructions: Optional[str] = None
    analysis_level: int = 3


@router.get("/assignments")
async def list_assignments(authorization: str | None = Header(None)):
    me = await _me(authorization)
    r = instructor_db(me).table("writing_assignments").select("*").order("created_at", desc=True).execute()
    return r.data or []


@router.get("/assignments/{assignment_id}")
async def get_assignment(assignment_id: UUID, authorization: str | None = Header(None)):
    me = await _me(authorization)
    r = instructor_db(me).table("writing_assignments").select("*").eq("id", str(assignment_id)).limit(1).execute()
    if not r.data:
        raise HTTPException(404, "Không tìm thấy.")
    return r.data[0]


@router.patch("/assignments/{assignment_id}")
async def patch_assignment(assignment_id: UUID, body: dict, authorization: str | None = Header(None)):
    me = await _me(authorization)
    payload = _whitelist(body, ("deadline", "instructions"))
    if not payload:
        raise HTTPException(422, "Không có trường hợp lệ để cập nhật.")
    r = instructor_db(me).table("writing_assignments").update(payload).eq("id", str(assignment_id)).execute()
    if not r.data:
        raise HTTPException(404, "Không tìm thấy.")
    return r.data[0]


@router.delete("/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_assignment(assignment_id: UUID, authorization: str | None = Header(None)):
    me = await _me(authorization)
    r = instructor_db(me).table("writing_assignments").delete().eq("id", str(assignment_id)).execute()
    if not r.data:
        raise HTTPException(404, "Không tìm thấy.")
    return None


@router.post("/assignments/fan-out", status_code=status.HTTP_201_CREATED)
async def fan_out(body: FanOutBody, authorization: str | None = Header(None)):
    me = await _me(authorization)
    # instructor_fan_out enforces prompt/cohort/student ownership → PermissionError → 403.
    result = instructor_fan_out(
        me, supabase_admin,
        prompt_ids=body.prompt_ids, cohort_id=body.cohort_id,
        name=body.name, allow_soft_check=body.allow_soft_check,
        deadline=None, instructions=body.instructions, analysis_level=body.analysis_level,
    )
    if result["student_count"] == 0:
        raise HTTPException(400, "Lớp này chưa có học viên nào.")
    return result


# ── Essays (DERIVED owner — assert_essay_owned per single-essay op) ───────────

@router.get("/essays")
async def list_essays(
    status_: Optional[str] = Query(default=None, alias="status", max_length=32),
    student_id: Optional[UUID] = Query(default=None),
    cohort_id: Optional[UUID] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(None),
):
    me = await _me(authorization)
    # instructor_list_essays scopes to owned essays (2-branch) + checks any
    # student_id/cohort_id filter belongs to me (PermissionError → 403).
    return instructor_list_essays(
        me, status=status_,
        student_id=str(student_id) if student_id else None,
        cohort_id=str(cohort_id) if cohort_id else None,
        limit=limit, offset=offset,
    )


@router.get("/essays/{essay_id}")
async def get_essay(essay_id: UUID, authorization: str | None = Header(None)):
    me = await _me(authorization)
    assert_essay_owned(me, essay_id)               # → 403 if not owned
    return essay_service.get_essay_with_feedback(str(essay_id))


class InstructorNoteBody(BaseModel):
    instructor_note: str = Field(default="", description="teacher-comment (student-visible)")


class RegradeBody(BaseModel):
    analysis_level: Optional[int] = Field(default=None, ge=1, le=5)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.patch("/essays/{essay_id}/feedback")
async def update_feedback(essay_id: UUID, edits: dict, authorization: str | None = Header(None)):
    """AI-IMMUTABILITY enforce (W-6a): an instructor can NEVER mutate the AI
    feedback (admin_edits_json), even API-direct. The instructor's grading
    contribution is the SEPARATE teacher-comment via /instructor-note (which
    leaves the AI grade exactly as graded). Reject unconditionally → 403."""
    await _me(authorization)
    raise HTTPException(
        403, "Giảng viên không được sửa AI feedback (bất biến). Dùng teacher-comment "
             "qua PATCH /instructor/essays/{id}/instructor-note.",
    )


@router.patch("/essays/{essay_id}/instructor-note")
async def update_instructor_note(essay_id: UUID, body: InstructorNoteBody,
                                 authorization: str | None = Header(None)):
    """Teacher-comment (W-6a): set writing_essays.instructor_note — a STUDENT-
    VISIBLE sibling column, SEPARATE from AI feedback (survives regrade). This is
    the instructor's review action; it transitions graded→reviewed WITHOUT
    touching admin_edits_json (AI immutable)."""
    me = await _me(authorization)
    assert_essay_owned(me, essay_id)               # → 403 if not owned
    cur = (supabase_admin.table("writing_essays").select("status")
           .eq("id", str(essay_id)).limit(1).execute().data or [None])[0]
    if not cur:
        raise HTTPException(404, "Không tìm thấy.")
    if cur.get("status") in ("pending", "grading", "failed"):
        raise HTTPException(409, f"Không thể ghi nhận xét khi status={cur.get('status')!r}.")
    # writing_essays = DERIVED-owner (no accessor); assert_essay_owned is the gate.
    # admin_edits_json/feedback_json intentionally UNTOUCHED → AI immutable.
    upd = {"instructor_note": body.instructor_note,
           "last_edited_by": me, "last_edited_at": _now_iso()}
    if cur.get("status") == "graded":
        upd["status"] = "reviewed"                 # instructor reviewed it
    supabase_admin.table("writing_essays").update(upd).eq("id", str(essay_id)).execute()
    return {"essay_id": str(essay_id), "instructor_note": body.instructor_note,
            "status": upd.get("status", cur.get("status"))}


@router.get("/essays/{essay_id}/status")
async def essay_status(essay_id: UUID, authorization: str | None = Header(None)):
    me = await _me(authorization)
    assert_essay_owned(me, essay_id)
    return essay_service.get_essay_status(str(essay_id))


@router.get("/essays/{essay_id}/render")
async def render_essay(essay_id: UUID, authorization: str | None = Header(None)):
    """Render feedback as self-contained HTML. The teacher-comment
    (instructor_note) is carried in the render context SEPARATELY from the AI
    feedback (writing_render shows it in its own block — never merged into AI)."""
    me = await _me(authorization)
    assert_essay_owned(me, essay_id)
    ctx = essay_service.get_essay_render_context(str(essay_id))
    html_doc = render_feedback_html(
        feedback=ctx["feedback"], essay_text=ctx["essay_text"],
        prompt_text=ctx["prompt_text"], task_type=ctx["task_type"],
        student_name=ctx["student_name"],
    )
    return {"html": html_doc, "plain_text": render_plain_text(html_doc)}


@router.get("/essays/{essay_id}/export.docx")
async def export_docx(essay_id: UUID, authorization: str | None = Header(None)):
    me = await _me(authorization)
    assert_essay_owned(me, essay_id)
    ctx = essay_service.get_essay_render_context(str(essay_id))
    docx_bytes, filename = render_essay_to_docx(
        feedback=ctx["feedback"], essay_text=ctx["essay_text"],
        prompt_text=ctx["prompt_text"], task_type=ctx["task_type"],
        student_name=ctx["student_name"], student_code=ctx["student_code"],
    )
    return StreamingResponse(
        io.BytesIO(docx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/essays/{essay_id}/regrade", status_code=status.HTTP_202_ACCEPTED)
async def regrade_essay(essay_id: UUID, background_tasks: BackgroundTasks,
                        body: RegradeBody = RegradeBody(),
                        authorization: str | None = Header(None)):
    """Re-run AI grading on an OWNED essay (Bucket C). Clears AI feedback +
    admin_edits_json (new AI grade supersedes); instructor_note (teacher-comment)
    is PRESERVED (survives regrade by design). analysis_level lever kept."""
    me = await _me(authorization)
    assert_essay_owned(me, essay_id)
    essay = (supabase_admin.table("writing_essays")
             .select("id, status, is_flagged, task_type, analysis_level, "
                     "form_of_address, selected_model, grading_tier")
             .eq("id", str(essay_id)).is_("deleted_at", "null").limit(1).execute().data or [None])[0]
    if not essay:
        raise HTTPException(404, "Không tìm thấy.")
    if essay.get("is_flagged"):
        raise HTTPException(409, "Không thể chấm lại bài bị gắn cờ.")
    if essay.get("status") not in ("graded", "reviewed", "delivered", "failed"):
        raise HTTPException(409, f"Không thể chấm lại khi status={essay.get('status')!r}.")
    try:
        supabase_admin.table("writing_feedback").delete().eq("essay_id", str(essay_id)).execute()
    except Exception as exc:
        raise HTTPException(500, f"Failed to clear prior feedback: {exc}")
    effective_level = body.analysis_level if body.analysis_level is not None else (essay.get("analysis_level") or 3)
    supabase_admin.table("writing_essays").update({
        "status": "grading", "analysis_level": effective_level,
        "admin_edits_json": None, "is_manually_edited": False,
    }).eq("id", str(essay_id)).execute()   # instructor_note NOT cleared (preserved)
    job_info = essay_service.schedule_grading_job(
        essay_id=str(essay_id), analysis_level=effective_level,
        selected_model=essay.get("selected_model") or "gemini-2.5-pro",
        grading_tier=essay.get("grading_tier") or "standard",
    )
    background_tasks.add_task(essay_service._bg_grade_essay, str(essay_id), job_info["job_id"])
    return {"essay_id": str(essay_id), "status": "grading",
            "analysis_level": effective_level, "eta_seconds": job_info.get("eta_seconds")}


@router.post("/essays/{essay_id}/revoke-delivery")
async def revoke_delivery(essay_id: UUID, authorization: str | None = Header(None)):
    """Pull an OWNED delivered essay back to 'reviewed' (Bucket C). No AI re-run,
    feedback + teacher-comment preserved; student stops seeing it. delivered→reviewed
    only (mirrors admin _revoke_essay)."""
    me = await _me(authorization)
    assert_essay_owned(me, essay_id)
    cur = (supabase_admin.table("writing_essays").select("status")
           .eq("id", str(essay_id)).is_("deleted_at", "null").limit(1).execute().data or [None])[0]
    if not cur:
        raise HTTPException(404, "Không tìm thấy.")
    if cur.get("status") != "delivered":
        raise HTTPException(409, f"Chỉ thu hồi được bài đã giao (status={cur.get('status')!r}).")
    supabase_admin.table("writing_essays").update(
        {"status": "reviewed", "delivered_at": None}
    ).eq("id", str(essay_id)).execute()
    return {"essay_id": str(essay_id), "status": "reviewed",
            "message": "Đã thu hồi bài. Feedback giữ nguyên; học viên không còn thấy bài."}


# ── Cohorts (owner = created_by) ─────────────────────────────────────────────

@router.get("/cohorts")
async def list_cohorts(authorization: str | None = Header(None)):
    me = await _me(authorization)
    r = instructor_db(me).table("cohorts").select("*").order("created_at", desc=True).execute()
    return r.data or []


@router.post("/cohorts", status_code=status.HTTP_201_CREATED)
async def create_cohort(body: dict, authorization: str | None = Header(None)):
    me = await _me(authorization)
    payload = _whitelist(body, ("name", "code_prefix", "description"))
    if not payload.get("name"):
        raise HTTPException(422, "name là bắt buộc.")
    r = instructor_db(me).table("cohorts").insert(payload).execute()   # stamps created_by
    return (r.data or [{}])[0]


@router.get("/cohorts/{cohort_id}")
async def get_cohort(cohort_id: UUID, authorization: str | None = Header(None)):
    me = await _me(authorization)
    r = instructor_db(me).table("cohorts").select("*").eq("id", str(cohort_id)).limit(1).execute()
    if not r.data:
        raise HTTPException(404, "Không tìm thấy.")
    return r.data[0]


# ── Students roster (owner = instructor_id) — READ ONLY (enroll = W-5) ────────

@router.get("/students")
async def list_students(authorization: str | None = Header(None)):
    me = await _me(authorization)
    r = instructor_db(me).table("students").select("*").order("created_at", desc=True).execute()
    return r.data or []


@router.get("/students/{student_id}")
async def get_student(student_id: UUID, authorization: str | None = Header(None)):
    me = await _me(authorization)
    r = instructor_db(me).table("students").select("*").eq("id", str(student_id)).limit(1).execute()
    if not r.data:
        raise HTTPException(404, "Không tìm thấy.")
    return r.data[0]


@router.get("/students/{student_id}/summary")
async def student_summary(student_id: UUID, authorization: str | None = Header(None)):
    """Roster-detail aggregate. Owner-gated: the student must be mine (accessor
    scope) BEFORE the shared aggregation runs → non-owned student → 404 (empty)."""
    me = await _me(authorization)
    owned = (instructor_db(me).table("students").select("id")
             .eq("id", str(student_id)).limit(1).execute())
    if not owned.data:
        raise HTTPException(404, "Không tìm thấy.")     # not my student (uniform w/ non-existent)
    return essay_service.get_student_summary(str(student_id))


# ── Reviews (queue scoped by essay-ownership; claim = essay-owner check) ──────

@router.get("/reviews/queue")
async def reviews_queue(authorization: str | None = Header(None)):
    me = await _me(authorization)
    # essay-ownership scoped — NOT claimed_by (claimable rows have claimed_by NULL).
    return instructor_workflow.get_instructor_queue(me)


@router.post("/reviews/{review_id}/claim")
async def claim_review(review_id: UUID, authorization: str | None = Header(None)):
    me = await _me(authorization)
    try:
        # owner_id=me → claim-time essay-owner check BEFORE the lock (→ 403 if not owned).
        return instructor_workflow.claim(review_id, me, owner_id=me)
    except NotFoundError:
        raise HTTPException(404, "Không tìm thấy.")
    except ConflictError as e:
        raise HTTPException(409, str(e))


@router.post("/reviews/{review_id}/release")
async def release_review(review_id: UUID, authorization: str | None = Header(None)):
    me = await _me(authorization)
    # release() only matches claimed_by=me → a non-owner release raises PermissionError → 403.
    try:
        return instructor_workflow.release(review_id, me)
    except NotFoundError:
        raise HTTPException(404, "Không tìm thấy.")
    except ConflictError as e:
        raise HTTPException(409, str(e))


@router.post("/reviews/{review_id}/deliver")
async def deliver_review(review_id: UUID, authorization: str | None = Header(None)):
    me = await _me(authorization)
    try:
        return instructor_workflow.deliver(review_id, me)
    except NotFoundError:
        raise HTTPException(404, "Không tìm thấy.")
    except ConflictError as e:
        raise HTTPException(409, str(e))
