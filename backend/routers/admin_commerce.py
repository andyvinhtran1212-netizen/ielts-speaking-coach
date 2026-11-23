"""COURSEACCESS-0055 plan 5.9 — admin side of enrollment orders (G04-T04).

``/admin/enrollment-orders``: list with search, counts per status, one order
with its events, and the three admin actions (confirm, request-info,
cancel). Each action is one 384 RPC, which writes the event row and the
learner letter in the same transaction. ``POST /admin/credits/grant-extra``
(G04-T12, plan 5.15) grants extra credits through 385's RPC. Products,
entitlements and the other credit routes (G04-T05) join this router later.

Every handler awaits ``require_admin`` as its first statement
(``tests/test_staff_guard_inventory.py``). The actions are not step-up
routes yet (Q13), but declare ``STEP_UP_RESPONSES`` so turning it on later
does not change the contract. grant-extra is a conditional step-up route
(Q13): a class grant, or more than 50 credits in one request.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Path, Query
from pydantic import BaseModel, Field, field_validator, model_validator

from config import settings
from database import supabase_admin
from routers.admin import require_admin
from services import credits
from services import enrollment_orders as eo
from services import staff_guard

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin", "enrollment"])

_UUID = r"^[0-9a-fA-F-]{36}$"
_UNAVAILABLE = "Chưa xử lý được đơn đăng ký. Vui lòng thử lại."


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, detail={"error_code": code, "message": message})


def _unavailable() -> HTTPException:
    return _error(503, "orders_unavailable", _UNAVAILABLE)


def _not_found() -> HTTPException:
    return _error(404, "order_not_found", "Không tìm thấy đơn đăng ký.")


class ConfirmOrder(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)
    allow_expired: bool = False
    received_vnd: Optional[int] = Field(default=None, ge=0, le=2_000_000_000)


class RequestInfo(BaseModel):
    info_kind: Literal["underpaid", "not_found", "other"]
    received_vnd: Optional[int] = Field(default=None, ge=0, le=2_000_000_000)
    message: str = Field(min_length=3, max_length=1000)
    supplement_by: Optional[datetime] = None


class AdminCancel(BaseModel):
    message: str = Field(min_length=3, max_length=500)
    confirm_order_code: str = Field(min_length=6, max_length=20)


# ── Reads (raise on failure) ─────────────────────────────────────────────────


def _users(user_ids) -> dict[str, dict]:
    ids = sorted({str(i) for i in user_ids if i})
    if not ids:
        return {}
    res = supabase_admin.table("users").select("id, email, display_name").in_("id", ids).execute()
    return {str(r["id"]): {"id": str(r["id"]), "email": r.get("email"), "display_name": r.get("display_name")}
            for r in (res.data or [])}


def _like_literal(text: str) -> str:
    """An ILIKE pattern that matches ``text`` exactly (case-insensitive):
    ``\\``, ``%`` and ``_`` are escaped, so "a_b@x" never matches "axb@x"
    and "%@gmail.com" is not a wildcard listing."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _user_ids_by_email(q: str) -> list[str]:
    res = supabase_admin.table("users").select("id").ilike("email", _like_literal(q)).limit(20).execute()
    return [str(r["id"]) for r in (res.data or [])]


def search_orders(status: Optional[str], q: Optional[str], late: bool, limit: int,
                  cursor: Optional[str]) -> list[dict]:
    query = supabase_admin.table("enrollment_orders").select(eo.ORDER_COLUMNS)
    if late:
        query = query.eq("status", "expired").not_.is_("late_transfer_reported_at", "null")
    elif status:
        query = query.eq("status", status)
    text = (q or "").strip()
    if text:
        if "@" in text:
            ids = _user_ids_by_email(text)
            if not ids:
                return []
            query = query.in_("user_id", ids)
        else:
            # Banks often drop the dash: AVER7K2QXM matches AVER-7K2QXM.
            code = eo.normalize_order_code(text)
            if code is None:
                return []
            query = query.eq("order_code", code)
    query = eo.apply_cursor(query, cursor)
    return list(query.order("created_at", desc=True).limit(limit + 1).execute().data or [])


def _count(**filters) -> int:
    query = supabase_admin.table("enrollment_orders").select("id", count="exact")
    for column, value in filters.items():
        query = query.eq(column, value)
    return int(query.limit(1).execute().count or 0)


def order_counts() -> dict:
    counts = {status: _count(status=status) for status in eo.STATUSES}
    res = (
        supabase_admin.table("enrollment_orders").select("id", count="exact").eq("status", "expired")
        .not_.is_("late_transfer_reported_at", "null").limit(1).execute()
    )
    counts["expired_late_reported"] = int(res.count or 0)
    return counts


