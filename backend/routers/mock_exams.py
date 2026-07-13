"""routers/mock_exams.py — 4-skill mock exam, student-facing (Phase 1).

Auth: get_supabase_user (Bearer JWT). This router only ORCHESTRATES the sitting
(create, attach domain attempts, submit each section). The actual per-skill
work goes through the existing reading / listening / writing / speaking
endpoints — those persist canonically and (when attempt.sitting_id is set + the
sitting is sealed) withhold scores server-side.

SEQUENTIAL model: the three seated sections open ONE AT A TIME, admin-gated
(see services/mock_exam_service.py docstring). There is no per-student "start"
— a section opens for everyone under the exam the moment the admin advances to
it (POST /admin/mock-exams/{id}/advance), and the client picks that up on its
next GET /sittings/{id} poll.

Namespace note: distinct from /api/exams (the MCQ module). Prefix /api/mock-exams.

  POST /api/mock-exams/{code}/sittings                    — open/resume a sitting
  GET  /api/mock-exams/sittings/{id}                       — sitting + exam state, time left
  POST /api/mock-exams/sittings/{id}/attach                — bind a domain attempt
  POST /api/mock-exams/sittings/{id}/sections/{section}/submit — collect one section
  POST /api/mock-exams/sittings/{id}/speaking               — attach speaking sessions
  GET  /api/mock-exams/sittings/{id}/result                 — 403 until released, then TRF
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from routers.auth import get_supabase_user
from services import essay_service
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


class SectionSubmitBody(BaseModel):
    task1_text: str = ""
    task2_text: str = ""


@router.get("")
async def list_open(authorization: str | None = Header(default=None)):
    """Open exams the student can start (published + is_open + cohort-eligible)."""
    user = await get_supabase_user(authorization)
    return {"exams": svc.list_open_exams(user["id"])}


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
    if svc.is_retake(exam):
        # Per-student: active section + countdown come from THIS sitting's own
        # clocks, and the runner shows only the assigned skills.
        active, time_left = svc.retake_active_section(sitting, exam)
        assigned = sitting.get("assigned_skills") or []
    else:
        active = (exam or {}).get("active_section") or "not_started"
        time_left = svc.section_time_remaining_seconds(exam, active) if exam else None
        assigned = None
    return {
        "sitting": sitting,
        "exam": svc.get_exam_content_for_sitting(sitting),
        "exam_mode": (exam or {}).get("exam_mode") or "sequential",
        "assigned_skills": assigned,
        "active_section": active,
        "section_time_left_seconds": time_left,
    }


@router.post("/sittings/{sitting_id}/sections/{section}/start")
async def start_section(
    sitting_id: str, section: str,
    authorization: str | None = Header(default=None),
):
    """Retake only: the student begins a section — stamps its per-sitting clock
    so the countdown + auto-submit start. Sequential opens sections via the
    admin's advance instead."""
    user = await get_supabase_user(authorization)
    try:
        return svc.start_section(sitting_id, user["id"], section)
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


@router.post("/sittings/{sitting_id}/sections/{section}/submit")
async def submit_section(
    sitting_id: str, section: str, body: SectionSubmitBody,
    authorization: str | None = Header(default=None),
):
    """Collect ONE section (listening/reading/writing). No early manual
    submit exists client-side — this fires when that section's shared clock
    hits 0. Finalises the sitting once every configured section is in."""
    user = await get_supabase_user(authorization)
    try:
        return svc.submit_section(
            sitting_id, user["id"], section, body.task1_text, body.task2_text,
        )
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

    # Only surface a Writing-feedback link for an essay that was actually
    # DELIVERED — release leaves a still-'graded' essay untouched, and
    # writing-result.html only shows feedback for 'delivered', so an
    # undelivered id would be a dead-end link (2026-07-12).
    e1, e2 = sitting.get("essay_task1_id"), sitting.get("essay_task2_id")
    delivered = essay_service.delivered_essay_ids([e1, e2])
    return {
        "sitting_id":           sitting_id,
        "final_bands":          review.get("final_bands") or {},
        "examiner_comment_vi":  review.get("examiner_comment_vi"),
        "per_skill_notes":      review.get("per_skill_notes") or {},
        "released_at":          review.get("released_at"),
        # so the TRF page can link to the detailed chữa bài / Writing feedback
        # for each skill — only reachable once release_results() has flipped
        # sealed=False (L/R) and delivered the essays (Writing), the same gates
        # the review / my-essays endpoints themselves enforce (2026-07-12).
        "listening_attempt_id": sitting.get("listening_attempt_id"),
        "reading_attempt_id":   sitting.get("reading_attempt_id"),
        "essay_task1_id":       e1 if str(e1) in delivered else None,
        "essay_task2_id":       e2 if str(e2) in delivered else None,
    }
