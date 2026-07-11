"""routers/mock_exams.py — 4-skill mock exam, student-facing (Phase 1).

Auth: get_supabase_user (Bearer JWT). This router only ORCHESTRATES the sitting
(create, section start, attach domain attempts, submit). The actual per-skill
work goes through the existing reading / listening / writing / speaking
endpoints — those persist canonically and (when attempt.sitting_id is set + the
sitting is sealed) withhold scores server-side.

Namespace note: distinct from /api/exams (the MCQ module). Prefix /api/mock-exams.

  POST /api/mock-exams/{code}/sittings              — open/resume a sitting
  GET  /api/mock-exams/sittings/{id}                — sitting state + time left
  POST /api/mock-exams/sittings/{id}/sections/{section}/start
  POST /api/mock-exams/sittings/{id}/attach         — bind a domain attempt
  POST /api/mock-exams/sittings/{id}/submit-lrw     — finalise the seated mạch
  POST /api/mock-exams/sittings/{id}/speaking       — attach speaking sessions
  GET  /api/mock-exams/sittings/{id}/result         — 403 until released, then TRF
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from routers.auth import get_supabase_user
from services import mock_exam_service as svc
from services import mock_review_workflow as review_wf

router = APIRouter(prefix="/api/mock-exams", tags=["mock-exams"])


def _raise_for(e: Exception):
    """Translate a service error into the right HTTP status."""
    if isinstance(e, svc.NotFoundError):
        raise HTTPException(404, str(e))
    if isinstance(e, (svc.WindowClosedError, svc.NotEligibleError, PermissionError)):
        raise HTTPException(403, str(e))
    if isinstance(e, svc.SittingConflictError):
        raise HTTPException(409, str(e))
    raise HTTPException(400, str(e))


class AttachBody(BaseModel):
    section: str                       # listening | reading | writing_task1 | writing_task2
    attempt_id: str


class SpeakingBody(BaseModel):
    session_ids: list[str] = Field(default_factory=list)


class WritingBody(BaseModel):
    task1_text: str = ""
    task2_text: str = ""


@router.post("/{code}/sittings")
async def open_sitting(code: str, authorization: str | None = Header(default=None)):
    user = await get_supabase_user(authorization)
    try:
        return svc.create_sitting(user["id"], code)
    except Exception as e:  # noqa: BLE001 — mapped to HTTP below
        _raise_for(e)


@router.get("/sittings/{sitting_id}")
async def get_sitting_state(
    sitting_id: str, authorization: str | None = Header(default=None),
):
    user = await get_supabase_user(authorization)
    sitting = svc.get_sitting(sitting_id)
    if not sitting:
        raise HTTPException(404, "Sitting không tồn tại.")
    if str(sitting.get("user_id")) != str(user["id"]):
        raise HTTPException(403, "Sitting không thuộc về bạn.")
    exam = svc.get_published_exam_by_id(sitting["mock_exam_id"])
    time_left = svc.lrw_time_remaining_seconds(sitting, exam) if exam else None
    return {
        "sitting": sitting,
        "exam": svc.get_exam_content_for_sitting(sitting),
        "lrw_time_left_seconds": time_left,
    }


@router.post("/sittings/{sitting_id}/start")
async def start_lrw(
    sitting_id: str, authorization: str | None = Header(default=None),
):
    """Open the whole LRW block (all 3 sections, one timer)."""
    user = await get_supabase_user(authorization)
    try:
        return svc.start_lrw(sitting_id, user["id"])
    except Exception as e:  # noqa: BLE001
        _raise_for(e)


@router.post("/sittings/{sitting_id}/attach")
async def attach_attempt(
    sitting_id: str, body: AttachBody,
    authorization: str | None = Header(default=None),
):
    user = await get_supabase_user(authorization)
    try:
        return svc.attach_attempt(sitting_id, user["id"], body.section, body.attempt_id)
    except Exception as e:  # noqa: BLE001
        _raise_for(e)


@router.post("/sittings/{sitting_id}/writing")
async def submit_writing(
    sitting_id: str, body: WritingBody,
    authorization: str | None = Header(default=None),
):
    user = await get_supabase_user(authorization)
    try:
        return svc.submit_writing(sitting_id, user["id"], body.task1_text, body.task2_text)
    except Exception as e:  # noqa: BLE001
        _raise_for(e)


@router.post("/sittings/{sitting_id}/submit-lrw")
async def submit_lrw(
    sitting_id: str, authorization: str | None = Header(default=None),
):
    user = await get_supabase_user(authorization)
    try:
        return svc.submit_lrw(sitting_id, user["id"])
    except Exception as e:  # noqa: BLE001
        _raise_for(e)


@router.post("/sittings/{sitting_id}/speaking")
async def record_speaking(
    sitting_id: str, body: SpeakingBody,
    authorization: str | None = Header(default=None),
):
    user = await get_supabase_user(authorization)
    try:
        return svc.record_speaking(sitting_id, user["id"], body.session_ids)
    except Exception as e:  # noqa: BLE001
        _raise_for(e)


@router.get("/sittings/{sitting_id}/result")
async def get_result(
    sitting_id: str, authorization: str | None = Header(default=None),
):
    """The TRF result — 403 until the sitting is released (server-side seal)."""
    user = await get_supabase_user(authorization)
    sitting = svc.get_sitting(sitting_id)
    if not sitting:
        raise HTTPException(404, "Sitting không tồn tại.")
    if str(sitting.get("user_id")) != str(user["id"]):
        raise HTTPException(403, "Sitting không thuộc về bạn.")
    if sitting.get("status") != "released":
        raise HTTPException(403, "Kết quả đang chờ giám khảo duyệt.")

    review = review_wf.get_review_for_sitting(sitting_id)
    if not review:
        raise HTTPException(404, "Chưa có hồ sơ kết quả.")
    return {
        "sitting_id":          sitting_id,
        "final_bands":         review.get("final_bands") or {},
        "examiner_comment_vi": review.get("examiner_comment_vi"),
        "per_skill_notes":     review.get("per_skill_notes") or {},
        "released_at":         review.get("released_at"),
    }
