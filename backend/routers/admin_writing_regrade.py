"""routers/admin_writing_regrade.py — Sprint 19.4 admin re-grade queue.

Admin side of the student-initiated re-grade flow. The student POSTs the
request via routers/writing_student.py; admins triage it here.

  GET   /admin/writing/regrade-requests          — list (filter status / cohort)
  GET   /admin/writing/regrade-requests/{id}      — single + essay/student context
  PATCH /admin/writing/regrade-requests/{id}      — accept | reject

Accept un-delivers the essay (delivered → reviewed) so the admin can edit /
AI-regrade in grade.html and re-deliver (reviewed → delivered re-runs the
existing mark-delivered path, which flips this request to 'fulfilled').
Reject is terminal and carries an admin_response shown to the student.

Context (student name, cohort, essay prompt, band) is assembled from
separate indexed queries + a Python join — no PostgREST embed-naming
dependency (same approach as admin_writing_cohorts.py).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from database import supabase_admin
from routers.admin import require_admin

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/admin/writing/regrade-requests",
    tags=["admin-writing-regrade"],
)

_STATUS_PATTERN = r"^(pending|accepted|rejected|fulfilled)$"
_PROMPT_SNIPPET = 80


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class RegradeAction(BaseModel):
    action:   str           = Field(..., pattern=r"^(accept|reject)$")
    response: Optional[str]  = Field(None, max_length=1000)


def _decorate(requests: list[dict]) -> list[dict]:
    """Attach student (name/code/cohort) + essay (prompt snippet/task/band)
    context to each request via batched lookups."""
    if not requests:
        return []

    student_ids = sorted({r["student_id"] for r in requests if r.get("student_id")})
    essay_ids   = sorted({r["essay_id"] for r in requests if r.get("essay_id")})

    students = {}
    cohorts = {}
    if student_ids:
        srows = (
            supabase_admin.table("students")
            .select("id, full_name, student_code, cohort_id")
            .in_("id", student_ids)
            .execute()
        ).data or []
        students = {s["id"]: s for s in srows}
        cohort_ids = sorted({s["cohort_id"] for s in srows if s.get("cohort_id")})
        if cohort_ids:
            crows = (
                supabase_admin.table("cohorts")
                .select("id, name")
                .in_("id", cohort_ids)
                .execute()
            ).data or []
            cohorts = {c["id"]: c["name"] for c in crows}

    essays = {}
    bands = {}
    if essay_ids:
        erows = (
            supabase_admin.table("writing_essays")
            .select("id, prompt_text, task_type, status")
            .in_("id", essay_ids)
            .execute()
        ).data or []
        essays = {e["id"]: e for e in erows}
        frows = (
            supabase_admin.table("writing_feedback")
            .select("essay_id, overall_band_score")
            .in_("essay_id", essay_ids)
            .execute()
        ).data or []
        bands = {f["essay_id"]: f.get("overall_band_score") for f in frows}

    out = []
    for r in requests:
        s = students.get(r.get("student_id")) or {}
        e = essays.get(r.get("essay_id")) or {}
        prompt = e.get("prompt_text") or ""
        out.append({
            **r,
            "student_name":  s.get("full_name") or s.get("student_code") or "—",
            "student_code":  s.get("student_code"),
            "cohort_name":   cohorts.get(s.get("cohort_id")),
            "essay_prompt":  (prompt[:_PROMPT_SNIPPET] + "…") if len(prompt) > _PROMPT_SNIPPET else prompt,
            "essay_task_type": e.get("task_type"),
            "essay_status":  e.get("status"),
            "essay_band":    bands.get(r.get("essay_id")),
        })
    return out


@router.get("")
async def list_regrade_requests(
    status: Optional[str]    = Query(default=None, pattern=_STATUS_PATTERN),
    cohort_id: Optional[UUID] = Query(default=None),
    authorization: str | None = Header(None),
):
    """List regrade requests (default: all), newest first. Optional status
    + cohort filters. `cohort_id` resolves to its students first (19.2 pattern)."""
    await require_admin(authorization)

    cohort_student_ids: Optional[list[str]] = None
    if cohort_id:
        srows = (
            supabase_admin.table("students").select("id")
            .eq("cohort_id", str(cohort_id)).execute()
        ).data or []
        cohort_student_ids = [s["id"] for s in srows]
        if not cohort_student_ids:
            return {"requests": []}

    q = (
        supabase_admin.table("essay_regrade_requests")
        .select("*")
        .order("created_at", desc=True)
        .limit(300)
    )
    if status:
        q = q.eq("status", status)
    if cohort_student_ids is not None:
        q = q.in_("student_id", cohort_student_ids)

    return {"requests": _decorate(q.execute().data or [])}


@router.get("/{request_id}")
async def get_regrade_request(request_id: UUID, authorization: str | None = Header(None)):
    await require_admin(authorization)
    r = (
        supabase_admin.table("essay_regrade_requests")
        .select("*").eq("id", str(request_id)).limit(1).execute()
    ).data
    if not r:
        raise HTTPException(404, "Không tìm thấy yêu cầu chấm lại.")
    return _decorate(r)[0]


@router.patch("/{request_id}")
async def action_regrade_request(
    request_id: UUID,
    body: RegradeAction,
    authorization: str | None = Header(None),
):
    """Accept (→ un-deliver essay to 'reviewed' for re-handling) or reject
    (terminal, requires a response shown to the student)."""
    admin = await require_admin(authorization)

    rows = (
        supabase_admin.table("essay_regrade_requests")
        .select("*").eq("id", str(request_id)).limit(1).execute()
    ).data
    if not rows:
        raise HTTPException(404, "Không tìm thấy yêu cầu chấm lại.")
    req = rows[0]
    if req["status"] != "pending":
        raise HTTPException(409, f"Yêu cầu đã được xử lý (trạng thái: {req['status']}).")

    patch = {"admin_id": admin["id"], "actioned_at": _now_iso()}

    if body.action == "reject":
        if not (body.response or "").strip():
            raise HTTPException(400, "Vui lòng nhập lý do từ chối.")
        patch["status"] = "rejected"
        patch["admin_response"] = body.response.strip()
    else:  # accept
        patch["status"] = "accepted"
        # Un-deliver the essay so the student stops seeing final feedback
        # and the admin can re-handle it. Only meaningful from 'delivered'.
        try:
            supabase_admin.table("writing_essays").update(
                {"status": "reviewed", "delivered_at": None}
            ).eq("id", req["essay_id"]).eq("status", "delivered").execute()
        except Exception as exc:
            logger.error("[regrade] essay un-deliver failed essay=%s: %s", req["essay_id"], exc)
            raise HTTPException(500, "Không thể đặt lại trạng thái bài viết.")
        # TODO(19.4 email deferred): notify the student their regrade was accepted.

    updated = (
        supabase_admin.table("essay_regrade_requests")
        .update(patch).eq("id", str(request_id)).execute()
    ).data
    if not updated:
        raise HTTPException(404, "Không tìm thấy yêu cầu chấm lại.")
    return _decorate(updated)[0]
