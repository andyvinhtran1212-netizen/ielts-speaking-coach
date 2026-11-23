"""PUBLICSITE-0059 FR-026, plan 5.7 (G05-T23): public site configuration.

``GET /api/public/site-info`` — no auth, no table. One read for the shared
contact block (Email · Điện thoại · Zalo · Giờ trả lời) and for the enrolment
screens' office hours, plus the two public feature flags the frontend needs
before it draws a form:

    {"contact": {"email", "phone", "zalo", "reply_hours"},
     "enroll": {"office_hours", "confirm_sla", "escalate_after"},
     "login_code_enabled": bool, "enroll_prelearn_chapter1": bool}

Every text comes from an env setting; an empty or blank setting is ``null``
so the page hides that line instead of printing a placeholder. The two flags
read ``runtime_flags`` and are ``false`` when the row is missing or the read
fails (a broken lookup must not open a paused feature). Bank account details
are never part of this answer: they belong to an order (G04), not the site.

The whole answer is kept 60 s in this process, so a page view costs no
database read and an admin change shows within a minute.
"""

from __future__ import annotations

import time
from typing import Optional

from fastapi import APIRouter, Response
from pydantic import BaseModel

from config import settings
from services import runtime_flags

router = APIRouter(tags=["public"])

_TTL_SECONDS = 60.0
_cache: dict[str, tuple[dict, float]] = {}

# Public flag keys (plan 5.7). Both default to off.
LOGIN_CODE_FLAG = "email_code_login"
PRELEARN_FLAG = "enroll_prelearn_chapter1"


class SiteContact(BaseModel):
    email: Optional[str] = None
    phone: Optional[str] = None
    zalo: Optional[str] = None
    reply_hours: Optional[str] = None


class SiteEnroll(BaseModel):
    office_hours: Optional[str] = None
    confirm_sla: Optional[str] = None
    escalate_after: Optional[str] = None


class SiteInfo(BaseModel):
    contact: SiteContact
    enroll: SiteEnroll
    login_code_enabled: bool
    enroll_prelearn_chapter1: bool


def _text(value: object) -> Optional[str]:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _flag(key: str) -> bool:
    try:
        return runtime_flags.is_enabled(key, default=False, on_error=False) is True
    except Exception:  # noqa: BLE001 — any failure keeps the feature off
        return False


def build_site_info() -> dict:
    return {
        "contact": {
            "email": _text(settings.SITE_CONTACT_EMAIL),
            "phone": _text(settings.SITE_CONTACT_PHONE),
            "zalo": _text(settings.SITE_CONTACT_ZALO),
            "reply_hours": _text(settings.SITE_CONTACT_REPLY_HOURS),
        },
        "enroll": {
            "office_hours": _text(settings.ENROLL_OFFICE_HOURS_TEXT),
            "confirm_sla": _text(settings.ENROLL_CONFIRM_SLA_TEXT),
            "escalate_after": _text(settings.ENROLL_ESCALATE_AFTER_TEXT),
        },
        "login_code_enabled": _flag(LOGIN_CODE_FLAG),
        "enroll_prelearn_chapter1": _flag(PRELEARN_FLAG),
    }


def site_info() -> dict:
    now = time.monotonic()
    hit = _cache.get("site_info")
    if hit is not None and hit[1] > now:
        return hit[0]
    info = build_site_info()
    _cache["site_info"] = (info, now + _TTL_SECONDS)
    return info


@router.get("/api/public/site-info", response_model=SiteInfo)
async def get_site_info(response: Response):
    # Browsers may keep it as long as this process does (60 s).
    response.headers["Cache-Control"] = "public, max-age=60"
    return site_info()
