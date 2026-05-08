"""routers/admin_instructor.py — Instructor tier review queue (Sprint 2.7d.1).

Admin-only endpoints for the human-review queue that sits on top of
Instructor-tier essays. The queue page (Sprint 2.7d.2) consumes these
endpoints. Auth follows the same pattern as routers/admin_writing.py:
each endpoint calls `await require_admin(authorization)` inline.

Endpoints:

  GET  /admin/instructor/queue                 — list queue items
  POST /admin/instructor/reviews/{id}/claim    — atomic claim (409 on conflict)
  POST /admin/instructor/reviews/{id}/release  — release own claim (403 on non-owner)
  POST /admin/instructor/reviews/{id}/deliver  — mark delivered + mirror note

Note: there's no separate `require_instructor` guard in 2.7d.1 — every
admin can act as an instructor for now. A future sprint can add a
distinct role + guard without touching these endpoints' bodies.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query

from models.instructor_review import (
    DeliverRequest,
    InstructorQueueItem,
    InstructorReview,
    InstructorReviewStatus,
)
from routers.admin import require_admin
from services import instructor_workflow
from services.instructor_workflow import (
    ConflictError,
    NotFoundError,
)


router = APIRouter(
    prefix="/admin/instructor",
    tags=["admin-instructor"],
)


# ── Queue ─────────────────────────────────────────────────────────────


@router.get("/queue", response_model=list[InstructorQueueItem])
async def get_queue(
    status: Optional[list[str]] = Query(
        default=None,
        description="Filter by status. Defaults to ['queued', 'claimed'] — "
                    "the active queue. Pass ['delivered'] for recent history.",
    ),
    instructor_id: Optional[UUID] = Query(
        default=None,
        description="Filter to reviews claimed by this instructor (e.g. 'my claims' view).",
    ),
    authorization: str | None = Header(default=None),
) -> list[InstructorQueueItem]:
    """List instructor queue items joined with essay + student email.

    Default returns the active queue (queued + claimed) sorted oldest
    first so FIFO is the visible order.
    """
    await require_admin(authorization)

    if status is None:
        status_filter = None
    else:
        # Validate every status string at the boundary; an unknown
        # value should 400 rather than silently match nothing.
        try:
            status_filter = [InstructorReviewStatus(s) for s in status]
        except ValueError as e:
            raise HTTPException(400, f"Invalid status value: {e}")

    return instructor_workflow.get_queue(
        status_filter=status_filter,
        instructor_id=instructor_id,
    )


# ── Claim / Release / Deliver ─────────────────────────────────────────


@router.post("/reviews/{review_id}/claim", response_model=InstructorReview)
async def claim_review(
    review_id: UUID,
    authorization: str | None = Header(default=None),
) -> InstructorReview:
    """Atomic claim. 409 on conflict (already claimed), 404 if missing."""
    admin = await require_admin(authorization)
    try:
        return instructor_workflow.claim(review_id, UUID(admin["id"]))
    except ConflictError as e:
        raise HTTPException(409, str(e))
    except NotFoundError as e:
        raise HTTPException(404, str(e))


@router.post("/reviews/{review_id}/release", response_model=InstructorReview)
async def release_review(
    review_id: UUID,
    authorization: str | None = Header(default=None),
) -> InstructorReview:
    """Release own claim. 403 if claimed by another instructor."""
    admin = await require_admin(authorization)
    try:
        return instructor_workflow.release(review_id, UUID(admin["id"]))
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except NotFoundError as e:
        raise HTTPException(404, str(e))


@router.post("/reviews/{review_id}/deliver", response_model=InstructorReview)
async def deliver_review(
    review_id: UUID,
    payload: DeliverRequest,
    authorization: str | None = Header(default=None),
) -> InstructorReview:
    """Mark delivered. Mirrors instructor_note onto writing_essays
    (student-facing column) and stamps writing_feedback prompt_version
    with `-instructor`. 403 if not the current claimant."""
    admin = await require_admin(authorization)
    try:
        return instructor_workflow.deliver(
            review_id,
            UUID(admin["id"]),
            instructor_note=payload.instructor_note,
        )
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except NotFoundError as e:
        raise HTTPException(404, str(e))
