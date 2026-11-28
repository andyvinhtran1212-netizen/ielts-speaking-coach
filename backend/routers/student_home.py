"""routers/student_home.py — multi-skill student homepage endpoint.

Sprint 5.1. Powers /pages/home.html, the post-login landing.

  GET /api/student/home-summary

Single round-trip aggregating Writing + Speaking + Grammar + Vocabulary
data for the homepage's first paint. Reading + Listening surfaced as
``status='coming_soon'`` placeholders so the layout is stable when those
skills ship — flip the flag in the aggregator, no frontend churn.

Auth: standard Supabase JWT via get_supabase_user. The aggregator runs
under supabase_admin (service-role) — see services/student_home_aggregator
docstring for why a JWT-scoped client can't span the cross-table
auth.users → students join. Every query carries an explicit user_id /
student_id filter as defense-in-depth.
"""

import asyncio
from datetime import datetime, timezone

from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response

from database import thread_supabase_admin
from routers.auth import get_supabase_user
from services.access_code_permissions import aget_account_permissions_summary
from services.feature_flags import is_learner_v2_enabled
from services.student_home_aggregator import get_home_summary_concurrent
from services.student_service import account_display_name
from models.student_course import StudentCourseResponse
from models.student_today import StudentTodayResponse, TodaySeenRequest
from models.student_assigned import StudentAssignedResponse
from models.student_skill_hub import StudentSkillHubResponse
from models.student_tests import StudentTestsResponse
from services import activation_gate, session_gate, student_assigned, student_course, student_skill_hub, student_tests, student_today


router = APIRouter(prefix="/api/student", tags=["student-home"])


@router.get("/home-summary")
async def home_summary(authorization: str | None = Header(default=None)):
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    # Pull display name + email from the JWT-resolved user; fall back to
    # the email's local-part if no display_name is set so the greeting
    # never says "Xin chào, !".
    email = auth_user.get("email") or ""
    account_name = account_display_name(auth_user)
    name = account_name or (email.split("@", 1)[0] if email else "bạn")

    # PC-J05 D1b — the seven sections run concurrently off the event loop,
    # each worker thread on its own service-role client (never the shared one).
    return await get_home_summary_concurrent(
        thread_supabase_admin, user_id, name=name, email=email, account_name=account_name,
    )


@router.get("/permissions")
async def my_permissions(authorization: str | None = Header(default=None)):
    """Per-skill permission flags for the authenticated user.

    Sprint 5.2. Frontend uses this to decide whether to render the
    Writing skill card as locked, gate the writing-dashboard submit
    button into preview mode, etc. Backend remains the source of truth
    — this endpoint is convenience for the UI; every gated action is
    re-checked at request time on the relevant POST.
    """
    auth_user = await get_supabase_user(authorization)
    # W-03 — the router gate already 403s an inactive account here; the helper
    # also answers all-false for one, so no caller can leak an unactivated grant.
    # It keeps the WF entitlement bridge (c): a writing assignment surfaces
    # writing=true, consistent with the backend request-time gates.
    return await aget_account_permissions_summary(
        auth_user["id"], account_display_name(auth_user),
    )


async def _require_learner_v2(user_id: str) -> None:
    """404 unless the new learner UI is on for this account (FR-072 rule).

    Until the FR-078 exception (amendment 3, #2484) is merged, GET /today may
    not run its class-ledger reconcile for anyone the new tree is not shown to,
    and the API must not be callable directly while the flag is off. The flag
    read denies on a lookup error, so an outage answers 404, never the payload.
    """
    if not await asyncio.to_thread(is_learner_v2_enabled, user_id):
        raise HTTPException(404, {"code": "not_found", "message": "Không tìm thấy."},
                            headers={"Cache-Control": "private, no-store"})


@router.get("/today", response_model=StudentTodayResponse)
async def today(request: Request, response: Response, authorization: str | None = Header(default=None)):
    """New Today page payload (LEARNERCORE-0063 FR-019..FR-029, FR-070..FR-078).

    Writes nothing of its own, not even the seen cursor (FR-078). The only write
    is the class-ledger reconcile inside `_visible_assignments` (FR-078 exception,
    amendment 3, #2484). Each part runs in its own worker; a failing part lands
    in `degraded`. 404 while `learner_v2` is off for the caller, before any
    read or reconcile runs.
    """
    response.headers["Cache-Control"] = "private, no-store"
    auth_user = await get_supabase_user(authorization)
    # FR-094: exempt from the router gate, so the caller is checked here
    # (503 on a failed read, 403 when suspended or inactive without learner_v2).
    status = await activation_gate.aopen_learner_status(auth_user["id"])
    await session_gate.ensure_current(auth_user["id"], authorization, request.headers.get("user-agent"))
    if status == activation_gate.OPEN_ACTIVE:
        await _require_learner_v2(auth_user["id"])
    email = auth_user.get("email") or ""
    account_name = account_display_name(auth_user)
    name = account_name or (email.split("@", 1)[0] if email else "bạn")
    result = await student_today.get_today_concurrent(
        thread_supabase_admin, auth_user["id"], name=name, account_name=account_name,
        active=status == activation_gate.OPEN_ACTIVE,
    )
    if status == activation_gate.OPEN_INACTIVE:
        activation_gate.log_inactive_open_request("GET", "/api/student/today", auth_user["id"])
    return result


