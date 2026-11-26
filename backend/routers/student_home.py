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

from fastapi import APIRouter, Header, HTTPException, Response

from database import thread_supabase_admin
from routers.auth import get_supabase_user
from services.access_code_permissions import aget_account_permissions_summary
from services.student_home_aggregator import get_home_summary_concurrent
from services.student_service import account_display_name
from models.student_today import StudentTodayResponse, TodaySeenRequest
from services import student_today


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


@router.get("/today", response_model=StudentTodayResponse)
async def today(response: Response, authorization: str | None = Header(default=None)):
    """New Today page payload (LEARNERCORE-0063 FR-019..FR-029, FR-070..FR-078).

    Writes nothing of its own, not even the seen cursor (FR-078). The only write
    is the class-ledger reconcile inside `_visible_assignments` (FR-078 exception,
    amendment 3, #2484). Each part runs in its own worker; a failing part lands
    in `degraded`.
    """
    response.headers["Cache-Control"] = "private, no-store"
    auth_user = await get_supabase_user(authorization)
    email = auth_user.get("email") or ""
    account_name = account_display_name(auth_user)
    name = account_name or (email.split("@", 1)[0] if email else "bạn")
    return await student_today.get_today_concurrent(
        thread_supabase_admin, auth_user["id"], name=name, account_name=account_name,
    )


@router.post("/today/seen", status_code=204)
async def today_seen(body: TodaySeenRequest, authorization: str | None = Header(default=None)):
    """Advance the caller's "Vừa có kết quả" cursor (FR-078). Forward-only in
    tuple order, idempotent; a future time or a malformed key is 422."""
    auth_user = await get_supabase_user(authorization)
    problem = student_today.validate_seen(body.seen_until, body.seen_key,
                                          datetime.now(timezone.utc))
    if problem:
        raise HTTPException(422, {"code": problem, "message": "Mốc đã xem không hợp lệ."})
    await asyncio.to_thread(
        lambda: student_today.advance_seen_cursor(
            thread_supabase_admin(), auth_user["id"], body.seen_until, body.seen_key),
    )
    return Response(status_code=204)
