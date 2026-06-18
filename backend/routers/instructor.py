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

  W-6-DEFERRED (UI-triggered; add WITH isolation test when the page needs it):
    GET /essays/{id}/status · GET /essays/{id}/render · GET /essays/{id}/export.docx
    · PATCH /essays/{id}/instructor-note · GET /students/{id}/summary.

  W-6-DEFERRED — GRADE-LOOP ACTIONS (intended IN, explicitly tracked, do NOT lose):
    POST /essays/{id}/regrade · POST /essays/{id}/revoke-delivery.

The admin_instructor.py review-queue (admin-only) and admin_writing* are untouched.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query, status
from pydantic import BaseModel, Field

from database import supabase_admin
from models.writing_feedback import WritingFeedback
from routers.admin import require_instructor
from services import essay_service, instructor_workflow
from services.instructor_access import (
    instructor_db,
    instructor_fan_out,
    instructor_list_essays,
    assert_essay_owned,
)
from services.instructor_workflow import ConflictError, NotFoundError

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


@router.patch("/essays/{essay_id}/feedback")
async def update_feedback(essay_id: UUID, edits: dict, authorization: str | None = Header(None)):
    me = await _me(authorization)
    assert_essay_owned(me, essay_id)               # → 403 if not owned
    try:
        validated = WritingFeedback(**edits)
    except Exception as exc:
        raise HTTPException(422, f"Edits fail schema: {exc}")

    cur = (supabase_admin.table("writing_essays").select("status")
           .eq("id", str(essay_id)).limit(1).execute().data or [None])[0]
    if not cur:
        raise HTTPException(404, "Không tìm thấy.")
    if cur.get("status") not in ("graded", "reviewed"):
        raise HTTPException(409, f"Không thể sửa khi status={cur.get('status')!r} (cần graded/reviewed).")

    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat()
    # writing_essays is the DERIVED-owner table (no accessor path); the
    # assert_essay_owned gate above is the ownership control.
    r = (supabase_admin.table("writing_essays").update({
            "admin_edits_json":   validated.model_dump(mode="json"),
            "admin_reviewed_at":  now_iso,
            "status":             "reviewed",
            "is_manually_edited": True,
            "last_edited_by":     me,
            "last_edited_at":     now_iso,
         }).eq("id", str(essay_id)).execute())
    if not r.data:
        raise HTTPException(404, "Không tìm thấy.")
    return {"essay_id": str(essay_id), "status": "reviewed"}


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
