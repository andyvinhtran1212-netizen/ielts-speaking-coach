"""routers/admin_mock_reviews.py — admin review console for 4-skill mocks (Phase 1).

Admin-gated (require_admin). Drives the sitting-level review lifecycle by
delegating to services/mock_review_workflow.py (the atomic-claim clone of
instructor_workflow). The per-skill grading surfaces are the EXISTING ones:
Writing → the admin_writing page (by essay id on the sitting); Reading /
Listening → the attempt review; Speaking → the session review. This console
aggregates the 4-skill final decision + release.

  GET  /admin/mock-reviews                        — active queue (queued+claimed)
  GET  /admin/mock-reviews/{id}                   — one review (+ sitting)
  POST /admin/mock-reviews/{id}/claim             — atomic claim
  POST /admin/mock-reviews/{id}/release-claim     — return to queue
  POST /admin/mock-reviews/{id}/final-bands       — save 4 bands (overall computed)
  POST /admin/mock-reviews/{id}/release           — RELEASE results (lifts seal)
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from routers.admin import require_admin
from services import mock_exam_service as svc
from services import mock_review_workflow as wf

router = APIRouter(prefix="/admin/mock-reviews", tags=["admin-mock-reviews"])


class FinalBandsBody(BaseModel):
    final_bands: dict                        # {listening, reading, writing, speaking}
    examiner_comment_vi: str | None = None
    per_skill_notes: dict | None = None
    retest_flags: dict | None = None          # {listening, reading, writing, speaking}: bool


class ReleaseBody(BaseModel):
    channel: str = "in_app"                  # in_app | email | manual


def _raise_for(e: Exception):
    if isinstance(e, wf.NotFoundError):
        raise HTTPException(404, str(e))
    if isinstance(e, wf.ValidationError):
        raise HTTPException(400, str(e))
    if isinstance(e, wf.ConflictError):
        raise HTTPException(409, str(e))
    if isinstance(e, PermissionError):
        raise HTTPException(403, str(e))
    raise HTTPException(400, str(e))


@router.get("")
async def queue(
    status: str | None = Query(default=None),
    mock_exam_id: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    """Reviews are duyệt theo từng đề — mock_exam_id scopes the queue to one
    exam's sittings. Omitting it still works (cross-exam, legacy) but the
    console always passes it now."""
    await require_admin(authorization)
    statuses = [status] if status else None
    return {"reviews": wf.get_queue(statuses, mock_exam_id=mock_exam_id)}


@router.get("/{review_id}")
async def get_review(review_id: str, authorization: str | None = Header(default=None)):
    await require_admin(authorization)
    review = wf.get_review(review_id)
    if not review:
        raise HTTPException(404, "Review không tồn tại.")
    sitting = svc.get_sitting(review["sitting_id"]) or {}
    names = wf.resolve_display_names([sitting.get("user_id")])
    sitting["student_name"] = names.get(sitting.get("user_id"), "—")
    return {
        "review": review,
        "sitting": sitting,
        "required_skills": wf.required_skills_for_sitting(review["sitting_id"]),
        # Of those, the ones the examiner may legitimately leave blank: their raw
        # score has no published band, so there is nothing to enter. Without this
        # the console cannot tell "no band exists" from "you forgot one", and its
        # all-bands-required gate blocked the save before the server's own rule
        # could allow it (Codex review, PR #779).
        "blankable_skills": sorted(wf.blankable_skills_for_sitting(review["sitting_id"])),
    }


@router.post("/{review_id}/claim")
async def claim(review_id: str, authorization: str | None = Header(default=None)):
    admin = await require_admin(authorization)
    try:
        return wf.claim(review_id, admin["id"])
    except Exception as e:  # noqa: BLE001
        _raise_for(e)


@router.post("/{review_id}/release-claim")
async def release_claim(review_id: str, authorization: str | None = Header(default=None)):
    admin = await require_admin(authorization)
    try:
        return wf.release(review_id, admin["id"])
    except Exception as e:  # noqa: BLE001
        _raise_for(e)


@router.post("/{review_id}/final-bands")
async def save_final_bands(
    review_id: str, body: FinalBandsBody,
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    try:
        return wf.save_final_bands(
            review_id, admin["id"], body.final_bands,
            examiner_comment_vi=body.examiner_comment_vi,
            per_skill_notes=body.per_skill_notes,
            retest_flags=body.retest_flags,
        )
    except Exception as e:  # noqa: BLE001
        _raise_for(e)


@router.post("/{review_id}/release")
async def release(
    review_id: str, body: ReleaseBody,
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    try:
        return wf.release_results(review_id, admin["id"], channel=body.channel)
    except Exception as e:  # noqa: BLE001
        _raise_for(e)
