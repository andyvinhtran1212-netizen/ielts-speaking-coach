"""One session per learner account — the three account routes
(COURSEACCESS-0055 T009, plan 5.9 / 5.13).

All three are exempt from the activation gate (``ACTIVATION_EXEMPT_ROUTES``)
and run ``services.session_gate`` themselves, so a session that is not yet the
current one can still see its state, claim, or sign out everywhere. While
runtime flag ``single_session_learners`` is off they report ``enabled: false``
(status, claim) or 404 ``single_session_disabled`` (revoke-all) and change
nothing. The screens (8a–8c, "Đăng xuất khỏi mọi thiết bị") belong to G05-T20.
"""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Header, Request
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
async def revoke_all_sessions(authorization: Optional[str] = Header(None)):
    """Sign out of every device. A session in timed work is kept until that
    work ends (``deferred_timed``). 404 ``single_session_disabled`` while the
    flag is off; 503 ``session_revoke_unavailable``."""
    user = await get_supabase_user(authorization)
    return await session_gate.revoke_all(str(user["id"]), authorization)
