"""COURSEACCESS-0055 plan 5.9 — the public course catalogue.

``GET /api/courses`` and ``GET /api/courses/{slug}`` list public, unarchived
online products. Sign-in is optional: with a valid token each item also
carries the caller's ``viewer`` state; without one (or with an invalid one)
the caller is a guest. Per-person data is never cached.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from config import settings
from database import supabase_admin
from routers.auth import get_supabase_user
from services import entitlements as ent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/courses", tags=["courses"])

_CATALOG_COLUMNS = (
    "id, course_id, slug, kind, title, short_title, summary, status, is_public, tuition_vnd, access_days, "
    "ai_credits, credit_valid_days, features, display_order, expected_open_on, presentation, archived_at"
)
_LISTED_STATUSES = ("open", "coming_soon", "closed")


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, detail={"error_code": code, "message": message})


async def _optional_user(authorization: Optional[str]) -> Optional[dict]:
    """Verified user, or None (guest) for a missing or invalid token."""
    if not authorization:
        return None
    try:
        return await get_supabase_user(authorization)
    except HTTPException:
        return None


# ── Reads ─────────────────────────────────────────────────────────────────


def fetch_catalog_products(slug: Optional[str] = None) -> list[dict]:
    query = (
        supabase_admin.table("course_products").select(_CATALOG_COLUMNS)
        .eq("is_public", True).eq("kind", "online").is_("archived_at", "null")
        .in_("status", list(_LISTED_STATUSES))
    )
    if slug is not None:
        query = query.eq("slug", slug).limit(1)
    else:
        query = query.order("display_order").order("title")
    return list(query.execute().data or [])


def fetch_course_codes(course_ids) -> dict[str, str]:
    ids = sorted({str(i) for i in course_ids if i})
    if not ids:
        return {}
    res = supabase_admin.table("courses").select("id, code").in_("id", ids).execute()
    return {str(r["id"]): r.get("code") for r in (res.data or [])}


def _outline_for(product: dict) -> dict:
    """The single joint for course lessons (G07, COURSELESSON). Until G07 owns
    ``course_lessons`` both fields are null."""
    return {"lesson_count": None, "chapters": None}


# ── Presentation ──────────────────────────────────────────────────────────


def credits_expire_note(product: dict) -> Optional[str]:
    if not product.get("ai_credits"):
        return None
    days = product.get("credit_valid_days")
    if days is None:
        return "Dùng tới hết hạn khoá"
    return f"Dùng trong {int(days)} ngày kể từ ngày mở khoá"


def carry_fields() -> dict:
    percent = settings.CREDIT_CARRY_PERCENT
    if not percent:
        return {"credit_carry_percent": None, "credit_carry_valid_days": None}
    return {"credit_carry_percent": percent, "credit_carry_valid_days": settings.CREDIT_CARRY_VALID_DAYS}


def _text(value) -> Optional[str]:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _author(value) -> Optional[dict]:
    if not isinstance(value, dict) or not _text(value.get("name")):
        return None
    return {"name": _text(value.get("name")), "bio_line": _text(value.get("bio_line")),
            "photo_url": _text(value.get("photo_url"))}


def _faq(value) -> Optional[list]:
    if not isinstance(value, list):
        return None
    items = [{"q": _text(i.get("q")), "a": _text(i.get("a"))} for i in value
             if isinstance(i, dict) and _text(i.get("q")) and _text(i.get("a"))]
    return items or None


def viewer_for(product: dict, rows: Optional[list[dict]], open_orders: Optional[dict[str, str]],
               now: datetime) -> dict:
    """``rows`` are the viewer's entitlements rows; None means guest."""
    if rows is None:
        return {"state": "guest", "days_left": None, "can_renew": False, "open_order_code": None}
    order_code = (open_orders or {}).get(str(product["id"]))
    mine = [r for r in rows if str(r.get("course_id")) == str(product["course_id"])]
    active = [r for r in mine if ent.entitlement_state(r, now) == "active"]
    expired = [r for r in mine if ent.entitlement_state(r, now) == "expired"]
    far = datetime.max.replace(tzinfo=timezone.utc)
    if active:
        latest = max(active, key=lambda r: ent.parse_ts(r.get("expires_at")) or far)
        expires_at, state = ent.parse_ts(latest.get("expires_at")), "enrolled"
    elif order_code:
        expires_at, state = None, "open_order"
    elif expired:
        latest = max(expired, key=lambda r: ent.parse_ts(r.get("expires_at")))
        expires_at, state = ent.parse_ts(latest.get("expires_at")), "expired"
    else:
        expires_at, state = None, "can_enroll"
    renew_state = {"enrolled": "active", "expired": "expired"}.get(state, "none")
    return {
        "state": state,
        "days_left": ent.days_left(expires_at, now) if state in ("enrolled", "expired") else None,
        "can_renew": ent.can_renew(product=product, state=renew_state, expires_at=expires_at,
                                   has_open_order=bool(order_code),
                                   window_days=settings.ENROLL_RENEW_WINDOW_DAYS, now=now),
        "open_order_code": order_code,
    }


