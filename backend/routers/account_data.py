"""ACCOUNTDATA-0100 plan section 4: the learner's own data export and account
deletion request.

``/api/account/deletion-request`` (FR-001…FR-003) and
``/api/account/data-export`` (FR-010…FR-012). Every route acts on the caller
only. All six are exempt from the activation gate (an account that was never
activated may still delete or export) and are allowed by
``services.account_deletion_gate`` while a deletion is pending.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Path, Response
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import text

from config import settings
from database import supabase_admin
from routers.auth import get_supabase_user
from services import account_erasure as erasure
from services import account_export as export
from services import learner_email
from services.account_data_db import require_engine
from services.staff_security import delete_auth_sessions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/account", tags=["account"])

EXPORT_BUCKET = "account-exports"
_UUID = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"


def _http(err: erasure.AccountDataError) -> HTTPException:
    headers = None
    retry_after = getattr(err, "retry_after", None)
    detail: dict[str, Any] = {"error_code": err.error_code, "message": err.message}
    if retry_after is not None:
        detail["retry_after"] = retry_after
        headers = {"Retry-After": str(retry_after)}
    return HTTPException(err.status, detail=detail, headers=headers)


def _unavailable(exc: Exception, what: str) -> HTTPException:
    logger.warning("[account_data] %s failed: %r", what, exc)
    return HTTPException(503, detail={"error_code": "account_data_unavailable",
                                      "message": "Chưa xử lý được yêu cầu. Bạn thử lại sau ít phút nhé."})


async def _profile(engine: Any, user_id: str) -> dict:
    async with engine.connect() as conn:
        row = (await conn.execute(text(
            "SELECT role, display_name FROM public.users WHERE id = CAST(:uid AS uuid)"
        ), {"uid": user_id})).first()
    return dict(row._mapping) if row else {}


# ── Deletion request ────────────────────────────────────────────────────────


class DeletionRequestBody(BaseModel):
    confirm_email: str = Field(min_length=1, max_length=320)


@router.get("/deletion-request")
async def get_deletion_request(response: Response, authorization: Optional[str] = Header(None)):
    response.headers["Cache-Control"] = "no-store"  # per-learner state (CR nit on #2600)
    user = await get_supabase_user(authorization)
    engine = require_engine()
    try:
        req = await erasure.open_request(engine, str(user["id"]))
    except Exception as exc:
        raise _unavailable(exc, "deletion-request read")
    return erasure.status_body(req)


async def _revoke_sessions(engine: Any, user_id: str) -> bool:
    try:
        await delete_auth_sessions(engine, user_id)
        return True
    except Exception as exc:
        logger.error("[account_data] session revoke failed user=%s code=session_revoke_failed: %r", user_id, exc)
        return False


async def _send_requested_letter(user: dict, profile: dict, req: erasure.DeletionRequest) -> bool:
    email = (user.get("email") or "").strip()
    if not email:
        return False
    try:
        result = await learner_email.send_direct(
            "account_deletion_requested", email,
            {"erase_after": req.erase_after, "display_name": profile.get("display_name")},
            idempotency_key=f"account-deletion-requested-{req.id}",
        )
    except Exception as exc:
        logger.error("[account_data] deletion letter failed user=%s code=email_failed: %r", user.get("id"), exc)
        return False
    if not result.ok:
        logger.warning("[account_data] deletion letter not sent user=%s code=%s", user.get("id"), result.error)
    return bool(result.ok)


@router.post("/deletion-request")
async def create_deletion_request(body: DeletionRequestBody, authorization: Optional[str] = Header(None)):
    user = await get_supabase_user(authorization)
    user_id = str(user["id"])
    engine = require_engine()
    try:
        profile = await _profile(engine, user_id)
    except Exception as exc:
        raise _unavailable(exc, "profile read")
    try:
        erasure.check_can_request(role=profile.get("role"), login_email=user.get("email"),
                                  confirm_email=body.confirm_email)
        req, created = await erasure.create_request(engine, user_id, grace_days=settings.ACCOUNT_DELETE_GRACE_DAYS)
    except erasure.AccountDataError as err:
        raise _http(err)
    except Exception as exc:
        raise _unavailable(exc, "deletion-request create")
    out = erasure.status_body(req)
    if not created:
        # FR-001: the open request, unchanged; no second letter or revoke.
        return {**out, "sessions_revoked": None, "email_sent": None}
    # FR-002: neither failure loses the request; the erasure job revokes again.
    sessions_revoked = await _revoke_sessions(engine, user_id)
    email_sent = await _send_requested_letter(user, profile, req)
    return {**out, "sessions_revoked": sessions_revoked, "email_sent": email_sent}


@router.post("/deletion-request/cancel")
async def cancel_deletion_request(authorization: Optional[str] = Header(None)):
    user = await get_supabase_user(authorization)
    engine = require_engine()
    try:
        req = await erasure.cancel_request(engine, str(user["id"]))
    except erasure.AccountDataError as err:
        raise _http(err)
    except Exception as exc:
        raise _unavailable(exc, "deletion-request cancel")
    return {"status": "cancelled", "cancelled_at": erasure._iso(req.cancelled_at)}


# ── Data export ─────────────────────────────────────────────────────────────


@router.get("/data-export")
async def get_data_export(response: Response, authorization: Optional[str] = Header(None)):
    response.headers["Cache-Control"] = "no-store"
    user = await get_supabase_user(authorization)
    engine = require_engine()
    try:
        job = await export.latest(engine, str(user["id"]))
    except Exception as exc:
        raise _unavailable(exc, "data-export read")
    return export.body(job, datetime.now(timezone.utc))


@router.post("/data-export")
async def create_data_export(authorization: Optional[str] = Header(None)):
    user = await get_supabase_user(authorization)
    engine = require_engine()
    try:
        job, _created = await export.request_export(engine, str(user["id"]),
                                                    cooldown_hours=settings.ACCOUNT_EXPORT_COOLDOWN_HOURS)
    except erasure.AccountDataError as err:
        raise _http(err)
    except Exception as exc:
        raise _unavailable(exc, "data-export create")
    return export.body(job, datetime.now(timezone.utc))


_VIETNAM_TIME = timezone(timedelta(hours=7))  # the learner's date (no DST)


def export_filename(now: Optional[datetime] = None) -> str:
    """What the browser saves the package as (CR nit on #2613): never the
    claim token that names the object."""
    local = (now or datetime.now(timezone.utc)).astimezone(_VIETNAM_TIME)
    return f"averlearning-du-lieu-tai-khoan-{local:%Y%m%d}.zip"


def sign_export_url(path: str, seconds: int) -> Optional[str]:
    item = supabase_admin.storage.from_(EXPORT_BUCKET).create_signed_url(
        path, seconds, {"download": export_filename()})
    if hasattr(item, "data"):
        item = item.data
    if not isinstance(item, dict) or item.get("error"):
        return None
    url = item.get("signedUrl") or item.get("signedURL")
    return url if isinstance(url, str) and url else None


class ExportDownloadLink(BaseModel):
    url: str
    expires_in_seconds: int


@router.get(
    "/data-export/{export_id}/download",
    response_model=ExportDownloadLink,
    responses={302: {"description": "Redirect to the signed URL (default; FR-012)"}},
)
async def download_data_export(export_id: str = Path(..., pattern=_UUID),
                               authorization: Optional[str] = Header(None),
                               accept: Optional[str] = Header(None)):
    """FR-012. Default: 302 to a short-lived signed URL. A bearer-token client
    (the Next account page, #2613) cannot follow a redirect into a download,
    so ``Accept: application/json`` returns the same link as JSON instead;
    both carry ``Cache-Control: no-store``."""
    user = await get_supabase_user(authorization)
    engine = require_engine()
    try:
        path = await export.resolve_download(engine, str(user["id"]), export_id)
    except erasure.AccountDataError as err:
        raise _http(err)
    except Exception as exc:
        raise _unavailable(exc, "data-export download")
    try:
        url = await asyncio.to_thread(sign_export_url, path, settings.ACCOUNT_EXPORT_SIGNED_URL_SECONDS)
    except Exception as exc:
        raise _unavailable(exc, "data-export sign")
    if not url:
        raise _unavailable(RuntimeError("no signed url"), "data-export sign")
    seconds = int(settings.ACCOUNT_EXPORT_SIGNED_URL_SECONDS)
    if "application/json" in (accept or "").lower():
        return JSONResponse({"url": url, "expires_in_seconds": seconds},
                            headers={"Cache-Control": "no-store", "Vary": "Accept"})
    return RedirectResponse(url, status_code=302, headers={"Cache-Control": "no-store", "Vary": "Accept"})