def fetch_order(order_id: str) -> Optional[dict]:
    res = supabase_admin.table("enrollment_orders").select(eo.ORDER_COLUMNS).eq("id", order_id).limit(1).execute()
    rows = list(res.data or [])
    return rows[0] if rows else None


def fetch_events(order_id: str) -> list[dict]:
    res = (
        supabase_admin.table("enrollment_order_events")
        .select("from_status, to_status, action, actor_id, actor_kind, note, created_at")
        .eq("order_id", order_id).order("created_at").order("id").execute()
    )
    return list(res.data or [])


def fetch_other_open_order(order: dict) -> Optional[str]:
    res = (
        supabase_admin.table("enrollment_orders").select("order_code")
        .eq("user_id", order["user_id"]).eq("product_id", order["product_id"]).neq("id", order["id"])
        .in_("status", list(eo.OPEN_STATUSES)).limit(1).execute()
    )
    rows = list(res.data or [])
    return rows[0]["order_code"] if rows else None


def _admin_views(orders: list[dict]) -> list[dict]:
    views = eo.order_views(orders)
    users = _users(o.get("user_id") for o in orders)
    for order, view in zip(orders, views):
        view["id"] = str(order["id"])
        view["learner_note"] = order.get("learner_note")
        view["user"] = users.get(str(order.get("user_id"))) or {"id": str(order.get("user_id")),
                                                                  "email": None, "display_name": None}
    return views


def _detail(order: dict) -> dict:
    view = _admin_views([order])[0]
    view["events"] = [{
        "at": eo.iso(e.get("created_at")), "action": e.get("action"), "from_status": e.get("from_status"),
        "to_status": e.get("to_status"), "actor_kind": e.get("actor_kind"),
        "actor_id": str(e["actor_id"]) if e.get("actor_id") else None, "note": e.get("note"),
    } for e in fetch_events(str(order["id"]))]
    view["other_open_order_code"] = fetch_other_open_order(order)
    return view


# ── Routes ───────────────────────────────────────────────────────────────────


@router.get("/enrollment-orders")
async def list_orders(
    authorization: Optional[str] = Header(None),
    status: Optional[Literal["awaiting_transfer", "transfer_reported", "needs_info", "confirmed",
                             "expired", "cancelled"]] = Query(None),
    q: Optional[str] = Query(None, max_length=254),
    late: bool = Query(False),
    limit: int = Query(50, ge=1, le=100),
    cursor: Optional[str] = Query(None, max_length=40),
):
    await require_admin(authorization)
    if cursor is not None and eo.ent.parse_ts(cursor) is None:
        raise _error(422, "invalid_cursor", "Trang không hợp lệ.")

    def read():
        rows = search_orders(status, q, late, limit, cursor)
        shown, next_cursor = eo.page(rows, limit)
        return {"items": _admin_views(shown), "next_cursor": next_cursor}

    try:
        return await asyncio.to_thread(read)
    except Exception as exc:
        logger.warning("[admin-enroll] list failed: %s", type(exc).__name__)
        raise _unavailable() from None


