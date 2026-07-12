"""routers/admin_writing.py — Admin endpoints for Writing Coach essay management.

Sprint W2: 4 of 10 endpoints implemented (POST /essays, GET /essays,
GET /essays/{id}, GET /essays/{id}/status). Remaining 6 stay 501 until W3
(render, delete, mark-delivered, edit-feedback, export.docx, stats).

Auth pattern: each endpoint calls `await require_admin(authorization)`
inline, matching the established convention in routers/admin.py.
"""

from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import logging

from fastapi import APIRouter, BackgroundTasks, File, Header, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from database import supabase_admin
from models.writing_feedback import WritingFeedback
from routers.admin import require_admin
from services import essay_service, instructor_workflow
from services.file_extract_service import (
    MAX_EXTRACTED_CHARS,
    FileExtractError,
    extract_text,
)
from services.access_code_permissions import (
    get_student_access_code_permissions,
    has_writing_permission,
    student_has_writing_assignment,
)
from services.writing_render import render_feedback_html, render_plain_text
from services.writing_word_exporter import render_essay_to_docx


router = APIRouter(
    prefix="/admin/writing",
    tags=["admin-writing"],
)


# ── Request bodies ────────────────────────────────────────────────────

class CreateEssayRequest(BaseModel):
    student_id:      UUID
    task_type:       str  = Field(..., pattern=r"^(task1_academic|task1_general|task2)$")
    # Size caps close cost / DoS surface even though admin-only (W2.2 audit).
    # Real IELTS prompts ~3K chars; Task 2 essays ~5–6K chars in practice.
    prompt_text:     str  = Field(..., min_length=1, max_length=5000)
    prompt_image_url: Optional[str] = None
    essay_text:      str  = Field(..., min_length=1, max_length=10000)

    analysis_level:  int  = Field(..., ge=1, le=5)
    form_of_address: str  = Field(default="em", pattern=r"^(bạn|em|anh|chị)$")
    selected_model:  str  = Field(
        default="gemini-2.5-pro",
        pattern=r"^(gemini-2\.5-pro|gemini-2\.5-flash|gemini-3\.5-flash)$",
    )

    # Sprint 2.7a — grading depth tier. Default 'standard' so clients
    # that pre-date 2.7a (curl scripts, the existing admin form before
    # the tier-picker UI ships) keep getting the Pro+12-section
    # pipeline. Quick + Standard active in 2.7a; Deep / Instructor are
    # accepted at the API boundary (so the picker can offer them as
    # disabled/coming-soon options) but the grader raises
    # NotImplementedError until 2.7b/c.
    grading_tier: str = Field(
        default="standard",
        pattern=r"^(quick|standard|deep|instructor)$",
    )


_ALLOWED_DELIVERY_METHODS = {
    "google_docs_paste",
    "word_download",
    "gdocs_api",
    "web_view",
}


class MarkDeliveredRequest(BaseModel):
    method: str = Field(default="google_docs_paste", max_length=32)
    # T3·1 — when true, the student view hides the 4 criterion sub-bands
    # (overall band always shown). Default false = show, the pre-T3·1
    # behaviour, so an omitted flag is a no-op.
    hide_subbands: bool = Field(default=False)


class BulkMarkDeliveredRequest(BaseModel):
    # Cap mirrors the list endpoint page size — a bulk-deliver acts on a queue page.
    essay_ids: list[UUID] = Field(..., min_length=1, max_length=200)
    method: str = Field(default="google_docs_paste", max_length=32)


class RegradeRequest(BaseModel):
    # T2·1 — optional per-essay analysis-level override for a regrade. None
    # (the default) means "regrade at the essay's current level" so the
    # pre-T2·1 empty-body POST keeps its exact behaviour. A 1–5 value is
    # persisted into writing_essays.analysis_level (the column the BG grader
    # re-reads) so the re-run grades at the chosen level.
    analysis_level: Optional[int] = Field(default=None, ge=1, le=5)


