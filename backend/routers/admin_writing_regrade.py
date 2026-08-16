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
            .is_("deleted_at", "null")          # exclude soft-deleted from regrade-request list
            .execute()
        ).data or []
        essays = {e["id"]: e for e in erows}
        frows = (
            supabase_admin.table("writing_feedback_current")   # GV-1a: current version per essay
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

    # Migration 205 ranks/caps each lane in one SQL statement. Four separate
    # HTTP reads can observe four different snapshots around a concurrent PATCH
    # and silently omit or duplicate a request across lanes.
    try:
        raw = supabase_admin.rpc("fn_list_writing_regrade_requests", {
            "p_status": status,
            "p_cohort_id": str(cohort_id) if cohort_id else None,
        }).execute().data
    except Exception as exc:
        logger.error("[regrade] canonical list failed status=%s cohort=%s: %s", status, cohort_id, exc)
        raise HTTPException(500, "Không thể đọc danh sách yêu cầu chấm lại.")

    result = raw[0] if isinstance(raw, list) and raw else raw
    if not isinstance(result, dict) or not isinstance(result.get("requests"), list) \
            or not isinstance(result.get("capped"), bool):
        raise HTTPException(500, "Máy chủ không trả về danh sách chấm lại hợp lệ.")
    return {"requests": _decorate(result["requests"]), "capped": result["capped"]}


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

    if body.action == "reject":
        if not (body.response or "").strip():
            raise HTTPException(400, "Vui lòng nhập lý do từ chối.")

    # Migration 205 owns the cross-table state transition. Reading and then
    # updating the request/essay through separate PostgREST calls creates a saga:
    # a failure or concurrent action can leave the essay hidden while the request
    # remains pending/rejected. The RPC locks and changes both rows atomically.
    try:
        raw = supabase_admin.rpc("fn_action_writing_regrade_request", {
            "p_request_id": str(request_id),
            "p_admin_id": admin["id"],
            "p_action": body.action,
            "p_response": body.response.strip() if body.response else None,
        }).execute().data
    except Exception as exc:
        logger.error("[regrade] atomic action failed request=%s: %s", request_id, exc)
        raise HTTPException(500, "Không thể xử lý yêu cầu chấm lại.")

    result = raw[0] if isinstance(raw, list) and raw else raw
    if not isinstance(result, dict):
        raise HTTPException(500, "Máy chủ không trả về kết quả xử lý hợp lệ.")
    if not result.get("ok"):
        reason = result.get("reason")
        if reason in {"not_found", "essay_not_found"}:
            raise HTTPException(404, "Không tìm thấy yêu cầu hoặc bài viết liên quan.")
        if reason == "response_required":
            raise HTTPException(400, "Vui lòng nhập lý do từ chối.")
        if reason == "already_actioned":
            raise HTTPException(409, f"Yêu cầu đã được xử lý (trạng thái: {result.get('status')}).")
        if reason == "essay_not_delivered":
            raise HTTPException(
                409,
                "Bài viết không còn ở trạng thái 'đã trả' — không thể chấp nhận yêu cầu chấm lại.",
            )
        raise HTTPException(400, "Hành động xử lý yêu cầu không hợp lệ.")

    request = result.get("request")
    if not isinstance(request, dict) or str(request.get("id")) != str(request_id):
        raise HTTPException(500, "Máy chủ không xác nhận đúng yêu cầu vừa xử lý.")
    return _decorate([request])[0]
