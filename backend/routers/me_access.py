"""COURSEACCESS-0055 plan 5.9 — the caller's courses and credit history.

``GET /api/me/courses`` lists every access the caller has (entitlements rows,
derived class memberships, the legacy access code) with credit balances from
``fn_credit_balance``. ``GET /api/me/credits`` is the ledger, newest first,
with the balance after each row and a Vietnamese label.

Both are exempt from the activation gate: a learner who enrolled online is
not active until an admin confirms the order, and still needs to see it.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query

from config import settings
from database import supabase_admin
from routers.auth import get_supabase_user
from services import entitlements as ent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/me", tags=["me"])

_LEDGER_COLUMNS = "id, entitlement_id, delta, reason, feature, note, created_at"
_PAGE = 1000


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, detail={"error_code": code, "message": message})


def _iso(value) -> Optional[str]:
    parsed = ent.parse_ts(value) if not isinstance(value, datetime) else value
    if parsed is None:
        return None
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _unwrap(raw) -> dict:
    result = raw[0] if isinstance(raw, list) and len(raw) == 1 else raw
    if not isinstance(result, dict) or not isinstance(result.get("items"), list):
        raise ValueError("unexpected fn_credit_balance shape")
    return result


# ── Reads ─────────────────────────────────────────────────────────────────


def fetch_credit_balance(user_id: str) -> dict:
    return _unwrap(supabase_admin.rpc("fn_credit_balance", {"p_user_id": user_id}).execute().data)


def fetch_courses(course_ids) -> dict[str, dict]:
    ids = sorted({str(i) for i in course_ids if i})
    if not ids:
        return {}
    res = supabase_admin.table("courses").select("id, code, name").in_("id", ids).execute()
    return {str(r["id"]): r for r in (res.data or [])}


def fetch_ledger(user_id: str) -> list[dict]:
    """Every ledger row of the user, oldest first (``balance_after`` needs the
    running sum from the first row)."""
    rows: list[dict] = []
    start = 0
    while True:
        res = (
            supabase_admin.table("credit_ledger").select(_LEDGER_COLUMNS).eq("user_id", user_id)
            .order("id").range(start, start + _PAGE - 1).execute()
        )
        batch = list(res.data or [])
        rows.extend(batch)
        if len(batch) < _PAGE:
            return rows
        start += _PAGE


def fetch_entitlement_sources(entitlement_ids) -> dict[str, dict]:
    ids = sorted({str(i) for i in entitlement_ids if i})
    if not ids:
        return {}
    res = supabase_admin.table("entitlements").select("id, source, course_id").in_("id", ids).execute()
    return {str(r["id"]): r for r in (res.data or [])}


# ── /api/me/courses ───────────────────────────────────────────────────────


def _credits_block(balance_item: Optional[dict]) -> Optional[dict]:
    if balance_item is None:
        return None
    return {
        "balance": int(balance_item.get("balance") or 0),
        "usable_from": _iso(balance_item.get("usable_from")),
        "usable_until": _iso(balance_item.get("usable_until")),
        "carry_balance": int(balance_item.get("carry_balance") or 0),
        "carry_expires_at": _iso(balance_item.get("carry_expires_at")),
    }


def build_my_courses(items: list[ent.AccessItem], balance: dict, courses: dict[str, dict],
                     open_orders: dict[str, str], now: datetime) -> dict:
    by_entitlement = {str(b.get("entitlement_id")): b for b in balance.get("items") or []}
    out = []
    for item in items:
        product = item.product or {}
        course = courses.get(item.course_id or "") or {}
        order_code = open_orders.get(item.product_id or "")
        out.append({
            "course_code": course.get("code"),
            "product_slug": product.get("slug"),
            "title": product.get("title") or course.get("name"),
            "short_title": product.get("short_title"),
            "kind": item.kind,
            "source": item.source,
            "state": item.status,
            "starts_at": _iso(item.starts_at),
            "expires_at": _iso(item.expires_at),
            "days_left": ent.days_left(item.expires_at, now),
            "review_mode": item.review_mode,
            "can_renew": ent.can_renew(product=product, state=item.status, expires_at=item.expires_at,
                                       has_open_order=bool(order_code),
                                       window_days=settings.ENROLL_RENEW_WINDOW_DAYS, now=now)
            if item.is_entitlement else False,
            "renew_order_code": order_code if item.is_entitlement else None,
            "credits": _credits_block(by_entitlement.get(item.entitlement_id or "")),
        })
    by_kind = {"online": 0, "class": 0}
    for b in balance.get("items") or []:
        usable_from = ent.parse_ts(b.get("usable_from"))
        if usable_from is not None and usable_from > now:
            continue
        key = "online" if b.get("product_kind") == "online" else "class"
        by_kind[key] += int(b.get("balance") or 0)
    return {
        "items": out,
        "credits": {"total": int(balance.get("total") or 0), "by_kind": by_kind},
        # Wired by G04-T10 (plan 5.14) behind the retention_by_entitlement flag.
        "content_visible_until": None,
        "content_days_after_expiry": None,
    }


def _my_courses_reads(user_id: str):
    items = ent.list_access(user_id)
    return (items, fetch_credit_balance(user_id), fetch_courses(i.course_id for i in items),
            ent.fetch_open_orders(user_id))


@router.get("/courses")
async def my_courses(authorization: Optional[str] = Header(None)):
    user = await get_supabase_user(authorization)
    try:
        items, balance, courses, orders = await asyncio.to_thread(_my_courses_reads, str(user["id"]))
    except Exception as exc:
        logger.warning("[me] courses read failed user=%s: %s", user.get("id"), exc)
        raise _error(503, "access_unavailable", "Chưa tải được khoá học của bạn. Bạn thử lại sau ít phút nhé.")
    return build_my_courses(items, balance, courses, orders, datetime.now(timezone.utc))


# ── /api/me/credits ───────────────────────────────────────────────────────

_GRANT_LABELS = {
    "enrollment_order": "Cộng khi mở khoá",
    "admin_grant": "Cộng khi mở khoá",
    "access_code": "Cộng kèm mã lớp",
    "class_conversion": "Cộng khi lớp chuyển sang tính lượt",
}
_LABELS = {
    "grant_extra": "Cấp thêm bởi admin",
    "carry_over": "Chuyển lượt chưa dùng từ kỳ trước khi đăng ký lại",
    "carry_expire": "Lượt chuyển hết hạn bảo lưu",
    "reserve": "Chấm bài",
    "release": "Hoàn lượt khi chấm lỗi",
    "admin_adjust": "Điều chỉnh bởi admin",
    "expire": "Hết hạn cùng khoá",
}
_PERCENT_RE = re.compile(r"(?<!\d)(\d{1,3})\s*%")
# Notes an admin wrote for the learner; other rows' notes are internal.
_LEARNER_NOTES = ("admin_adjust", "grant_extra")


def label_vi(row: dict, source: Optional[str]) -> str:
    reason = row.get("reason")
    if reason == "grant":
        return _GRANT_LABELS.get(source or "", "Cộng khi mở khoá")
    if reason == "reserve" and row.get("feature") == "short_writing_feedback":
        return "Nhận xét đoạn viết"
    label = _LABELS.get(reason, reason or "")
    if reason == "carry_over":
        match = _PERCENT_RE.search(row.get("note") or "")
        if match and int(match.group(1)) < 100:
            label += f" ({int(match.group(1))}%)"
    # admin_adjust / grant_extra carry the admin's words in `note`, not here
    # (CR nit on 37de4c62: the note was shown twice).
    return label


def build_credit_history(ledger: list[dict], sources: dict[str, dict], courses: dict[str, dict],
                         balance_total: int, limit: int, cursor: Optional[int]) -> dict:
    """``balance`` is the usable balance (``fn_credit_balance.total``); each
    ``balance_after`` is the raw running sum of the ledger. They differ while a
    lapsed entitlement or carry has no expire row yet, or a grant is not usable
    yet (a renewal that starts later): show ``balance`` as "còn dùng được"."""
    running = 0
    enriched = []
    for row in ledger:
        running += int(row.get("delta") or 0)
        enriched.append((row, running))
    enriched.reverse()  # newest first
    if cursor is not None:
        enriched = [(r, b) for r, b in enriched if int(r["id"]) < cursor]
    page = enriched[:limit]
    items = []
    for row, after in page:
        ent_row = sources.get(str(row.get("entitlement_id"))) or {}
        items.append({
            "at": _iso(row.get("created_at")),
            "delta": int(row.get("delta") or 0),
            "reason": row.get("reason"),
            "balance_after": after,
            "course_code": (courses.get(str(ent_row.get("course_id"))) or {}).get("code"),
            "feature": row.get("feature"),
            "label_vi": label_vi(row, ent_row.get("source")),
            "note": row.get("note") if row.get("reason") in _LEARNER_NOTES else None,
        })
    next_cursor = str(page[-1][0]["id"]) if len(enriched) > limit and page else None
    return {"balance": balance_total, "items": items, "next_cursor": next_cursor}


def _credit_reads(user_id: str):
    ledger = fetch_ledger(user_id)
    sources = fetch_entitlement_sources(r.get("entitlement_id") for r in ledger)
    courses = fetch_courses(s.get("course_id") for s in sources.values())
    return ledger, sources, courses, int(fetch_credit_balance(user_id).get("total") or 0)


@router.get("/credits")
async def my_credits(
    authorization: Optional[str] = Header(None),
    limit: int = Query(20, ge=1, le=100),
    cursor: Optional[str] = Query(None, max_length=20),
):
    user = await get_supabase_user(authorization)
    cursor_id = None
    if cursor is not None:
        if not cursor.isdigit():
            raise _error(422, "invalid_cursor", "Trang không hợp lệ.")
        cursor_id = int(cursor)
    try:
        ledger, sources, courses, total = await asyncio.to_thread(_credit_reads, str(user["id"]))
    except Exception as exc:
        logger.warning("[me] credits read failed user=%s: %s", user.get("id"), exc)
        raise _error(503, "access_unavailable", "Chưa tải được lịch sử lượt chấm. Bạn thử lại sau ít phút nhé.")
    return build_credit_history(ledger, sources, courses, total, limit, cursor_id)
