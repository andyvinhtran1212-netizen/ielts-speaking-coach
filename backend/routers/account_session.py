"""One session per learner account — the account routes
(COURSEACCESS-0055 T009 and T014, plan 5.9 / 5.13 / 5.13b).

All four are exempt from the activation gate (``ACTIVATION_EXEMPT_ROUTES``)
and run ``services.session_gate`` themselves, so a session that is not yet the
current one can still see its state, claim, or sign out everywhere. While
runtime flag ``single_session_learners`` is off they report ``enabled: false``
(status, claim) or 404 ``single_session_disabled`` (revoke-all) and change
nothing. The screens (8a–8c, "Đăng xuất khỏi mọi thiết bị") belong to G05-T20.
"""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Header, Query, Request
from pydantic import BaseModel

from routers.auth import get_supabase_user
from services import session_gate

router = APIRouter(prefix="/api/account", tags=["account-session"])


class OtherSessionOut(BaseModel):
    device_label: Optional[str] = None
    since: Optional[str] = None
    approx_location: None = None


class TimedActivityOut(BaseModel):
    title: str
    device_label: Optional[str] = None
    minutes_left: int


class SessionStatusOut(BaseModel):
    enabled: bool
    state: Literal["current", "other_device", "other_device_timed"]
    other_session: Optional[OtherSessionOut] = None
    timed_activity: Optional[TimedActivityOut] = None


class SessionClaimOut(BaseModel):
    enabled: bool
    state: Literal["current"]
    revoked: int


class RevokeAllOut(BaseModel):
    revoked: int
    deferred_timed: Optional[TimedActivityOut] = None
    at: str


class LoginEventOut(BaseModel):
    at: Optional[str] = None
    device_kind: Literal["desktop", "phone", "tablet", "unknown"]
    device_label: Optional[str] = None
    method: Literal["google", "email_code", "unknown"]
    outcome: Literal["signed_in", "pending", "claimed", "claim_refused_timed", "displaced", "signed_out_all"]
    is_current: bool
    approx_location: None = None


class LoginEventsOut(BaseModel):
    enabled: bool
    items: list[LoginEventOut]


@router.get("/session/status", response_model=SessionStatusOut)
async def get_session_status(request: Request, authorization: Optional[str] = Header(None)):
    """State of this session: ``current``, or another device is current
    (``other_device`` / ``other_device_timed``). 503 ``session_status_unavailable``."""
    user = await get_supabase_user(authorization)
    return await session_gate.status(str(user["id"]), authorization, request.headers.get("user-agent"))


@router.post("/session/claim", response_model=SessionClaimOut)
async def claim_session(request: Request, authorization: Optional[str] = Header(None)):
    """"Tiếp tục ở đây": make this session current and sign the others out.
    409 ``timed_activity_in_progress`` (+ ``timed_activity``) while timed work
    runs; 503 ``session_claim_unavailable``. Never runs by itself at sign-in."""
    user = await get_supabase_user(authorization)
    return await session_gate.claim(str(user["id"]), authorization, request.headers.get("user-agent"))


@router.post("/sessions/revoke-all", response_model=RevokeAllOut)
async def revoke_all_sessions(request: Request, authorization: Optional[str] = Header(None)):
    """Sign out of every device. A session in timed work is kept until that
    work ends (``deferred_timed``). 404 ``single_session_disabled`` while the
    flag is off; 503 ``session_revoke_unavailable``."""
    user = await get_supabase_user(authorization)
    return await session_gate.revoke_all(str(user["id"]), authorization, request.headers.get("user-agent"))


@router.get("/login-events", response_model=LoginEventsOut)
async def get_login_events(authorization: Optional[str] = Header(None),
                           limit: int = Query(3, ge=1, le=10)):
    """"Lần đăng nhập gần đây" (G04-T16, FR-049): the newest event of each of
    the last ``limit`` sessions. Only the current session may read it (409
    ``session_not_current``); 503 ``login_events_unavailable``. No IP address
    and no location are ever collected: ``approx_location`` is always null."""
    user = await get_supabase_user(authorization)
    return await session_gate.login_events_view(str(user["id"]), authorization, limit)