class GradeRatingBody(BaseModel):
    # Admin quality-rating of an AI grade (migration 116): 1–5 + optional note.
    rating: int = Field(..., ge=1, le=5)
    note: str = Field(default="", max_length=2000)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fetch_status_or_404(essay_id: str) -> str:
    """Return the current status of an essay, or raise 404 when missing.
    Soft-deleted essays (deleted_at set) are treated as gone → 404, so admin
    mutations (feedback / mark-delivered / instructor-note / regrade) refuse to
    act on a deleted essay."""
    r = (
        supabase_admin.table("writing_essays")
        .select("status")
        .eq("id", essay_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if not r.data:
        raise HTTPException(404, "Essay not found")
    return r.data[0]["status"]


def _deliver_essay(essay_id: str, method: str, hide_subbands: bool = False) -> dict:
    """Core reviewed→delivered transition for ONE essay — the single source of the
    deliver guard, shared by the per-essay endpoint and the bulk endpoint.

    Returns a structured outcome instead of raising for status/not-found, so the
    bulk caller can skip+report and the single caller can map to 404/409:
        {"essay_id", "ok": bool, "status": <current|'delivered'|None>,
         "reason": None | 'not_found' | 'not_reviewed'}
    Only `reviewed` → `delivered` is allowed (mirrors the immutable state machine);
    on success it stamps delivered_at/delivery_method/status, persists the
    hide_subbands flag (T3·1 — default False = show the 4 sub-bands, the legacy
    behaviour), and closes any accepted regrade request. Raises only on a real DB
    failure (HTTPException 500).
    """
    row = (
        supabase_admin.table("writing_essays")
        .select("status")
        .eq("id", essay_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if not row.data:
        return {"essay_id": essay_id, "ok": False, "status": None, "reason": "not_found"}
    current = row.data[0]["status"]
    if current != "reviewed":
        return {"essay_id": essay_id, "ok": False, "status": current, "reason": "not_reviewed"}

    try:
        r = (
            supabase_admin.table("writing_essays")
            .update({
                "delivered_at":     _now_iso(),
                "delivery_method":  method,
                "status":           "delivered",
                "hide_subbands":    hide_subbands,
            })
            .eq("id", essay_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Database update failed: {exc}")
    if not r.data:
        return {"essay_id": essay_id, "ok": False, "status": None, "reason": "not_found"}

    # Close the re-grade loop: a delivery that fulfils an accepted regrade request
    # marks it fulfilled. Best-effort — never block delivery on the bookkeeping.
    try:
        supabase_admin.table("essay_regrade_requests").update(
            {"status": "fulfilled", "fulfilled_at": _now_iso()}
        ).eq("essay_id", essay_id).eq("status", "accepted").execute()
    except Exception as exc:
        _logger.warning("[regrade] fulfil bookkeeping failed essay=%s: %s", essay_id, exc)

    return {"essay_id": essay_id, "ok": True, "status": "delivered", "reason": None}


def _revoke_essay(essay_id: str) -> dict:
    """Core delivered→reviewed REVERSE transition (U1 — admin pulls a delivered
    essay back to fix a mistake). Mirrors _deliver_essay's guard shape.

    This is NOT a regrade: no AI re-run, feedback row + admin_edits_json +
    hide_subbands column are all preserved. Clearing delivered_at + reverting
    status to 'reviewed' drops the essay out of the student's delivered-only
    feedback gate, so they stop seeing it; the admin can edit and re-deliver
    (reuses _deliver_essay). Precedent: accepting a student regrade request
    already does delivered→reviewed (admin_writing_regrade.py).

    Returns the same structured outcome as _deliver_essay:
        {"essay_id", "ok": bool, "status": <current|'reviewed'|None>,
         "reason": None | 'not_found' | 'not_delivered'}
    Only `delivered` → `reviewed` is allowed. Raises only on real DB failure.
    """
    row = (
        supabase_admin.table("writing_essays")
        .select("status")
        .eq("id", essay_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if not row.data:
        return {"essay_id": essay_id, "ok": False, "status": None, "reason": "not_found"}
    current = row.data[0]["status"]
    if current != "delivered":
        return {"essay_id": essay_id, "ok": False, "status": current, "reason": "not_delivered"}

    try:
        r = (
            supabase_admin.table("writing_essays")
            .update({
                "status":       "reviewed",
                "delivered_at": None,
                # delivery_method + hide_subbands intentionally LEFT as-is so a
                # re-deliver can keep the same settings; feedback is untouched.
            })
            .eq("id", essay_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Database update failed: {exc}")
    if not r.data:
        return {"essay_id": essay_id, "ok": False, "status": None, "reason": "not_found"}

    # Fix-1 (D2) — bring the review row back into the active queue so an
    # instructor-tier essay can be re-delivered (delivered→claimed). No-op
    # for standard/admin essays with no review row.
    instructor_workflow.sync_revoke_review(essay_id)

    return {"essay_id": essay_id, "ok": True, "status": "reviewed", "reason": None}


# ── Endpoints (W2) ────────────────────────────────────────────────────

@router.post("/essays", status_code=status.HTTP_202_ACCEPTED)
async def create_essay(
    body: CreateEssayRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(None),
):
    """Submit essay for grading. Returns 202 with essay_id + job_id + ETA.
    Grading runs asynchronously in the BG worker (in-task retry only).

    Sprint 2.7a.1 — Quick tier was removed (orthogonality conflict with
    persona Levels L3-L5: those Levels target sections that Quick drops).
    Deep + Instructor are reserved for Sprint 2.7b/c. Standard is the
    only tier that runs an actual grade today; everything else is a
    400 here so the bad request never reaches the BG queue.
    """
    admin = await require_admin(authorization)

    if body.grading_tier == "quick":
        raise HTTPException(
            400,
            "Quick tier was removed in Sprint 2.7a.1 (orthogonality "
            "conflict: Levels L3–L5 target sections that Quick drops). "
            "Use 'standard' tier with the appropriate Level (L1–L5) "
            "instead — Levels and tiers are now independent axes.",
        )
    # Sprint 2.7b: 'deep' is now allowed (3-pass flow ships).
    # Sprint 2.7d.1: 'instructor' is now allowed — AI Standard Pass 1
    # grades the essay, then a queue row is created for human review.
    # The student doesn't see the feedback until an admin delivers
    # the review (instructor_workflow.deliver flips writing_essays
    # status='delivered'). Quick is the only tier still rejected here.

    # Sprint 5.2 — Writing permission gate. Admin submits on behalf of
    # the student named in body.student_id; we check that *student's*
    # permissions, not the admin's. This means an admin can't bypass
    # the gate by submitting under their own auth — billing/access
    # intent follows the essay owner, not the requester.
    # WF entitlement bridge (c): the student's code grants Writing OR they
    # already have a writing assignment — symmetric with the self-submit gate.
    student_perms = get_student_access_code_permissions(body.student_id)
    if (not has_writing_permission(student_perms)
            and not student_has_writing_assignment(body.student_id)):
        raise HTTPException(
            status_code=403,
            detail=(
                "Học viên này chưa được kích hoạt quyền Writing. "
                "Cập nhật access code hoặc gán mã có quyền Writing trước khi submit."
            ),
        )

    data = body.model_dump()
    data["student_id"] = str(data["student_id"])  # UUID → str for Supabase

    info = essay_service.create_essay_with_job(data=data, admin_id=admin["id"])
    background_tasks.add_task(
        essay_service._bg_grade_essay,
        info["essay_id"],
        info["job_id"],
    )
    return {**info, "status": "queued"}


class StartGradingRequest(BaseModel):
    grading_tier: str = Field(default="standard", pattern=r"^(standard|instructor)$")
    analysis_level: int = Field(default=3, ge=1, le=5)
    selected_model: str = Field(
        default="gemini-2.5-pro",
        pattern=r"^(gemini-2\.5-pro|gemini-2\.5-flash|gemini-3\.5-flash)$",
    )


@router.post("/essays/{essay_id}/start-grading", status_code=status.HTTP_202_ACCEPTED)
async def start_grading(
    essay_id: str,
    body: StartGradingRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(None),
):
    """Admin picks a tier + triggers grading for an essay that was created
    WITHOUT an auto-scheduled job — currently only mock-exam Writing
    promotion (mock_exam_service._promote_writing_essays leaves the row
    'pending' until an admin explicitly starts grading here, 2026-07-12).
    Everything after this point (AI grades → 'graded' → admin reviews/edits
    in grade.html → 'reviewed' → 'delivered') reuses the existing pipeline
    unchanged — this endpoint only does the one missing step."""
    await require_admin(authorization)

    row = (
        supabase_admin.table("writing_essays")
        .select("id, status")
        .eq("id", essay_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if not row.data:
        raise HTTPException(404, "Essay không tồn tại.")
    if row.data[0]["status"] != "pending":
        raise HTTPException(
            409,
            f"Essay đang ở trạng thái {row.data[0]['status']!r} — chỉ chấm được essay 'pending'.",
        )

    # Atomic 'pending'→'grading' claim + job schedule (shared with the mock
    # bulk-grade endpoint). None = a concurrent request already claimed it
    # between the read above and here → 409, no duplicate job.
    job_info = essay_service.claim_pending_for_grading(
        essay_id,
        grading_tier=body.grading_tier,
        analysis_level=body.analysis_level,
        selected_model=body.selected_model,
    )
    if job_info is None:
        raise HTTPException(
            409,
            f"Essay đang ở trạng thái {row.data[0]['status']!r} — chỉ chấm được essay 'pending'.",
        )

    background_tasks.add_task(
        essay_service._bg_grade_essay,
        essay_id,
        job_info["job_id"],
    )
    return {"essay_id": essay_id, **job_info, "status": "queued"}


@router.get("/essays")
async def list_essays(
    status: Optional[str]      = Query(default=None, max_length=32),
    student_id: Optional[UUID] = Query(default=None),
    cohort_id: Optional[UUID]  = Query(default=None),
    limit:  int                = Query(default=50, ge=1, le=200),
    offset: int                = Query(default=0, ge=0),
    authorization: str | None  = Header(None),
):
    """List essays with optional status / student / cohort filters. Newest first.
    Enriched with student name+code, band, and deadline for the grade-queue UI."""
    await require_admin(authorization)
    return essay_service.list_essays(
        status=status,
        student_id=str(student_id) if student_id else None,
        cohort_id=str(cohort_id) if cohort_id else None,
        limit=limit,
        offset=offset,
    )


@router.get("/essays/{essay_id}")
async def get_essay(
    essay_id: UUID,
    authorization: str | None = Header(None),
):
    """Get essay + feedback (when graded) + student summary."""
    await require_admin(authorization)
    return essay_service.get_essay_with_feedback(str(essay_id))


@router.get("/essays/{essay_id}/status")
async def get_essay_status(
    essay_id: UUID,
    authorization: str | None = Header(None),
):
    """Lightweight status payload for polling. Cheaper than full detail."""
    await require_admin(authorization)
    return essay_service.get_essay_status(str(essay_id))


@router.post("/essays/{essay_id}/grade-rating")
async def rate_grade(
    essay_id: UUID,
    body: GradeRatingBody,
    authorization: str | None = Header(None),
):
    """Admin rates the QUALITY of this essay's AI grade (1–5 + optional note).
    Snapshots which model graded it (migration 116) for later upgrade analysis.
    Upserts: one current rating per essay."""
    admin = await require_admin(authorization)
    return essay_service.upsert_grade_rating(
        essay_id=str(essay_id), rating=body.rating, note=body.note,
        rated_by=admin["id"],
    )


@router.get("/grade-ratings/summary")
async def grade_ratings_summary(authorization: str | None = Header(None)):
    """Aggregate admin grade-quality ratings by model — the upgrade-factoring
    view: [{grading_model, n, avg_rating}]."""
    await require_admin(authorization)
    return essay_service.grade_rating_summary()


# ── Endpoints (W3 — still placeholders) ───────────────────────────────

@router.patch("/essays/{essay_id}/feedback")
async def update_feedback(
    essay_id: UUID,
    edits: dict,
    authorization: str | None = Header(None),
):
    """Persist admin edits over the AI feedback.

    Body is the entire WritingFeedback shape (after admin's edits). It is
    validated server-side against the Pydantic schema before write — a
    drift-protected admin can't store something the renderer would later
    crash on. Status flips to 'reviewed' (idempotent re-edit allowed).

    State machine: only essays in ('graded', 'reviewed') accept edits.
    Pre-graded states are still in flight (pending/grading) or terminal
    failure (failed); 'delivered' is immutable until explicit reopen
    (deferred to Phase 1.5).
    """
    admin = await require_admin(authorization)

    try:
        validated = WritingFeedback(**edits)
    except Exception as exc:
        raise HTTPException(422, f"Edits fail schema: {exc}")

    current_status = _fetch_status_or_404(str(essay_id))
    if current_status not in ("graded", "reviewed"):
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot save edits on essay with status {current_status!r}. "
                f"Allowed states: graded, reviewed."
            ),
        )

    # GV-1c: the human edit becomes a COMPOSED version (single source of truth =
    # current_version), NOT the legacy admin_edits_json overlay. First edit on an
    # AI-current → new composed version (AI version stays immutable); editing an
    # already-composed current → in-place update (no new slot). A full budget
    # raises 409 from here.
    essay_service.upsert_composed_version(str(essay_id), validated, edited_by=admin["id"])

    # Audit/badge fields stay on writing_essays (orthogonal to the version):
    # is_manually_edited drives the "✏ Đã sửa thủ công" badge; last_edited_*
    # give a per-essay trail without joining writing_feedback.
    now_iso = _now_iso()
    try:
        r = (
            supabase_admin.table("writing_essays")
            .update({
                "admin_reviewed_at":    now_iso,
                "status":               "reviewed",
                "is_manually_edited":   True,
                "last_edited_by":       admin["id"],
                "last_edited_at":       now_iso,
            })
            .eq("id", str(essay_id))
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Database update failed: {exc}")

    if not r.data:
        raise HTTPException(404, "Essay not found")
    return {"essay_id": str(essay_id), "status": "reviewed"}


@router.post("/essays/{essay_id}/mark-delivered")
async def mark_delivered(
    essay_id: UUID,
    body: MarkDeliveredRequest = MarkDeliveredRequest(),
    authorization: str | None = Header(None),
):
    """Mark essay delivered to student. Stores delivery_method + timestamp.

    State machine: only 'reviewed' can transition to 'delivered'. Skipping
    review (graded → delivered) is rejected — admin must save edits first
    so admin_edits_json reflects the version actually delivered. Already-
    delivered essays cannot be re-delivered (immutable until Phase 1.5
    reopen).
    """
    await require_admin(authorization)

    if body.method not in _ALLOWED_DELIVERY_METHODS:
        raise HTTPException(
            400,
            f"Invalid delivery method: {body.method!r}. "
            f"Allowed: {sorted(_ALLOWED_DELIVERY_METHODS)}",
        )

    # Reuse the shared transition guard; map its outcome back to the existing
    # HTTP contract (404 missing / 409 not-reviewed / 200 delivered).
    outcome = _deliver_essay(str(essay_id), body.method, body.hide_subbands)
    if outcome["reason"] == "not_found":
        raise HTTPException(404, "Essay not found")
    if outcome["reason"] == "not_reviewed":
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot mark delivered: essay status is {outcome['status']!r}. "
                f"Required: reviewed. Save edits first."
            ),
        )
    # TODO(19.4 email deferred): notify the student their essay is graded.
    return {
        "essay_id":      str(essay_id),
        "status":        "delivered",
        "method":        body.method,
        "hide_subbands": body.hide_subbands,
    }


@router.post("/essays/{essay_id}/revoke-delivery")
async def revoke_delivery(
    essay_id: UUID,
    authorization: str | None = Header(None),
):
    """U1 — Revoke a delivered essay back to `reviewed` so the admin can fix a
    mistake. No AI re-run, feedback preserved; the student stops seeing it.

    Guard: only `delivered` → `reviewed` (409 otherwise, 404 if missing).
    Re-deliver afterwards via the normal mark-delivered (reviewed→delivered)."""
    await require_admin(authorization)

    outcome = _revoke_essay(str(essay_id))
    if outcome["reason"] == "not_found":
        raise HTTPException(404, "Essay not found")
    if outcome["reason"] == "not_delivered":
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot revoke: essay status is {outcome['status']!r}. "
                f"Required: delivered."
            ),
        )
    return {
        "essay_id": str(essay_id),
        "status":   "reviewed",
        "message":  "Đã thu hồi bài. Feedback được giữ nguyên; học viên không còn thấy bài.",
    }


@router.post("/essays/bulk-mark-delivered")
async def bulk_mark_delivered(
    body: BulkMarkDeliveredRequest,
    authorization: str | None = Header(None),
):
    """Bulk-deliver many essays in one call (the grade-queue "Chờ trả" lane).

    Reuses the SAME per-essay `_deliver_essay` guard — only `reviewed` → `delivered`.
    Partial-success by design: a missing or non-reviewed essay is skipped and
    reported, never 500-ing the whole batch (e.g. a `graded` essay still needs a
    manual review/save first). Order/atomicity isn't required — each essay's
    transition is independent and idempotent under the guard.
    """
    await require_admin(authorization)

    if body.method not in _ALLOWED_DELIVERY_METHODS:
        raise HTTPException(
            400,
            f"Invalid delivery method: {body.method!r}. "
            f"Allowed: {sorted(_ALLOWED_DELIVERY_METHODS)}",
        )

    delivered: list[str] = []
    skipped: list[dict]  = []
    seen: set[str]       = set()
    for eid in body.essay_ids:
        sid = str(eid)
        if sid in seen:          # de-dupe a repeated id defensively
            continue
        seen.add(sid)
        outcome = _deliver_essay(sid, body.method)
        if outcome["ok"]:
            delivered.append(sid)
        else:
            skipped.append({"id": sid, "status": outcome["status"], "reason": outcome["reason"]})

    return {
        "delivered":       delivered,
        "skipped":         skipped,
        "delivered_count": len(delivered),
        "skipped_count":   len(skipped),
        "method":          body.method,
    }


@router.delete("/essays/{essay_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_essay(essay_id: UUID, authorization: str | None = Header(None)):
    """SOFT delete an essay — sets writing_essays.deleted_at = now() so it drops
    out of every list/count/queue but stays recoverable. This is an UPDATE, NOT a
    DELETE: no row is removed and the `writing_feedback ON DELETE CASCADE` never
    fires, so the AI/admin feedback is preserved (DELETE-freeze §8 respected).
    Idempotent + 404 on a missing OR already-deleted essay."""
    await require_admin(authorization)
    r = (
        supabase_admin.table("writing_essays")
        .update({"deleted_at": _now_iso()})
        .eq("id", str(essay_id))
        .is_("deleted_at", "null")          # only act on a live row (no-op on re-delete)
        .execute()
    )
    if not r.data:
        # either the id doesn't exist, or it's already soft-deleted
        raise HTTPException(404, "Essay not found")
    return None


@router.get("/essays/{essay_id}/render")
async def render_essay_output(
    essay_id: UUID,
    authorization: str | None = Header(None),
):
    """Render feedback as self-contained HTML for clipboard copy.

    Returns:
        {"html": <full HTML doc>, "plain_text": <stripped fallback>}
    """
    await require_admin(authorization)
    ctx = essay_service.get_essay_render_context(str(essay_id))
    html_doc = render_feedback_html(
        feedback=ctx["feedback"],
        essay_text=ctx["essay_text"],
        prompt_text=ctx["prompt_text"],
        task_type=ctx["task_type"],
        student_name=ctx["student_name"],
    )
    return {"html": html_doc, "plain_text": render_plain_text(html_doc)}


@router.get("/essays/{essay_id}/export.docx")
async def export_essay_docx(
    essay_id: UUID,
    authorization: str | None = Header(None),
):
    """Stream a .docx export of the feedback. Filename pattern:
    {student_code}_{YYYYMMDD}_T{1|2}.docx
    """
    await require_admin(authorization)
    ctx = essay_service.get_essay_render_context(str(essay_id))
    docx_bytes, filename = render_essay_to_docx(
        feedback=ctx["feedback"],
        essay_text=ctx["essay_text"],
        prompt_text=ctx["prompt_text"],
        task_type=ctx["task_type"],
        student_name=ctx["student_name"],
        student_code=ctx["student_code"],
    )
    return StreamingResponse(
        io.BytesIO(docx_bytes),
        media_type=(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _percentiles(values: list[float]) -> dict:
    """p50/p90 (nearest-rank) + n over a sample. Empty → nulls + n=0. Each
    latency metric reports its OWN n: the three delivery paths are measured
    separately (an instructor delivery never sets admin_reviewed_at), so mixing
    them would NULL-skew — we never pool the samples."""
    vals = sorted(v for v in values if v is not None)
    n = len(vals)
    if not n:
        return {"p50": None, "p90": None, "n": 0}

    def _pct(p: float):
        # nearest-rank: index = ceil(p/100 * n) - 1, clamped
        idx = max(0, min(n - 1, int(-(-p * n // 100)) - 1))
        return round(vals[idx], 2)

    return {"p50": _pct(50), "p90": _pct(90), "n": n}


@router.get("/stats")
async def get_writing_stats(authorization: str | None = Header(None)):
    """Operator dashboard for the writing pipeline: volume, queue backlogs,
    grading latency (3 paths, kept SEPARATE), and AI cost. All counts exclude
    soft-deleted essays (deleted_at IS NULL — matches every read path). This is
    a launch-readiness instrument: pre-launch the numbers are tiny by design.
    Read-only; no migration."""
    await require_admin(authorization)

    now = datetime.now(timezone.utc)
    cutoff_7d = (now - timedelta(days=7)).isoformat()

    # ── live essays (the join base for everything; deleted excluded) ──────────
    live = (
        supabase_admin.table("writing_essays")
        .select("id, status, student_id, created_at, admin_reviewed_at")
        .is_("deleted_at", "null")
        .execute()
    ).data or []
    live_ids = [e["id"] for e in live]

    by_status: dict[str, int] = {}
    for e in live:
        by_status[e["status"]] = by_status.get(e["status"], 0) + 1
    essays_last_7d = sum(1 for e in live if (e.get("created_at") or "") >= cutoff_7d)
    students_with_essays = len({e["student_id"] for e in live if e.get("student_id")})

    prompts_count = len((
        supabase_admin.table("writing_prompts").select("id").execute()
    ).data or [])

    # ── per-question feedback (AI time, cost, admin-turnaround base) ──────────
    fb_rows: list[dict] = []
    if live_ids:
        fb_rows = (
            # GV-1a SPEND-analytics exception: BASE table = ALL versions (total
            # spend across every grade/regrade); a current-only view undercounts.
            supabase_admin.table("writing_feedback")
            .select("essay_id, grading_duration_ms, created_at, cost_usd, tokens_input, tokens_output")
            .in_("essay_id", live_ids)
            .execute()
        ).data or []
    fb_created_by_essay = {f["essay_id"]: f.get("created_at") for f in fb_rows}

    ai_grade_ms = [f.get("grading_duration_ms") for f in fb_rows]

    # admin turnaround = admin_reviewed_at − writing_feedback.created_at (per essay)
    admin_turnaround_s: list[float] = []
    for e in live:
        rev, made = e.get("admin_reviewed_at"), fb_created_by_essay.get(e["id"])
        if rev and made:
            try:
                admin_turnaround_s.append(
                    (datetime.fromisoformat(rev) - datetime.fromisoformat(made)).total_seconds()
                )
            except (ValueError, TypeError):
                pass

    # ── instructor path — wholly separate table; turnaround + pending ────────
    ir_rows = (
        supabase_admin.table("instructor_reviews")
        .select("essay_id, created_at, delivered_at, status")
        .execute()
    ).data or []
    live_set = set(live_ids)
    instructor_turnaround_s: list[float] = []
    instructor_pending = 0
    for r in ir_rows:
        if r.get("essay_id") not in live_set:
            continue
        if r.get("status") in ("queued", "claimed"):
            instructor_pending += 1
        made, deliv = r.get("created_at"), r.get("delivered_at")
        if made and deliv:
            try:
                instructor_turnaround_s.append(
                    (datetime.fromisoformat(deliv) - datetime.fromisoformat(made)).total_seconds()
                )
            except (ValueError, TypeError):
                pass

    total_cost_usd = round(sum(float(f.get("cost_usd") or 0) for f in fb_rows), 4)
    total_tokens = sum((f.get("tokens_input") or 0) + (f.get("tokens_output") or 0) for f in fb_rows)

    return {
        "generated_at": now.isoformat(),
        "window": "volume.essays_last_7d = trailing 7 days; latency/cost = all-time over live (non-deleted) essays",
        "volume": {
            "total_live_essays":    len(live),
            "by_status":            by_status,
            "essays_last_7d":       essays_last_7d,
            "prompts":              prompts_count,
            "students_with_essays": students_with_essays,
        },
        "queue": {
            "awaiting_review":    by_status.get("graded", 0),    # AI-graded, needs admin review
            "awaiting_delivery":  by_status.get("reviewed", 0),  # reviewed, not yet delivered
            "instructor_pending": instructor_pending,            # instructor_reviews queued/claimed
        },
        "latency": {
            "ai_grade_ms":             _percentiles(ai_grade_ms),
            "admin_turnaround_s":      _percentiles(admin_turnaround_s),
            "instructor_turnaround_s": _percentiles(instructor_turnaround_s),
        },
        "cost": {
            "total_cost_usd": total_cost_usd,
            "total_tokens":   total_tokens,
        },
    }


# ── Phase 2.5 — instructor view + regrade ────────────────────────────


class InstructorNoteUpdate(BaseModel):
    """Body for PATCH /essays/{id}/instructor-note. Free-text note from
    Andy that lives alongside the AI grade — separate from admin_edits_json
    so it survives a regrade and so the WritingFeedback Pydantic
    validator doesn't reject it."""
    instructor_note: str = Field(default="", max_length=5000)


@router.patch("/essays/{essay_id}/instructor-note")
async def update_instructor_note(
    essay_id: UUID,
    body: InstructorNoteUpdate,
    authorization: str | None = Header(None),
):
    """Set the free-text instructor_note for an essay.

    Independent from PATCH /feedback because:
      • It's a sibling column on writing_essays (not inside admin_edits_json),
        so a regrade — which clears admin_edits_json — leaves the note alone.
      • The existing PATCH /feedback validates against WritingFeedback;
        the note isn't part of that schema and shouldn't pollute it.

    State machine: any state EXCEPT pending/grading/failed accepts a note.
    Empty string is accepted (it's how Andy clears a note he no longer
    wants to ship).
    """
    admin = await require_admin(authorization)

    current_status = _fetch_status_or_404(str(essay_id))
    if current_status in ("pending", "grading", "failed"):
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot set instructor note on essay with status "
                f"{current_status!r}. Wait for grading to complete."
            ),
        )

    now_iso = _now_iso()
    try:
        r = (
            supabase_admin.table("writing_essays")
            .update({
                "instructor_note": body.instructor_note,
                "last_edited_by":  admin["id"],
                "last_edited_at":  now_iso,
            })
            .eq("id", str(essay_id))
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Database update failed: {exc}")

    if not r.data:
        raise HTTPException(404, "Essay not found")
    return {
        "essay_id":        str(essay_id),
        "instructor_note": body.instructor_note,
    }


@router.post("/essays/{essay_id}/regrade", status_code=status.HTTP_202_ACCEPTED)
async def trigger_regrade(
    essay_id: UUID,
    background_tasks: BackgroundTasks,
    body: RegradeRequest = RegradeRequest(),
    authorization: str | None = Header(None),
):
    """Re-run AI grading on an existing essay.

    Workflow:
      1. Verify essay exists, is_flagged=False, status in (graded, reviewed,
         delivered, failed). pending/grading rejected — already in flight.
      2. DELETE the existing writing_feedback row (UNIQUE constraint on
         essay_id means the BG grader's INSERT would otherwise raise).
      3. Clear admin_edits_json + is_manually_edited (the new AI grade
         supersedes any prior manual edits — Andy must re-review).
         instructor_note is NOT cleared — Andy's personal feedback
         survives regrades on purpose (it's about the student, not the
         grade).
      4. Bump regrade_count + last_regraded_at/by, set status='grading'.
      5. Schedule the grading job + BG task.

    The flagged-essay block is the one hard reject: spam-flagged essays
    are in terminal `delivered` state and were never AI-graded. Regrading
    them would queue a job for an essay that the spam detector has
    already classified as not worth grading. Admin who really wants to
    grade a flagged essay must unflag it manually first.
    """
    admin = await require_admin(authorization)

    er = (
        supabase_admin.table("writing_essays")
        .select(
            "id, student_id, prompt_text, prompt_image_url, essay_text, "
            "task_type, analysis_level, form_of_address, selected_model, "
            "is_flagged, status, regrade_count"
        )
        .eq("id", str(essay_id))
        .is_("deleted_at", "null")          # soft-deleted → 404 (no regrade)
        .limit(1)
        .execute()
    )
    if not er.data:
        raise HTTPException(404, "Essay not found")
    essay = er.data[0]

    if essay.get("is_flagged"):
        raise HTTPException(
            status_code=409,
            detail=(
                "Cannot regrade flagged essay — spam-flagged submissions "
                "skip grading by design. Unflag the essay first if you "
                "want to AI-grade it."
            ),
        )

    if essay["status"] not in ("graded", "reviewed", "delivered", "failed"):
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot regrade essay with status {essay['status']!r}. "
                f"Wait for the current grading run to finish."
            ),
        )

    # GV-1b — cap at 3 live versions (current + ancestor chain). Reject the 4th
    # rather than evict (evicting v1 would break compare/compose). No DELETE: the
    # prior versions are KEPT; the BG grader INSERTs the next version and advances
    # current_version on success. (status flips to 'grading' below, which also
    # serializes a concurrent regrade → the 2nd sees 'grading' → 409, not 500.)
    n_live = essay_service.live_version_count(str(essay_id))
    if n_live >= essay_service.MAX_VERSIONS:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Đã đạt tối đa {essay_service.MAX_VERSIONS} version chấm cho bài "
                f"này (còn 0). Không thể chấm lại — hãy so sánh/ghép các bản hiện có."
            ),
        )

    now_iso = _now_iso()
    new_count = (essay.get("regrade_count") or 0) + 1

    # T2·1 — optional per-essay level override. When the body omits
    # analysis_level we keep the essay's current level (pre-T2·1 behaviour);
    # when it supplies 1–5 we persist it into the same column the BG grader
    # re-reads in _bg_grade_essay, so the re-run grades at the chosen level.
    current_level = essay.get("analysis_level") or 3
    effective_level = (
        body.analysis_level
        if body.analysis_level is not None
        else current_level
    )
    # P1-A — when a regrade CHANGES the level, recompute the model from the
    # level-aware policy so the stored model can't leak across the L3/L4
    # boundary (e.g. an L1–L3 essay stored gemini-3.5-flash must NOT grade with
    # Flash when regraded at L4/L5, where calibration kept Pro). Same-level
    # regrades keep the stored model (respects an admin's explicit pick).
    level_changed = body.analysis_level is not None and body.analysis_level != current_level
    regrade_model = (
        essay_service.default_grading_model(effective_level)
        if level_changed
        else (essay.get("selected_model") or "gemini-2.5-pro")
    )
    try:
        (
            supabase_admin.table("writing_essays")
            .update({
                "status":             "grading",
                "regrade_count":      new_count,
                "last_regraded_at":   now_iso,
                "last_regraded_by":   admin["id"],
                "analysis_level":     effective_level,
                "selected_model":     regrade_model,
                # The new AI grade supersedes any prior manual edit → clear the
                # badge. (admin_edits_json is DEAD post-GV-1c — not written; the
                # prior composed edit-version stays in the lineage, just not
                # current.)
                "is_manually_edited": False,
            })
            .eq("id", str(essay_id))
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Database update failed: {exc}")

    # Reuse the SAGA leg from Sprint 2.7.1: schedule_grading_job inserts
    # the writing_jobs row and returns the job id; the router adds the
    # BG task. Same pattern as POST /admin/writing/essays + the student
    # submit path use.
    job_info = essay_service.schedule_grading_job(
        essay_id       = str(essay_id),
        analysis_level = effective_level,
        selected_model = regrade_model,
        # regrade-resilience (Sprint W-MM): persist the pre-regrade status on the
        # job so the reaper can restore it if the process dies and reaper
        # attempts are exhausted (the in-memory restore_status_on_fail below
        # only covers the live BG task, not an out-of-process reaper takeover).
        restore_status = essay.get("status"),
    )
    # regrade-resilience: on grader failure, restore the pre-regrade status
    # (essay["status"], captured above before the 'grading' write) instead of
    # stranding the essay in 'failed' — the prior version is still current.
    background_tasks.add_task(
        essay_service._bg_grade_essay,
        str(essay_id),
        job_info["job_id"],
        restore_status_on_fail=essay.get("status"),
    )

    return {
        "essay_id":       str(essay_id),
        "job_id":         job_info["job_id"],
        "regrade_count":  new_count,
        "analysis_level": effective_level,
        "eta_seconds":    job_info["eta_seconds"],
        "message":        "Đang chấm lại bài. Refresh sau ~30s để xem kết quả.",
    }


@router.get("/students/{student_id}/summary")
async def get_student_summary(
    student_id: UUID,
    authorization: str | None = Header(None),
):
    """Aggregated student stats for the instructor view.

    Returns a single payload the admin-students.html "Tổng quan" modal
    can render without N+1 fetches:
      • student profile (code, name, target/current band, target date)
      • essay counters: total / graded (excluding flagged) / flagged
      • average band of the last 5 valid (non-flagged, graded) essays
      • last 10 essays with status + band score (when present)
      • last 5 assignments with prompt title + status

    "Last 5 valid" walks newest → oldest looking for graded non-flagged
    rows — students with a mix of regular + flagged submissions still
    get a meaningful average (the flagged rows just skip).
    """
    await require_admin(authorization)

    return essay_service.get_student_summary(str(student_id))


# ── Sprint 19.3 — independent-grading file extract ────────────────────

_logger = logging.getLogger(__name__)


@router.post("/extract-text")
async def extract_essay_file(
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    """Parse an admin-uploaded .docx/.txt and return plain text for the
    independent-grading flow (admin/writing/new.html upload mode).

    Stateless extract-and-discard: the file is parsed in memory and never
    persisted. The admin pastes/edits the returned text into the essay
    field, then submits through the existing POST /essays pipeline — this
    endpoint does NOT create an essay or touch grading.

    Reuses services.file_extract_service (same parser the student
    /api/writing/extract-text uses): .docx + .txt, 2 MB cap, 15 000-char
    cap, all enforced inside extract_text(). Admin-gated."""
    await require_admin(authorization)

    file_bytes = await file.read()
    filename = file.filename or ""

    try:
        text = extract_text(filename, file_bytes)
    except FileExtractError as exc:
        # Size / extension / empty / decode failures → 400 with the
        # service's Vietnamese message intact.
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        _logger.error("[admin-writing] extract-text failed filename=%s: %s", filename, exc)
        raise HTTPException(status_code=500, detail="Lỗi xử lý file. Vui lòng thử lại.")

    # Informational, non-blocking warnings the admin should glance at
    # before submitting (the text is editable, so none of these reject).
    warnings: list[str] = []
    if len(text) >= MAX_EXTRACTED_CHARS:
        warnings.append(
            f"Văn bản đã bị cắt ở {MAX_EXTRACTED_CHARS} ký tự — kiểm tra phần cuối."
        )
    if " | " in text:
        warnings.append("Phát hiện bảng trong file — đã chuyển thành văn bản, nên kiểm tra lại.")
    if len(text.strip()) < 50:
        warnings.append("Văn bản trích xuất rất ngắn — kiểm tra lại file nguồn.")

    return {
        "extracted_text": text,
        "word_count":     len(text.split()),
        "file_metadata":  {"filename": filename, "size_bytes": len(file_bytes)},
        "warnings":       warnings,
    }
