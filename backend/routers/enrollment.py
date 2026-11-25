"""COURSEACCESS-0055 plan 5.9 — the learner's enrollment orders.

``/api/enrollment-orders``: create an order for an open online course, list
and read one's own orders, report a transfer, supplement a needs_info order,
cancel. Every state change is one 384 RPC (event row, and the outbox row for
``order_created``, in the same transaction).

All routes are exempt from the activation gate: an online enrollee is
inactive until an admin confirms the order.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Path, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from database import supabase_admin
from routers.auth import get_supabase_user
from services import enrollment_orders as eo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/enrollment-orders", tags=["enrollment"])

_ORDER_CODE = r"^[A-Za-z0-9 -]{6,20}$"
_UNAVAILABLE = "Chưa xử lý được đơn đăng ký lúc này. Bạn thử lại sau ít phút nhé."


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, detail={"error_code": code, "message": message})


def _unavailable() -> HTTPException:
    return _error(503, "orders_unavailable", _UNAVAILABLE)


def _not_found() -> HTTPException:
    return _error(404, "order_not_found", "Không tìm thấy đơn đăng ký này.")


class CreateOrder(BaseModel):
    product_slug: str = Field(min_length=1, max_length=120)
    request_key: str = Field(min_length=8, max_length=80)


class ReportTransfer(BaseModel):
    note: Optional[str] = Field(default=None, max_length=1000)


class Supplement(BaseModel):
    note: str = Field(min_length=3, max_length=1000)


class CancelOrder(BaseModel):
    pass


# ── Reads (raise on failure) ─────────────────────────────────────────────────


def fetch_my_orders(user_id: str, limit: int, cursor: Optional[str]) -> list[dict]:
    query = (
        supabase_admin.table("enrollment_orders").select(eo.ORDER_COLUMNS).eq("user_id", user_id)
    )
    query = eo.apply_cursor(query, cursor)
    return list(query.order("created_at", desc=True).limit(limit + 1).execute().data or [])


def fetch_my_order(user_id: str, order_code: str) -> Optional[dict]:
    res = (
        supabase_admin.table("enrollment_orders").select(eo.ORDER_COLUMNS)
        .eq("user_id", user_id).eq("order_code", order_code).limit(1).execute()
    )
    rows = list(res.data or [])
    return rows[0] if rows else None


def _view(order: dict) -> dict:
    return eo.order_views([order])[0]


# ── Create ───────────────────────────────────────────────────────────────────


def _create(user_id: str, body: CreateOrder, cfg: eo.EnrollmentConfig) -> tuple[int, dict]:
    product = eo.fetch_product_by_slug(body.product_slug)
    if not product or product.get("kind") != "online" or not product.get("is_public") \
            or product.get("archived_at"):
        raise _error(404, "course_not_found", "Không tìm thấy khoá học này.")
    # A retry of a request that already made an order is a replay, whatever
    # happened since (confirmed, course closed): answer it before the checks
    # that only gate a NEW order. The same key for another course is a conflict.
    earlier = eo.fetch_order_by_request_key(user_id, body.request_key)
    if earlier is not None:
        if str(earlier.get("product_id")) != str(product["id"]):
            raise _error(409, "request_key_conflict",
                         "Yêu cầu này đã dùng cho một khoá khác. Bạn tải lại trang nhé.")
        return 200, {"order": _view(earlier)}
    if product.get("status") != "open":
        raise _error(409, "course_not_open", "Khoá này chưa mở đăng ký.")
    rows = eo.fetch_product_entitlements(user_id, str(product["id"]))
    if eo.already_enrolled(rows, cfg.renew_window_days, datetime.now(timezone.utc)):
        raise _error(409, "already_enrolled",
                     "Bạn đang học khoá này. Bạn đăng ký lại được khi khoá gần hết hạn.")
    result = eo.create_order(user_id, str(product["id"]), body.request_key, cfg.pay_hours)
    status = result.get("status")
    if status in ("created", "replay", "existing_open"):
        if status == "created":
            logger.info("[enroll] order_created product=%s", product.get("slug"))
        return (201 if status == "created" else 200), {"order": _view(result["order"])}
    if status == "account_suspended":
        raise _error(403, "account_suspended", "Tài khoản đang tạm khoá nên chưa tạo được đơn đăng ký.")
    if status == "product_unavailable":
        raise _error(409, "course_not_open", "Khoá này chưa mở đăng ký.")
    if status == "request_key_conflict":
        raise _error(409, "request_key_conflict", "Yêu cầu này đã dùng cho một khoá khác. Bạn tải lại trang nhé.")
    raise eo.OrdersUnavailable(f"create_{status}")


@router.post("", status_code=201)
async def create_order(body: CreateOrder, authorization: Optional[str] = Header(None)):
    user = await get_supabase_user(authorization)
    # Defence for a GoTrue account without a confirmed e-mail (password
    # sign-up, removed): read from the GoTrue user, never user_metadata.
    if not user.get("email_confirmed_at"):
        raise _error(403, "sign_in_again", "Vui lòng đăng nhập lại bằng Google hoặc mã gửi qua email.")
    cfg = eo.enrollment_config()
    try:
        enabled = await asyncio.to_thread(eo.orders_enabled)
    except eo.OrdersUnavailable:
        raise _unavailable() from None
    if not enabled or not cfg.ready:
        if cfg.missing:
            logger.warning("[enroll] orders_paused missing=%s", ",".join(cfg.missing))
        raise _error(503, "orders_paused", "Đăng ký khoá đang tạm dừng. Bạn quay lại sau nhé.")
    try:
        status, payload = await asyncio.to_thread(_create, str(user["id"]), body, cfg)
    except HTTPException:
        raise
    except (eo.OrdersUnavailable, eo.InvalidArgument, Exception) as exc:
        logger.warning("[enroll] create failed: %s", type(exc).__name__)
        raise _unavailable() from None
    return JSONResponse(status_code=status, content=payload)


# ── Reads ────────────────────────────────────────────────────────────────────


@router.get("/me")
async def my_orders(
    authorization: Optional[str] = Header(None),
    limit: int = Query(20, ge=1, le=50),
    cursor: Optional[str] = Query(None, max_length=40),
):
    user = await get_supabase_user(authorization)
    if cursor is not None and eo.ent.parse_ts(cursor) is None:
        raise _error(422, "invalid_cursor", "Trang không hợp lệ.")

    def read():
        rows = fetch_my_orders(str(user["id"]), limit, cursor)
        shown, next_cursor = eo.page(rows, limit)
        return {"items": eo.order_views(shown), "next_cursor": next_cursor}

    try:
        return await asyncio.to_thread(read)
    except Exception as exc:
        logger.warning("[enroll] list failed: %s", type(exc).__name__)
        raise _unavailable() from None


async def _owned(user: dict, order_code: str) -> dict:
    code = eo.normalize_order_code(order_code)
    if code is None:
        raise _not_found()
    try:
        order = await asyncio.to_thread(fetch_my_order, str(user["id"]), code)
    except Exception as exc:
        logger.warning("[enroll] read failed: %s", type(exc).__name__)
        raise _unavailable() from None
    if order is None:
        raise _not_found()
    return order


@router.get("/{order_code}")
async def get_order(order_code: str = Path(pattern=_ORDER_CODE), authorization: Optional[str] = Header(None)):
    user = await get_supabase_user(authorization)
    order = await _owned(user, order_code)
    try:
        return {"order": await asyncio.to_thread(_view, order)}
    except Exception:
        raise _unavailable() from None


# ── Learner actions ──────────────────────────────────────────────────────────


async def _act(user: dict, order_code: str, action: str, note: Optional[str]) -> dict:
    code = eo.normalize_order_code(order_code)
    if code is None:
        raise _not_found()
    try:
        result = await eo.arpc("fn_enrollment_order_learner_action", {
            "p_user_id": str(user["id"]), "p_order_code": code, "p_action": action, "p_note": note,
        })
    except eo.InvalidArgument:
        raise _error(422, "invalid_note", "Ghi chú chưa hợp lệ.") from None
    except eo.OrdersUnavailable:
        raise _unavailable() from None
    status = result.get("status")
    if status == "not_found":
        raise _not_found()
    if status == "invalid_transition":
        raise _error(409, "invalid_transition", "Đơn đăng ký này không còn làm được việc đó.")
    if status != "ok" or not isinstance(result.get("order"), dict):
        raise _unavailable()
    try:
        view = await asyncio.to_thread(_view, result["order"])
    except Exception:
        raise _unavailable() from None
    return {"order": view, "late": bool(result.get("late"))}


@router.post("/{order_code}/report-transfer")
async def report_transfer(body: ReportTransfer, order_code: str = Path(pattern=_ORDER_CODE),
                          authorization: Optional[str] = Header(None)):
    user = await get_supabase_user(authorization)
    note = (body.note or "").strip() or None
    out = await _act(user, order_code, "report_transfer", note)
    logger.info("[enroll] transfer_reported late=%s", out["late"])
    return out


@router.post("/{order_code}/supplement")
async def supplement(body: Supplement, order_code: str = Path(pattern=_ORDER_CODE),
                     authorization: Optional[str] = Header(None)):
    user = await get_supabase_user(authorization)
    note = body.note.strip()
    if len(note) < 3:
        raise _error(422, "invalid_note", "Ghi chú cần ít nhất 3 ký tự.")
    out = await _act(user, order_code, "supplement", note)
    logger.info("[enroll] supplemented")
    return {"order": out["order"]}


@router.post("/{order_code}/cancel")
async def cancel(body: CancelOrder, order_code: str = Path(pattern=_ORDER_CODE),
                 authorization: Optional[str] = Header(None)):
    user = await get_supabase_user(authorization)
    out = await _act(user, order_code, "cancel", None)
    logger.info("[enroll] cancelled by=learner")
    return {"order": out["order"]}
