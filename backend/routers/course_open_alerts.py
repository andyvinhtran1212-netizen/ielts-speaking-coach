"""ENROLL-0060 T22 (plan 5.7, FR-060): "Báo cho tôi khi mở".

  POST   /api/courses/{slug}/open-alerts   guest {email} or signed in {} → 202 {ok:true}
  DELETE /api/courses/{slug}/open-alerts   {unsubscribe_token} from the mail, or signed in {} → 200 {ok:true}
  GET    /api/me/open-alerts               signed in → {slugs:[…]}

The form takes bare addresses from people without an account, so it must not
become a way to mail strangers:

* every POST and DELETE first takes a slot in the shared Postgres counter keyed
  by a keyed hash of the client IP (subscribe 3/hour, unsubscribe 20/hour,
  migration 394); a counter failure refuses with 503 (fail closed);
* one row per course and lower(email), and one mail ever per row (the sweep in
  ``fn_course_open_alerts_enqueue`` sets ``notified_at`` once);
* the response is the same whether the address was new, known, unsubscribed or
  already notified, and never carries the unsubscribe token: the token only
  travels in the mail to that address, and unsubscribing replaces it.

No route here sends mail; the G04 sweep queues it and the dispatcher sends it
after ``fn_course_open_alert_send_check``. Emails, tokens and IPs are never
logged. All three routes are activation-exempt (see services/activation_gate).
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import re
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from config import settings
from database import supabase_admin
from routers.auth import get_supabase_user
from services.errors import safe_error
from services.request_safety import request_client_ip

logger = logging.getLogger(__name__)

router = APIRouter(tags=["course-open-alerts"])

_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$")
_SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_UNAVAILABLE_MESSAGE = "Chưa đăng ký nhận báo được lúc này. Bạn thử lại sau ít phút nhé."
_RATE_LIMITED_MESSAGE = "Bạn đã gửi nhiều lần quá. Bạn thử lại sau nhé."


class OpenAlertSubscribeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: Optional[str] = Field(default=None, max_length=254)


class OpenAlertUnsubscribeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    unsubscribe_token: Optional[str] = Field(default=None, max_length=128)


class OpenAlertOkOut(BaseModel):
    ok: bool


class MyOpenAlertsOut(BaseModel):
    slugs: list[str]


def _ip_hash(request: Request) -> str:
    """Keyed hash of the client IP (never the raw IP). Unknown IPs share one key."""
    ip = request_client_ip(request) or "unknown"
    key = (settings.READING_ANON_SALT or settings.SUPABASE_SERVICE_KEY or "dev-only-open-alert-key").encode()
    return hmac.new(key, b"open-alert|" + ip.encode("utf-8", "replace"), hashlib.sha256).hexdigest()[:32]


def _rpc(name: str, params: dict, *, context: str):
    try:
        return supabase_admin.rpc(name, params).execute().data
    except Exception as exc:  # missing migration, DB down: refuse, never pretend it worked
        raise safe_error(exc, status_code=503, error_code="open_alerts_unavailable",
                         message=_UNAVAILABLE_MESSAGE, context=context) from None


def _take_slot(request: Request, action: str) -> None:
    verdict = _rpc("fn_course_open_alert_attempt_check",
                   {"p_ip_hash": _ip_hash(request), "p_action": action},
                   context=f"open-alert rate limit action={action}")
    allowed = verdict.get("allowed") if isinstance(verdict, dict) else None
    retry_after_s = verdict.get("retry_after_s") if isinstance(verdict, dict) else None
    if not isinstance(allowed, bool) or type(retry_after_s) is not int or retry_after_s < 0:
        raise safe_error(None, status_code=503, error_code="open_alerts_unavailable",
                         message=_UNAVAILABLE_MESSAGE, context="open-alert rate limit: malformed result")
    if not allowed:
        retry_after_s = max(1, retry_after_s)
        raise HTTPException(
            status_code=429,
            detail={"error_code": "open_alert_rate_limited", "retry_after_s": retry_after_s,
                    "message": _RATE_LIMITED_MESSAGE},
            headers={"Retry-After": str(retry_after_s)},
        )


async def _optional_user(authorization: str | None) -> Optional[dict]:
    """None without a header; a header that does not verify is a 401 (a stale
    session must refresh, not silently subscribe a typed address instead)."""
    if not authorization:
        return None
    return await get_supabase_user(authorization)


def _account_email(user: dict) -> str:
    email = (user.get("email") or "").strip()
    if not email:
        raise HTTPException(422, {"error_code": "email_required",
                                  "message": "Tài khoản của bạn chưa có email."})
    return email


def _check_slug(slug: str) -> None:
    if len(slug) > 80 or not _SLUG_RE.match(slug):
        raise HTTPException(404, {"error_code": "course_not_found", "message": "Không tìm thấy khoá học."})


@router.post("/api/courses/{slug}/open-alerts", status_code=202, response_model=OpenAlertOkOut)
async def subscribe_open_alert(
    slug: str,
    request: Request,
    body: OpenAlertSubscribeIn,
    authorization: str | None = Header(default=None),
):
    _check_slug(slug)
    user = await _optional_user(authorization)
    if user is not None:
        email, user_id = _account_email(user), str(user["id"])
    else:
        email, user_id = (body.email or "").strip(), None
        if not _EMAIL_RE.match(email):
            raise HTTPException(422, {"error_code": "email_invalid", "message": "Email chưa đúng."})
    await asyncio.to_thread(_take_slot, request, "subscribe")
    result = await asyncio.to_thread(
        _rpc, "fn_course_open_alert_subscribe",
        {"p_slug": slug, "p_email": email, "p_user_id": user_id},
        context="open-alert subscribe")
    if result == "course_not_found":
        raise HTTPException(404, {"error_code": "course_not_found", "message": "Không tìm thấy khoá học."})
    if result == "course_already_open":
        raise HTTPException(409, {"error_code": "course_already_open",
                                  "message": "Khoá học đã mở đăng ký."})
    if result != "ok":
        raise safe_error(None, status_code=503, error_code="open_alerts_unavailable",
                         message=_UNAVAILABLE_MESSAGE, context="open-alert subscribe: unexpected result")
    return {"ok": True}


@router.delete("/api/courses/{slug}/open-alerts", response_model=OpenAlertOkOut)
async def unsubscribe_open_alert(
    slug: str,
    request: Request,
    body: OpenAlertUnsubscribeIn | None = None,
    authorization: str | None = Header(default=None),
):
    token = ((body.unsubscribe_token if body else None) or "").strip() or None
    user = None
    if token is None:
        user = await _optional_user(authorization)
        if user is None:
            raise HTTPException(401, {"error_code": "login_required",
                                      "message": "Bạn đăng nhập hoặc dùng liên kết trong thư để bỏ nhận."})
    await asyncio.to_thread(_take_slot, request, "unsubscribe")
    if len(slug) > 80 or not _SLUG_RE.match(slug):
        return {"ok": True}  # idempotent: nothing to unsubscribe
    count = await asyncio.to_thread(
        _rpc, "fn_course_open_alert_unsubscribe",
        {"p_slug": slug, "p_token": token,
         "p_user_id": str(user["id"]) if user else None,
         "p_email": (user.get("email") or None) if user else None},
        context="open-alert unsubscribe")
    if type(count) is not int:
        raise safe_error(None, status_code=503, error_code="open_alerts_unavailable",
                         message=_UNAVAILABLE_MESSAGE, context="open-alert unsubscribe: unexpected result")
    return {"ok": True}


@router.get("/api/me/open-alerts", response_model=MyOpenAlertsOut)
async def my_open_alerts(authorization: str | None = Header(default=None)):
    user = await get_supabase_user(authorization)
    slugs = await asyncio.to_thread(
        _rpc, "fn_course_open_alerts_for_user",
        {"p_user_id": str(user["id"]), "p_email": (user.get("email") or None)},
        context="open-alert list")
    if not isinstance(slugs, list) or not all(isinstance(s, str) for s in slugs):
        raise safe_error(None, status_code=503, error_code="open_alerts_unavailable",
                         message=_UNAVAILABLE_MESSAGE, context="open-alert list: unexpected result")
    return {"slugs": slugs}
