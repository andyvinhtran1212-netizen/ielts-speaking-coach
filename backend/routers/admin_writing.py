"""routers/admin_writing.py — Admin endpoints for Writing Coach essay management.

Sprint W2: 4 of 10 endpoints implemented (POST /essays, GET /essays,
GET /essays/{id}, GET /essays/{id}/status). Remaining 6 stay 501 until W3
(render, delete, mark-delivered, edit-feedback, export.docx, stats).

Auth pattern: each endpoint calls `await require_admin(authorization)`
inline, matching the established convention in routers/admin.py.
"""

from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

import logging

from fastapi import APIRouter, BackgroundTasks, File, Header, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from database import supabase_admin
from models.writing_feedback import WritingFeedback
from routers.admin import require_admin
from services import essay_service
from services.file_extract_service import (
    MAX_EXTRACTED_CHARS,
    FileExtractError,
    extract_text,
)
from services.access_code_permissions import (
    get_student_access_code_permissions,
    has_writing_permission,
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
        pattern=r"^(gemini-2\.5-pro|gemini-2\.5-flash)$",
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


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fetch_status_or_404(essay_id: str) -> str:
    """Return the current status of an essay, or raise 404 when missing."""
    r = (
        supabase_admin.table("writing_essays")
        .select("status")
        .eq("id", essay_id)
        .limit(1)
        .execute()
    )
    if not r.data:
        raise HTTPException(404, "Essay not found")
    return r.data[0]["status"]


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
    student_perms = get_student_access_code_permissions(body.student_id)
    if not has_writing_permission(student_perms):
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


@router.get("/essays")
async def list_essays(
    status: Optional[str]    = Query(default=None, max_length=32),
    student_id: Optional[UUID] = Query(default=None),
    limit:  int               = Query(default=50, ge=1, le=200),
    offset: int               = Query(default=0, ge=0),
    authorization: str | None = Header(None),
):
    """List essays with optional status / student filters. Newest first."""
    await require_admin(authorization)
    return essay_service.list_essays(
        status=status,
        student_id=str(student_id) if student_id else None,
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

    # Phase 2.5: stamp manual-edit audit fields alongside the existing
    # admin_edits_json / admin_reviewed_at writes. is_manually_edited
    # drives the "✏ Đã sửa thủ công" badge in the admin grading UI;
    # last_edited_by + last_edited_at give Andy a per-essay audit trail
    # without joining writing_feedback.
    now_iso = _now_iso()
    try:
        r = (
            supabase_admin.table("writing_essays")
            .update({
                "admin_edits_json":     validated.model_dump(mode="json"),
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

    current_status = _fetch_status_or_404(str(essay_id))
    if current_status != "reviewed":
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot mark delivered: essay status is {current_status!r}. "
                f"Required: reviewed. Save edits first."
            ),
        )

    try:
        r = (
            supabase_admin.table("writing_essays")
            .update({
                "delivered_at":     _now_iso(),
                "delivery_method":  body.method,
                "status":           "delivered",
            })
            .eq("id", str(essay_id))
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Database update failed: {exc}")

    if not r.data:
        raise HTTPException(404, "Essay not found")

    # Sprint 19.4 — close the re-grade loop: if this delivery fulfils an
    # accepted regrade request, mark it fulfilled. Best-effort — never
    # block delivery on the bookkeeping.
    try:
        supabase_admin.table("essay_regrade_requests").update(
            {"status": "fulfilled", "fulfilled_at": _now_iso()}
        ).eq("essay_id", str(essay_id)).eq("status", "accepted").execute()
    except Exception as exc:
        _logger.warning("[regrade] fulfil bookkeeping failed essay=%s: %s", essay_id, exc)
    # TODO(19.4 email deferred): notify the student their essay is graded.

    return {"essay_id": str(essay_id), "status": "delivered", "method": body.method}


@router.delete("/essays/{essay_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_essay(essay_id: UUID, authorization: str | None = Header(None)):
    """Soft delete essay. (Sprint W3)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W3")


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


@router.get("/stats")
async def get_writing_stats(authorization: str | None = Header(None)):
    """Volume, cost, queue length. (Sprint W3)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W3")


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

    # Drop the existing feedback row so the BG grader's INSERT doesn't
    # collide on the essay_id UNIQUE constraint. Best-effort: a missing
    # row (essay never reached `graded`) just produces an empty result.
    try:
        (
            supabase_admin.table("writing_feedback")
            .delete()
            .eq("essay_id", str(essay_id))
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Failed to clear prior feedback: {exc}")

    now_iso = _now_iso()
    new_count = (essay.get("regrade_count") or 0) + 1
    try:
        (
            supabase_admin.table("writing_essays")
            .update({
                "status":             "grading",
                "regrade_count":      new_count,
                "last_regraded_at":   now_iso,
                "last_regraded_by":   admin["id"],
                # The new AI grade supersedes any prior manual edit, so
                # both fields reset to a clean slate.
                "admin_edits_json":   None,
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
        analysis_level = essay.get("analysis_level") or 3,
        selected_model = essay.get("selected_model") or "gemini-2.5-pro",
    )
    background_tasks.add_task(
        essay_service._bg_grade_essay,
        str(essay_id),
        job_info["job_id"],
    )

    return {
        "essay_id":      str(essay_id),
        "job_id":        job_info["job_id"],
        "regrade_count": new_count,
        "eta_seconds":   job_info["eta_seconds"],
        "message":       "Đang chấm lại bài. Refresh sau ~30s để xem kết quả.",
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

    sr = (
        supabase_admin.table("students")
        .select(
            "id, student_code, full_name, target_band, "
            "current_band_estimate, target_date, persona_notes, "
            "flag_count, is_under_review, last_flagged_at"
        )
        .eq("id", str(student_id))
        .limit(1)
        .execute()
    )
    if not sr.data:
        raise HTTPException(404, "Student not found")
    student = sr.data[0]

    # Recent essays + their feedback bands in one round-trip via the
    # foreign-key embed syntax.  `writing_feedback(...)` joins on
    # writing_feedback.essay_id = writing_essays.id and returns the
    # nested rows (or [] when no feedback exists).
    essays_resp = (
        supabase_admin.table("writing_essays")
        .select(
            "id, status, is_flagged, task_type, created_at, delivered_at, "
            "regrade_count, last_regraded_at, "
            "writing_feedback(overall_band_score)"
        )
        .eq("student_id", str(student_id))
        .order("created_at", desc=True)
        .limit(20)
        .execute()
    )
    essays = essays_resp.data or []

    assignments_resp = (
        supabase_admin.table("writing_assignments")
        .select(
            "id, status, deadline, created_at, submitted_at, delivered_at, "
            "writing_prompts(title, task_type)"
        )
        .eq("student_id", str(student_id))
        .order("created_at", desc=True)
        .limit(10)
        .execute()
    )

    # Stats
    flagged_count = sum(1 for e in essays if e.get("is_flagged"))
    graded_count  = sum(
        1 for e in essays
        if not e.get("is_flagged") and e.get("status") in ("graded", "reviewed", "delivered")
    )

    # Band trajectory: walk newest → oldest, take the first 5 valid
    # (graded, non-flagged) bands. Order is preserved from the SELECT
    # which already sorted desc on created_at.
    valid_bands: list[float] = []
    for e in essays:
        if e.get("is_flagged"):
            continue
        fb = e.get("writing_feedback") or []
        # Embedded relation can come back as a list (PostgREST default)
        # or a single object depending on the join cardinality. Be
        # defensive about both.
        if isinstance(fb, list):
            band = fb[0].get("overall_band_score") if fb else None
        elif isinstance(fb, dict):
            band = fb.get("overall_band_score")
        else:
            band = None
        if band is None:
            continue
        try:
            valid_bands.append(float(band))
        except (TypeError, ValueError):
            continue
        if len(valid_bands) >= 5:
            break

    avg_band = round(sum(valid_bands) / len(valid_bands), 1) if valid_bands else None

    return {
        "student": student,
        "stats": {
            "total_essays":        len(essays),
            "graded_count":        graded_count,
            "flagged_count":       flagged_count,
            "average_band_last5":  avg_band,
            "valid_band_sample":   len(valid_bands),
        },
        "recent_essays":      essays[:10],
        "recent_assignments": (assignments_resp.data or [])[:5],
    }


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