@router.get("/assigned", response_model=StudentAssignedResponse)
async def assigned(response: Response, authorization: str | None = Header(default=None)):
    """"Bài được giao" page payload (LEARNERCORE-0063 amendment 3, FR-095..FR-099,
    FR-102, FR-103): the caller's own /my-assignments rows plus `group`,
    `action`, `accepting` and `self_practice_available`.

    Writes nothing of its own; the only write is the class-ledger reconcile
    inside `_visible_assignments` (FR-103 exception). A failed list read is
    `degraded: ["items"]`, never an empty "no work" answer. 404 while
    `learner_v2` is off for the caller, before any read or reconcile runs
    (same gate as GET /today).
    """
    response.headers["Cache-Control"] = "private, no-store"
    auth_user = await get_supabase_user(authorization)
    await _require_learner_v2(auth_user["id"])
    account_name = account_display_name(auth_user)
    now = datetime.now(timezone.utc)
    return await asyncio.to_thread(
        student_assigned.get_assigned, auth_user["id"], account_name, now,
    )


@router.post("/today/seen", status_code=204)
async def today_seen(body: TodaySeenRequest, authorization: str | None = Header(default=None)):
    """Advance the caller's "Vừa có kết quả" cursor (FR-078). Forward-only in
    tuple order, idempotent; a future time or a malformed key is 422. 404 while
    `learner_v2` is off for the caller."""
    auth_user = await get_supabase_user(authorization)
    await _require_learner_v2(auth_user["id"])
    problem = student_today.validate_seen(body.seen_until, body.seen_key,
                                          datetime.now(timezone.utc))
    if problem:
        raise HTTPException(422, {"code": problem, "message": "Mốc đã xem không hợp lệ."})
    await asyncio.to_thread(
        lambda: student_today.advance_seen_cursor(
            thread_supabase_admin(), auth_user["id"], body.seen_until, body.seen_key),
    )
    return Response(status_code=204)


@router.get("/course", response_model=StudentCourseResponse)
async def course(response: Response, authorization: str | None = Header(default=None)):
    """Lộ trình page payload (LEARNERCORE-0063 amendment 1, FR-030..FR-037).

    Read-only (FR-085); `assigned_open` includes hand-ins that the ledger has
    not recorded yet, without updating it.
    Each part runs in its own worker; a failing part lands in `degraded`.
    """
    response.headers["Cache-Control"] = "private, no-store"
    auth_user = await get_supabase_user(authorization)
    return await student_course.get_course_concurrent(
        auth_user["id"], account_name=account_display_name(auth_user),
    )


@router.get("/skill-hub", response_model=StudentSkillHubResponse)
async def skill_hub(
    response: Response,
    skill: Literal["speaking", "writing", "listening", "reading"] = Query(...),
    authorization: str | None = Header(default=None),
):
    """One skill hub (LEARNERCORE-0063 T25, FR-111..118). Read-only, the
    caller's own data; a failing block lands in `degraded`. Any other `skill`
    is 422 (FastAPI validates the Literal)."""
    response.headers["Cache-Control"] = "private, no-store"
    auth_user = await get_supabase_user(authorization)
    return await student_skill_hub.get_skill_hub_concurrent(
        thread_supabase_admin, auth_user["id"], skill,
        account_name=account_display_name(auth_user),
    )


@router.get("/tests", response_model=StudentTestsResponse)
async def tests(response: Response, cursor: str | None = Query(default=None, max_length=512),
                authorization: str | None = Header(default=None)):
    """Thi thử page payload (LEARNERCORE-0063 amendment 1, FR-080..FR-085).

    Read-only. `cursor` is the opaque `results_next_cursor` of the previous
    page; a "Xem thêm" page carries only `results` (and `credits`). An
    unreleased mock sitting never carries a score (HOLD FR-082).
    """
    response.headers["Cache-Control"] = "private, no-store"
    auth_user = await get_supabase_user(authorization)
    try:
        return await student_tests.get_tests_concurrent(
            thread_supabase_admin, auth_user["id"], cursor=cursor,
        )
    except student_tests.BadCursor:
        raise HTTPException(400, "Con trỏ trang không hợp lệ.")
