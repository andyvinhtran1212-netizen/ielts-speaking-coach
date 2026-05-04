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

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from database import supabase_admin
from models.writing_feedback import WritingFeedback
from routers.admin import require_admin
from services import essay_service
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


# ── Endpoints (W2) ────────────────────────────────────────────────────

@router.post("/essays", status_code=status.HTTP_202_ACCEPTED)
async def create_essay(
    body: CreateEssayRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(None),
):
    """Submit essay for grading. Returns 202 with essay_id + job_id + ETA.
    Grading runs asynchronously in the BG worker (in-task retry only)."""
    admin = await require_admin(authorization)

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
    crash on. Status flips to 'reviewed'.
    """
    await require_admin(authorization)

    try:
        validated = WritingFeedback(**edits)
    except Exception as exc:
        raise HTTPException(422, f"Edits fail schema: {exc}")

    try:
        r = (
            supabase_admin.table("writing_essays")
            .update({
                "admin_edits_json":   validated.model_dump(mode="json"),
                "admin_reviewed_at":  _now_iso(),
                "status":             "reviewed",
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
    """Mark essay delivered to student. Stores delivery_method + timestamp."""
    await require_admin(authorization)

    if body.method not in _ALLOWED_DELIVERY_METHODS:
        raise HTTPException(
            400,
            f"Invalid delivery method: {body.method!r}. "
            f"Allowed: {sorted(_ALLOWED_DELIVERY_METHODS)}",
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