@router.get("/enrollment-orders/counts")
async def counts(authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    try:
        return await asyncio.to_thread(order_counts)
    except Exception as exc:
        logger.warning("[admin-enroll] counts failed: %s", type(exc).__name__)
        raise _unavailable() from None


@router.get("/enrollment-orders/{order_id}")
async def get_order(order_id: str = Path(pattern=_UUID), authorization: Optional[str] = Header(None)):
    await require_admin(authorization)

    def read():
        order = fetch_order(order_id)
        return None if order is None else _detail(order)

    try:
        detail = await asyncio.to_thread(read)
    except Exception as exc:
        logger.warning("[admin-enroll] read failed: %s", type(exc).__name__)
        raise _unavailable() from None
    if detail is None:
        raise _not_found()
    return detail


def _expire_entitlements_after_confirm(user_id: str) -> None:
    """Plan 5.15: close the previous term and carry its credits right after a
    confirm, when 385's function exists. Missing → skipped (the sweep runs it
    later); any other failure is logged, the confirm already committed.
    Every argument is chosen by the server: the order's user and config."""
    try:
        eo.rpc("fn_credit_expire_entitlements", {
            "p_user_id": user_id, "p_limit": 100,
            "p_carry_percent": settings.CREDIT_CARRY_PERCENT,
            "p_carry_valid_days": settings.CREDIT_CARRY_VALID_DAYS,
        })
    except eo.OrdersUnavailable as exc:
        if eo.is_missing_function(exc):
            logger.info("[credits] lifecycle skipped=no_function")
        else:
            logger.warning("[credits] lifecycle after confirm failed")
    except eo.InvalidArgument:
        logger.warning("[credits] lifecycle after confirm refused its arguments")


async def _reload(order_id: str) -> dict:
    try:
        order = await asyncio.to_thread(fetch_order, order_id)
        if order is None:
            raise _not_found()
        return (await asyncio.to_thread(_admin_views, [order]))[0]
    except HTTPException:
        raise
    except Exception:
        raise _unavailable() from None


@router.post("/enrollment-orders/{order_id}/confirm", responses=staff_guard.STEP_UP_RESPONSES)
async def confirm(body: ConfirmOrder, order_id: str = Path(pattern=_UUID),
                  authorization: Optional[str] = Header(None)):
    admin = await require_admin(authorization)
    note = (body.note or "").strip() or None
    try:
        result = await eo.arpc("fn_enrollment_order_confirm", {
            "p_admin_id": str(admin["id"]), "p_order_id": order_id, "p_note": note,
            "p_allow_expired": body.allow_expired,
            "p_carry_window_days": eo.enrollment_config().carry_window_days,
            "p_received_vnd": body.received_vnd,
        })
    except eo.InvalidArgument as exc:
        if "overpaid" in exc.message:
            raise _error(422, "note_required", "Số tiền nhận lớn hơn học phí: cần ghi chú cách xử lý phần thừa.") \
                from None
        raise _error(422, "invalid_argument", "Thông tin xác nhận chưa hợp lệ.") from None
    except eo.OrdersUnavailable:
        raise _unavailable() from None
    status = result.get("status")
    if status == "not_found":
        raise _not_found()
    if status in ("invalid_transition", "has_open_order", "account_suspended"):
        messages = {
            "invalid_transition": "Đơn ở trạng thái này không xác nhận được.",
            "has_open_order": "Học viên đang có một đơn khác còn mở cho khoá này.",
            "account_suspended": "Tài khoản học viên đang tạm khoá.",
        }
        raise _error(409, status, messages[status])
    if status not in ("confirmed", "already_confirmed"):
        raise _unavailable()
    order = await _reload(order_id)
    if status == "confirmed":
        await asyncio.to_thread(_expire_entitlements_after_confirm, order["user"]["id"])
        logger.info("[enroll] confirmed credits=%s reopened=%s", result.get("credits_granted"),
                    bool(result.get("reopened")))
    return {
        "status": status,
        "order": order,
        "entitlement": {
            "id": result.get("entitlement_id"),
            "starts_at": eo.iso(result.get("starts_at")),
            "expires_at": eo.iso(result.get("expires_at")),
            "credits_expire_at": eo.iso(result.get("credits_expire_at")),
            "renews_entitlement_id": result.get("renews_entitlement_id"),
        },
        "credits_granted": int(result.get("credits_granted") or 0),
        "reopened": bool(result.get("reopened")),
    }


@router.post("/enrollment-orders/{order_id}/request-info", responses=staff_guard.STEP_UP_RESPONSES)
async def request_info(body: RequestInfo, order_id: str = Path(pattern=_UUID),
                       authorization: Optional[str] = Header(None)):
    admin = await require_admin(authorization)
    now = datetime.now(timezone.utc)
    supplement_by = body.supplement_by or now + timedelta(hours=eo.enrollment_config().supplement_hours)
    if supplement_by.tzinfo is None:
        raise _error(422, "invalid_supplement_by", "Hạn bổ sung cần có múi giờ.")
    if supplement_by <= now:
        raise _error(422, "invalid_supplement_by", "Hạn bổ sung phải ở sau thời điểm hiện tại.")
    if body.info_kind == "underpaid" and body.received_vnd is None:
        raise _error(422, "received_required", "Cần nhập số tiền đã nhận khi đánh dấu thiếu tiền.")
    try:
        result = await eo.arpc("fn_enrollment_order_admin_action", {
            "p_admin_id": str(admin["id"]), "p_order_id": order_id, "p_action": "request_info",
            "p_reason": body.info_kind, "p_message": body.message.strip(),
            "p_supplement_by": supplement_by.isoformat(), "p_received_vnd": body.received_vnd,
        })
    except eo.InvalidArgument:
        raise _error(422, "invalid_argument",
                     "Thông tin chưa hợp lệ (số tiền đã nhận phải nhỏ hơn học phí khi thiếu tiền).") from None
    except eo.OrdersUnavailable:
        raise _unavailable() from None
    status = result.get("status")
    if status == "not_found":
        raise _not_found()
    if status == "invalid_transition":
        raise _error(409, "invalid_transition", "Đơn ở trạng thái này không đánh dấu cần bổ sung được.")
    if status != "ok":
        raise _unavailable()
    logger.info("[enroll] needs_info kind=%s", body.info_kind)
    return {"order": await _reload(order_id)}


@router.post("/enrollment-orders/{order_id}/cancel", responses=staff_guard.STEP_UP_RESPONSES)
async def cancel(body: AdminCancel, order_id: str = Path(pattern=_UUID),
                 authorization: Optional[str] = Header(None)):
    admin = await require_admin(authorization)
    try:
        order = await asyncio.to_thread(fetch_order, order_id)
    except Exception:
        raise _unavailable() from None
    if order is None:
        raise _not_found()
    if eo.normalize_order_code(body.confirm_order_code) != order.get("order_code"):
        raise _error(422, "order_code_mismatch", "Mã đơn gõ lại không khớp.")
    try:
        result = await eo.arpc("fn_enrollment_order_admin_action", {
            "p_admin_id": str(admin["id"]), "p_order_id": order_id, "p_action": "cancel",
            "p_reason": None, "p_message": body.message.strip(),
        })
    except eo.InvalidArgument:
        raise _error(422, "invalid_argument", "Lý do huỷ cần từ 3 đến 500 ký tự.") from None
    except eo.OrdersUnavailable:
        raise _unavailable() from None
    status = result.get("status")
    if status == "not_found":
        raise _not_found()
    if status == "invalid_transition":
        raise _error(409, "invalid_transition", "Đơn ở trạng thái này không huỷ được.")
    if status != "ok":
        raise _unavailable()
    logger.info("[enroll] cancelled by=admin")
    return {"order": await _reload(order_id)}


# ── Extra credits (plan 5.15, G04-T12) ───────────────────────────────────────


class GrantExtra(BaseModel):
    """With ``cohort_id``: the whole class, or the listed members of it. Without:
    exactly one learner and the ``entitlement_id`` to credit (profile page)."""

    cohort_id: Optional[str] = Field(default=None, pattern=_UUID)
    user_ids: Optional[list[str]] = Field(default=None, max_length=500)
    entitlement_id: Optional[str] = Field(default=None, pattern=_UUID)
    credits: int = Field(ge=1, le=100_000)
    reason: str = Field(min_length=3, max_length=500)
    request_key: UUID

    @field_validator("user_ids")
    @classmethod
    def _user_ids_are_uuids(cls, value):
        if value is not None:
            for item in value:
                if not re.fullmatch(_UUID, item or ""):
                    raise ValueError("user_ids must be UUIDs")
        return value

    @field_validator("reason")
    @classmethod
    def _reason_trimmed(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("reason needs 3..500 characters")
        return value

    @model_validator(mode="after")
    def _target(self):
        if self.cohort_id is None and (not self.user_ids or len(self.user_ids) != 1 or not self.entitlement_id):
            raise ValueError("without cohort_id, send exactly one user_id and its entitlement_id")
        if self.cohort_id is not None and self.entitlement_id is not None:
            raise ValueError("entitlement_id is only for one learner without cohort_id")
        return self

    @property
    def needs_step_up(self) -> bool:
        # Q13: a class grant always (its size is unknown before a DB read);
        # otherwise when the credits granted by this request exceed 50.
        return self.cohort_id is not None or \
            self.credits * len(self.user_ids or [1]) > credits.CREDIT_STEP_UP_THRESHOLD


@router.post("/credits/grant-extra", responses=staff_guard.STEP_UP_RESPONSES)
async def grant_extra(body: GrantExtra, authorization: Optional[str] = Header(None)):
    admin = await require_admin(authorization)
    needs_step_up = body.needs_step_up
    if needs_step_up:
        staff_guard.require_recent_mfa(admin, authorization)
    try:
        result = await asyncio.to_thread(
            credits.grant_extra_for, admin_id=str(admin["id"]), credits=body.credits, reason=body.reason,
            request_key=str(body.request_key), cohort_id=body.cohort_id, user_ids=body.user_ids,
            entitlement_id=body.entitlement_id)
    except credits.GrantExtraRefused as exc:
        messages = {
            "cohort_not_found": "Không tìm thấy lớp.",
            "entitlement_not_found": "Không tìm thấy quyền học này của học viên.",
            "not_in_cohort": "Có học viên không thuộc lớp này.",
            "request_key_conflict": "Mã yêu cầu này đã dùng với số lượt hoặc lý do khác. Tải lại trang rồi cấp lại.",
        }
        raise _error(exc.status_code, exc.error_code, messages[exc.error_code]) from None
    except Exception as exc:
        logger.warning("[credits] grant_extra failed: %s", type(exc).__name__)
        raise _error(503, "credits_unavailable", "Chưa cấp được lượt. Vui lòng thử lại.") from None
    return {"granted": result.granted, "skipped": result.skipped}
