"""routers/admin_writing.py — Admin endpoints for Writing Coach essay management.

Sprint W0: scaffolding only — endpoints return 501 Not Implemented.
Sprint W1: Gemini grader service.
Sprint W2: implement submission flow + status polling.
Sprint W3: implement render + delivery.

Auth pattern: each endpoint calls `await require_admin(authorization)`
inline, matching the established convention in routers/admin.py. No
FastAPI Depends() decorator gating — auth surface stays consistent
across the codebase.
"""

from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, status

from routers.admin import require_admin


router = APIRouter(
    prefix="/admin/writing",
    tags=["admin-writing"],
)


@router.post("/essays", status_code=status.HTTP_501_NOT_IMPLEMENTED)
async def create_essay(authorization: str | None = Header(None)):
    """Submit essay for grading. (Sprint W2)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W2")


@router.get("/essays")
async def list_essays(authorization: str | None = Header(None)):
    """List essays with filters. (Sprint W2)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W2")


@router.get("/essays/{essay_id}")
async def get_essay(essay_id: UUID, authorization: str | None = Header(None)):
    """Get essay + feedback detail. (Sprint W2)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W2")


@router.get("/essays/{essay_id}/status")
async def get_essay_status(essay_id: UUID, authorization: str | None = Header(None)):
    """Poll grading status. (Sprint W2)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W2")


@router.patch("/essays/{essay_id}/feedback")
async def update_feedback(essay_id: UUID, authorization: str | None = Header(None)):
    """Save admin edits. (Sprint W3)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W3")


@router.post("/essays/{essay_id}/mark-delivered")
async def mark_delivered(essay_id: UUID, authorization: str | None = Header(None)):
    """Mark essay delivered to student. (Sprint W3)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W3")


@router.delete("/essays/{essay_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_essay(essay_id: UUID, authorization: str | None = Header(None)):
    """Soft delete essay. (Sprint W3)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W3")


@router.get("/essays/{essay_id}/render")
async def render_essay_output(essay_id: UUID, authorization: str | None = Header(None)):
    """Get HTML render for clipboard copy. (Sprint W3)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W3")


@router.get("/essays/{essay_id}/export.docx")
async def export_essay_docx(essay_id: UUID, authorization: str | None = Header(None)):
    """Download Word file. (Sprint W3)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W3")


@router.get("/stats")
async def get_writing_stats(authorization: str | None = Header(None)):
    """Volume, cost, queue length. (Sprint W3)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W3")