def catalog_item(product: dict, viewer: dict) -> dict:
    presentation = product.get("presentation") if isinstance(product.get("presentation"), dict) else {}
    expected = product.get("expected_open_on")
    return {
        "slug": product["slug"],
        "title": product["title"],
        "short_title": product.get("short_title"),
        "summary": product.get("summary"),
        "status": product["status"],
        "tuition_vnd": product.get("tuition_vnd"),
        "access_days": product.get("access_days"),
        "ai_credits": product.get("ai_credits") or 0,
        "credit_valid_days": product.get("credit_valid_days"),
        "credits_expire_note": credits_expire_note(product),
        **carry_fields(),
        "level_from": _text(presentation.get("level_from")),
        "level_to": _text(presentation.get("level_to")),
        "lesson_count": _outline_for(product)["lesson_count"],
        "author": _author(presentation.get("author")),
        "features": list(product.get("features") or []),
        "expected_open_on": str(expected) if expected else None,
        "viewer": viewer,
    }


def _viewer_reads(user: Optional[dict]):
    if user is None:
        return None, None
    uid = str(user["id"])
    return ent.fetch_entitlement_rows(uid), ent.fetch_open_orders(uid)


# ── Routes ────────────────────────────────────────────────────────────────


@router.get("")
async def list_courses(authorization: Optional[str] = Header(None)):
    user = await _optional_user(authorization)
    try:
        products = await asyncio.to_thread(fetch_catalog_products)
        rows, orders = await asyncio.to_thread(_viewer_reads, user)
    except Exception as exc:
        logger.warning("[courses] catalog read failed: %s", exc)
        raise _error(503, "catalog_unavailable", "Danh sách khoá học tạm thời chưa tải được. Bạn thử lại sau ít phút nhé.")
    now = datetime.now(timezone.utc)
    return {"items": [catalog_item(p, viewer_for(p, rows, orders, now)) for p in products]}


@router.get("/{slug}")
async def get_course(slug: str, authorization: Optional[str] = Header(None)):
    user = await _optional_user(authorization)
    try:
        products = await asyncio.to_thread(fetch_catalog_products, slug)
        if not products:
            raise _error(404, "course_not_found", "Không tìm thấy khoá học này.")
        rows, orders = await asyncio.to_thread(_viewer_reads, user)
        codes = await asyncio.to_thread(fetch_course_codes, [products[0]["course_id"]])
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("[courses] course read failed slug=%s: %s", slug, exc)
        raise _error(503, "catalog_unavailable", "Khoá học tạm thời chưa tải được. Bạn thử lại sau ít phút nhé.")
    product = products[0]
    now = datetime.now(timezone.utc)
    presentation = product.get("presentation") if isinstance(product.get("presentation"), dict) else {}
    item = catalog_item(product, viewer_for(product, rows, orders, now))
    item.update({
        "course_code": codes.get(str(product["course_id"])),
        "faq": _faq(presentation.get("faq")),
        "chapters": _outline_for(product)["chapters"],
    })
    return item
