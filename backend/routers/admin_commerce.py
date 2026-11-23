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
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Path, Query
from pydantic import BaseModel, Field, field_validator, model_validator

from config import settings
from database import supabase_admin
from routers.admin import require_admin
from services import credits
from services import enrollment_orders as eo
from services import entitlements as ent
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


# ═════════════════════════════════════════════════════════════════════════════
# G04-T05 (plan 5.9): products, a learner's access and credits, entitlements,
# credit adjustments. Every write is one 384 RPC (or one row write for the
# product) and each handler awaits ``require_admin`` first. Four routes with
# a credit amount take a conditional step-up (Q13, plan 5.3): the condition
# comes from the normalized body only, before any database call.
# ═════════════════════════════════════════════════════════════════════════════

CREDIT_STEP_UP_THRESHOLD = 50

_ADMIN_UNAVAILABLE = "Chưa xử lý được yêu cầu. Vui lòng thử lại."
_PRODUCT_COLUMNS = (
    "id, course_id, slug, kind, title, short_title, summary, status, is_public, tuition_vnd, access_days, "
    "ai_credits, credit_valid_days, features, review_mode, display_order, expected_open_on, presentation, "
    "archived_at, archived_by, created_by, created_at, updated_at"
)
_ENTITLEMENT_VIEW_COLUMNS = (
    "id, user_id, product_id, course_id, source, status, starts_at, expires_at, credits_expire_at, "
    "credits_closed_at, review_mode, granted_by, reason, revoked_at, revoked_by, revoke_reason, created_at"
)
_OPEN_ORDER_STATUSES = ("awaiting_transfer", "transfer_reported", "needs_info")
_PAGE = 1000

# CHECK constraint → message (plan 5.9: Vietnamese, never a column name or SQL).
_CHECK_MESSAGES = {
    "course_products_slug_check": "Đường dẫn chỉ gồm chữ thường không dấu, số và dấu gạch ngang, tối đa 80 ký tự.",
    "course_products_public_online": "Chỉ khoá học online mới được hiển thị công khai.",
    "course_products_open_online_tuition": "Khoá học online đang mở đăng ký phải có học phí.",
    "course_products_open_online_access_days": "Khoá học online đang mở đăng ký phải có thời hạn học.",
    "course_products_archived_hidden": "Sản phẩm đã lưu trữ chỉ ở trạng thái nháp hoặc đã đóng, và không công khai.",
}
_CHECK_FALLBACK = "Thông tin sản phẩm chưa hợp lệ. Vui lòng kiểm tra lại."
_CONSTRAINT_RE = re.compile(r'constraint "([a-z0-9_]+)"')

# C2-SA-2335: free-text reasons land in append-only rows, so no contact data.
_EMAIL_RE = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
_PHONE_RE = re.compile(r"(?<!\d)(?:\+?84|0)(?:[\s.\-]?\d){8,10}(?!\d)")


def _admin_unavailable() -> HTTPException:
    return _error(503, "admin_unavailable", _ADMIN_UNAVAILABLE)


def _refuse_contact(text: Optional[str]) -> None:
    if text and (_EMAIL_RE.search(text) or _PHONE_RE.search(text)):
        raise _error(422, "note_contains_contact",
                     "Lý do không được chứa email hay số điện thoại. Chỉ ghi lý do nghiệp vụ.")


class _DbRefused(Exception):
    """A write broke a database rule; ``http`` is the answer for the admin."""

    def __init__(self, http: HTTPException):
        super().__init__(http.detail)
        self.http = http


def _db_refusal(exc: BaseException) -> Optional[HTTPException]:
    code = str(getattr(exc, "code", "") or "")
    text = " ".join(str(getattr(exc, attr, "") or "") for attr in ("message", "details", "hint"))
    if code == "23514":
        match = _CONSTRAINT_RE.search(text)
        return _error(422, "check_violation", _CHECK_MESSAGES.get(match.group(1) if match else "", _CHECK_FALLBACK))
    if code == "23505" and "slug" in text:
        return _error(409, "slug_taken", "Đường dẫn này đã có sản phẩm khác dùng.")
    if code == "23503":
        return _error(404, "course_not_found", "Không tìm thấy khoá học hoặc học viên.")
    if code == "P0001" and "course_product_kind_locked" in text:
        return _error(409, "product_locked",
                      "Sản phẩm đã có mã, quyền học hoặc đơn: không đổi được loại hay khoá học.")
    if code == "22023":
        return _error(422, "invalid_argument", "Thông tin chưa hợp lệ.")
    return None


def _execute(query):
    try:
        return query.execute()
    except Exception as exc:  # noqa: BLE001
        refusal = _db_refusal(exc)
        if refusal is not None:
            raise _DbRefused(refusal) from exc
        raise


def _admin_rpc(name: str, params: dict) -> dict:
    data = _execute(supabase_admin.rpc(name, params)).data
    result = data[0] if isinstance(data, list) and len(data) == 1 else data
    if not isinstance(result, dict):
        raise RuntimeError(f"unexpected {name} shape")
    return result


async def _run(fn, *args):
    """``fn`` in a thread: a database rule → its 4xx, anything else → 503."""
    try:
        return await asyncio.to_thread(fn, *args)
    except _DbRefused as refused:
        raise refused.http from None
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("[admin-commerce] %s failed: %s", getattr(fn, "__name__", "call"), type(exc).__name__)
        raise _admin_unavailable() from None


def _paged(build) -> list[dict]:
    out: list[dict] = []
    start = 0
    while True:
        page = build().range(start, start + _PAGE - 1).execute().data or []
        out.extend(page)
        if len(page) < _PAGE:
            return out
        start += _PAGE


# ── Products ────────────────────────────────────────────────────────────────

_SLUG = r"^[a-z0-9]+(-[a-z0-9]+)*$"
ProductKind = Literal["online", "class", "repractice"]
ProductStatus = Literal["draft", "coming_soon", "open", "closed"]
Feature = Literal["speaking", "writing", "reading", "listening", "grammar", "vocabulary"]
ReviewMode = Literal["ai_instant", "teacher_review"]


class _Author(BaseModel):
    model_config = {"extra": "forbid"}
    name: str = Field(min_length=1, max_length=120)
    bio_line: Optional[str] = Field(default=None, max_length=300)
    photo_url: Optional[str] = Field(default=None, max_length=500)


class _Faq(BaseModel):
    model_config = {"extra": "forbid"}
    q: str = Field(min_length=1, max_length=300)
    a: str = Field(min_length=1, max_length=2000)


class Presentation(BaseModel):
    """``course_products.presentation`` (plan 5.2): only these keys."""
    model_config = {"extra": "forbid"}
    level_from: Optional[str] = Field(default=None, max_length=40)
    level_to: Optional[str] = Field(default=None, max_length=40)
    author: Optional[_Author] = None
    faq: Optional[list[_Faq]] = Field(default=None, max_length=30)


class ProductCreate(BaseModel):
    model_config = {"extra": "forbid"}
    course_id: str = Field(pattern=_UUID)
    slug: str = Field(min_length=1, max_length=80, pattern=_SLUG)
    kind: ProductKind
    title: str = Field(min_length=1, max_length=120)
    short_title: Optional[str] = Field(default=None, min_length=1, max_length=60)
    summary: Optional[str] = Field(default=None, max_length=1000)
    status: ProductStatus = "draft"
    is_public: bool = False
    tuition_vnd: Optional[int] = Field(default=None, gt=0, le=2_000_000_000)
    access_days: Optional[int] = Field(default=None, ge=1, le=3650)
    ai_credits: int = Field(default=0, ge=0, le=100_000)
    credit_valid_days: Optional[int] = Field(default=None, ge=1, le=3650)
    features: list[Feature] = Field(default_factory=list, max_length=6)
    review_mode: ReviewMode = "ai_instant"
    display_order: int = Field(default=0, ge=-100_000, le=100_000)
    expected_open_on: Optional[date] = None
    presentation: Presentation = Field(default_factory=Presentation)


class ProductPatch(BaseModel):
    """Every column of 5.2 except id, times and archive (archive has its own
    route). Only the fields sent are written."""
    model_config = {"extra": "forbid"}
    course_id: Optional[str] = Field(default=None, pattern=_UUID)
    slug: Optional[str] = Field(default=None, min_length=1, max_length=80, pattern=_SLUG)
    kind: Optional[ProductKind] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    short_title: Optional[str] = Field(default=None, min_length=1, max_length=60)
    summary: Optional[str] = Field(default=None, max_length=1000)
    status: Optional[ProductStatus] = None
    is_public: Optional[bool] = None
    tuition_vnd: Optional[int] = Field(default=None, gt=0, le=2_000_000_000)
    access_days: Optional[int] = Field(default=None, ge=1, le=3650)
    ai_credits: Optional[int] = Field(default=None, ge=0, le=100_000)
    credit_valid_days: Optional[int] = Field(default=None, ge=1, le=3650)
    features: Optional[list[Feature]] = Field(default=None, max_length=6)
    review_mode: Optional[ReviewMode] = None
    display_order: Optional[int] = Field(default=None, ge=-100_000, le=100_000)
    expected_open_on: Optional[date] = None
    presentation: Optional[Presentation] = None


# Columns that are NOT NULL in 5.2: an explicit null is refused, not written.
_NOT_NULL = frozenset({"course_id", "slug", "kind", "title", "status", "is_public", "ai_credits", "features",
                       "review_mode", "display_order", "presentation"})


class ArchiveProduct(BaseModel):
    confirm_title: str = Field(min_length=1, max_length=120)


def _product_row(values: dict) -> dict:
    row = {}
    for key, value in values.items():
        if key == "presentation" and value is not None:
            value = {k: v for k, v in value.items() if v is not None}
        elif key == "features" and value is not None:
            value = sorted(set(value))
        elif key == "expected_open_on" and value is not None:
            value = value.isoformat()
        elif isinstance(value, str) and key not in ("slug", "course_id"):
            value = value.strip()
        row[key] = value
    return row


def _product_counts(product_ids: list[str]) -> dict[str, tuple[int, int]]:
    """``(open_orders, active_learners)`` per product. An active learner holds
    an active entitlement that has not ended (same rule as the archive RPC)."""
    if not product_ids:
        return {}
    now = datetime.now(timezone.utc)
    orders = _paged(lambda: supabase_admin.table("enrollment_orders").select("id, product_id")
                    .in_("product_id", product_ids).in_("status", list(_OPEN_ORDER_STATUSES)).order("id"))
    rows = _paged(lambda: supabase_admin.table("entitlements").select("id, product_id, user_id, expires_at")
                  .in_("product_id", product_ids).eq("status", "active").order("id"))
    open_orders: dict[str, int] = {}
    for o in orders:
        open_orders[str(o["product_id"])] = open_orders.get(str(o["product_id"]), 0) + 1
    learners: dict[str, set] = {}
    for r in rows:
        expires = ent.parse_ts(r.get("expires_at"))
        if r.get("expires_at") and (expires is None or expires <= now):
            continue
        learners.setdefault(str(r["product_id"]), set()).add(str(r.get("user_id")))
    return {pid: (open_orders.get(pid, 0), len(learners.get(pid, ()))) for pid in product_ids}


def _product_views(rows: list[dict]) -> list[dict]:
    counts = _product_counts([str(r["id"]) for r in rows])
    out = []
    for r in rows:
        open_orders, active = counts.get(str(r["id"]), (0, 0))
        out.append({**r, "open_orders": open_orders, "active_learners": active})
    return out


def list_products(include_archived: bool) -> list[dict]:
    def build():
        query = supabase_admin.table("course_products").select(_PRODUCT_COLUMNS)
        if not include_archived:
            query = query.is_("archived_at", "null")
        return query.order("display_order").order("id")
    return _product_views(_paged(build))


def fetch_product(product_id: str) -> Optional[dict]:
    rows = supabase_admin.table("course_products").select(_PRODUCT_COLUMNS).eq("id", product_id).execute().data
    return rows[0] if rows else None


def _product_or_404(product_id: str) -> dict:
    product = fetch_product(product_id)
    if product is None:
        raise _error(404, "product_not_found", "Không tìm thấy sản phẩm.")
    return product


def create_product(row: dict) -> dict:
    data = _execute(supabase_admin.table("course_products").insert(row)).data or []
    if not data:
        raise RuntimeError("insert returned nothing")
    return _product_views([_product_or_404(str(data[0]["id"]))])[0]


def _product_archived() -> HTTPException:
    return _error(409, "product_archived", "Sản phẩm đã lưu trữ, không sửa được.")


def update_product(product_id: str, row: dict) -> dict:
    if not row:
        if _product_or_404(product_id).get("archived_at"):
            raise _product_archived()
    else:
        # "Not archived" is part of the write itself, so an archive that
        # commits after any earlier read can never be followed by an edit.
        written = _execute(supabase_admin.table("course_products").update(row)
                           .eq("id", product_id).is_("archived_at", "null")).data or []
        if not written:
            if _product_or_404(product_id).get("archived_at"):
                raise _product_archived()
            raise RuntimeError("product update wrote no row")
    # Orders keep their own snapshot (tuition, days, credits, title): editing
    # the product never touches an order already created.
    return _product_views([_product_or_404(product_id)])[0]


def archive_product(admin_id: str, product_id: str, confirm_title: str) -> dict:
    product = _product_or_404(product_id)
    if confirm_title.strip() != (product.get("title") or "").strip():
        raise _error(422, "title_mismatch", "Tên sản phẩm gõ lại không khớp.")
    result = _admin_rpc("fn_course_product_archive", {"p_admin_id": admin_id, "p_product_id": product_id})
    status = result.get("status")
    if status == "not_found":
        raise _error(404, "product_not_found", "Không tìm thấy sản phẩm.")
    if status == "has_active_learners":
        raise _error(409, "has_active_learners",
                     f"Còn {int(result.get('n') or 0)} học viên đang học khoá này: chưa lưu trữ được.")
    if status == "has_open_orders":
        raise _error(409, "has_open_orders",
                     f"Còn {int(result.get('n') or 0)} đơn đăng ký đang mở: xử lý xong rồi mới lưu trữ.")
    if status not in ("archived", "already_archived"):
        raise RuntimeError(f"archive answered {status}")
    return _product_views([_product_or_404(product_id)])[0]


@router.get("/course-products")
async def get_products(include_archived: bool = Query(False), authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    return {"items": await _run(list_products, include_archived)}


@router.post("/course-products", status_code=201)
async def post_product(body: ProductCreate, authorization: Optional[str] = Header(None)):
    admin = await require_admin(authorization)
    row = {**_product_row(body.model_dump()), "created_by": str(admin["id"])}
    return {"product": await _run(create_product, row)}


@router.patch("/course-products/{product_id}")
async def patch_product(body: ProductPatch, product_id: str = Path(pattern=_UUID),
                        authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    values = body.model_dump(exclude_unset=True)
    nulls = sorted(k for k, v in values.items() if v is None and k in _NOT_NULL)
    if nulls:
        raise _error(422, "value_required", "Có trường bắt buộc đang để trống.")
    return {"product": await _run(update_product, product_id, _product_row(values))}


@router.post("/course-products/{product_id}/archive")
async def post_archive_product(body: ArchiveProduct, product_id: str = Path(pattern=_UUID),
                               authorization: Optional[str] = Header(None)):
    admin = await require_admin(authorization)
    product = await _run(archive_product, str(admin["id"]), product_id, body.confirm_title)
    logger.info("[admin-commerce] product archived")
    return {"product": product}


# ── A learner's access and credits ─────────────────────────────────────────


def _user_or_404(user_id: str) -> None:
    rows = supabase_admin.table("users").select("id").eq("id", user_id).limit(1).execute().data
    if not rows:
        raise _error(404, "user_not_found", "Không tìm thấy học viên.")


def _entitlement_events(entitlement_ids: list[str]) -> list[dict]:
    if not entitlement_ids:
        return []
    rows = _paged(lambda: supabase_admin.table("entitlement_events")
                  .select("id, entitlement_id, action, actor_id, actor_kind, before, after, reason, created_at")
                  .in_("entitlement_id", entitlement_ids).order("id"))
    rows.sort(key=lambda r: int(r.get("id") or 0), reverse=True)
    return [{
        "entitlement_id": str(r.get("entitlement_id")), "action": r.get("action"),
        "actor_id": r.get("actor_id"), "actor_kind": r.get("actor_kind"), "before": r.get("before"),
        "after": r.get("after"), "reason": r.get("reason"), "at": eo.iso(r.get("created_at")),
    } for r in rows]


def user_access(user_id: str) -> dict:
    from routers import me_access  # the learner's own view, reused as-is
    _user_or_404(user_id)
    items, balance, courses, orders, window = me_access._my_courses_reads(user_id)
    view = me_access.build_my_courses(items, balance, courses, orders, datetime.now(timezone.utc), window)
    for out, item in zip(view["items"], items):
        out["entitlement_id"] = item.entitlement_id
    view["events"] = _entitlement_events(sorted({i.entitlement_id for i in items if i.entitlement_id}))
    return view


def user_credits(user_id: str, limit: int, cursor: Optional[int]) -> dict:
    from routers import me_access
    _user_or_404(user_id)
    ledger = _paged(lambda: supabase_admin.table("credit_ledger")
                    .select("id, entitlement_id, delta, reason, feature, note, actor_id, created_at")
                    .eq("user_id", user_id).order("id"))
    sources = me_access.fetch_entitlement_sources(r.get("entitlement_id") for r in ledger)
    courses = me_access.fetch_courses(s.get("course_id") for s in sources.values())
    total = int(me_access.fetch_credit_balance(user_id).get("total") or 0)
    history = me_access.build_credit_history(ledger, sources, courses, total, limit, cursor)
    # build_credit_history pages newest first; walk the same order to attach
    # the admin-only fields (the entitlement, the actor, the full note).
    newest = list(reversed(ledger))
    if cursor is not None:
        newest = [r for r in newest if int(r["id"]) < cursor]
    actors = _users(r.get("actor_id") for r in newest[:limit])
    for item, row in zip(history["items"], newest[:limit]):
        item["entitlement_id"] = row.get("entitlement_id")
        actor = actors.get(str(row.get("actor_id"))) if row.get("actor_id") else None
        item["actor"] = actor
        item["note"] = row.get("note")
    return history


@router.get("/users/{user_id}/access")
async def get_user_access(user_id: str = Path(pattern=_UUID), authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    return await _run(user_access, user_id)


@router.get("/users/{user_id}/credits")
async def get_user_credits(user_id: str = Path(pattern=_UUID), limit: int = Query(20, ge=1, le=100),
                           cursor: Optional[str] = Query(None, max_length=20),
                           authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    if cursor is not None and not cursor.isdigit():
        raise _error(422, "invalid_cursor", "Trang không hợp lệ.")
    return await _run(user_credits, user_id, limit, int(cursor) if cursor is not None else None)


# ── Entitlements ────────────────────────────────────────────────────────────


class GrantEntitlement(BaseModel):
    model_config = {"extra": "forbid"}
    user_id: str = Field(pattern=_UUID)
    product_id: str = Field(pattern=_UUID)
    days: Optional[int] = Field(default=None, ge=1, le=3650)
    credits: Optional[int] = Field(default=None, ge=0, le=100_000)
    review_mode: Optional[ReviewMode] = None
    reason: str = Field(min_length=3, max_length=500)
    request_key: UUID


class RevokeEntitlement(BaseModel):
    model_config = {"extra": "forbid"}
    reason: str = Field(min_length=3, max_length=500)


class ExtendEntitlement(BaseModel):
    model_config = {"extra": "forbid"}
    days: int = Field(ge=1, le=3650)
    reason: str = Field(min_length=3, max_length=500)


class AdjustCredits(BaseModel):
    model_config = {"extra": "forbid"}
    entitlement_id: str = Field(pattern=_UUID)
    delta: int = Field(ge=-100_000, le=100_000)
    reason: str = Field(min_length=10, max_length=500)
    request_key: UUID

    @field_validator("delta")
    @classmethod
    def _not_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("delta must not be 0")
        return value


def fetch_entitlement(entitlement_id: str) -> Optional[dict]:
    rows = (supabase_admin.table("entitlements").select(_ENTITLEMENT_VIEW_COLUMNS)
            .eq("id", entitlement_id).execute().data)
    return rows[0] if rows else None


def _entitlement_or_404(entitlement_id: str) -> dict:
    row = fetch_entitlement(entitlement_id)
    if row is None:
        raise _error(404, "entitlement_not_found", "Không tìm thấy quyền học.")
    return row


def _request_key_conflict() -> HTTPException:
    return _error(409, "request_key_conflict",
                  "Mã yêu cầu này đã dùng cho một thao tác khác. Tải lại trang rồi làm lại.")


def grant_entitlement(admin_id: str, body: GrantEntitlement) -> dict:
    # An unknown user fails the entitlements FK (23503) → 404.
    result = _admin_rpc("fn_entitlement_admin_grant", {
        "p_admin_id": admin_id, "p_user_id": body.user_id, "p_product_id": body.product_id,
        "p_days": body.days, "p_credits": body.credits, "p_review_mode": body.review_mode,
        "p_reason": body.reason.strip(), "p_request_key": str(body.request_key),
    })
    status = result.get("status")
    if status == "product_invalid":
        raise _error(404, "product_not_found", "Không tìm thấy sản phẩm, hoặc sản phẩm đã lưu trữ.")
    if status not in ("granted", "replay"):
        raise RuntimeError(f"grant answered {status}")
    entitlement = _entitlement_or_404(str(result["entitlement_id"]))
    if status == "replay" and (str(entitlement.get("product_id")).lower() != body.product_id.lower()
                               or str(entitlement.get("granted_by")) != admin_id):
        # The RPC replays on (request_key, user) alone: a key reused for
        # another product or by another admin must not look like this grant.
        raise _request_key_conflict()
    return {"status": status, "entitlement": entitlement}


def revoke_entitlement(admin_id: str, entitlement_id: str, reason: str) -> dict:
    result = _admin_rpc("fn_entitlement_admin_revoke", {
        "p_admin_id": admin_id, "p_entitlement_id": entitlement_id, "p_reason": reason.strip()})
    status = result.get("status")
    if status == "not_found":
        raise _error(404, "entitlement_not_found", "Không tìm thấy quyền học.")
    if status not in ("revoked", "already_revoked"):
        raise RuntimeError(f"revoke answered {status}")
    return {"status": status, "entitlement": _entitlement_or_404(entitlement_id)}


_EXTEND_REFUSALS = {
    "revoked": "Quyền học đã bị thu hồi, không gia hạn được.",
    "no_expiry": "Quyền học này không có hạn, không cần gia hạn.",
    "credits_closed": "Lượt của quyền học này đã đóng sổ: hãy cấp một quyền học mới.",
}


def extend_entitlement(admin_id: str, entitlement_id: str, days: int, reason: str) -> dict:
    result = _admin_rpc("fn_entitlement_admin_extend", {
        "p_admin_id": admin_id, "p_entitlement_id": entitlement_id, "p_days": days, "p_reason": reason.strip()})
    status = result.get("status")
    if status == "not_found":
        raise _error(404, "entitlement_not_found", "Không tìm thấy quyền học.")
    if status in _EXTEND_REFUSALS:
        raise _error(409, f"entitlement_{status}", _EXTEND_REFUSALS[status])
    if status != "extended":
        raise RuntimeError(f"extend answered {status}")
    return {"status": status, "entitlement": _entitlement_or_404(entitlement_id)}


def _entitlement_balance(entitlement: dict) -> Optional[int]:
    from routers import me_access
    for item in me_access.fetch_credit_balance(str(entitlement["user_id"])).get("items") or []:
        if str(item.get("entitlement_id")) == str(entitlement["id"]):
            return int(item.get("balance") or 0)
    return None


def adjust_credits(admin_id: str, body: AdjustCredits) -> dict:
    result = _admin_rpc("fn_credit_admin_adjust", {
        "p_admin_id": admin_id, "p_entitlement_id": body.entitlement_id, "p_delta": body.delta,
        "p_reason": body.reason.strip(), "p_request_key": str(body.request_key),
    })
    status = result.get("status")
    if status == "not_found":
        raise _error(404, "entitlement_not_found", "Không tìm thấy quyền học.")
    if status == "would_go_negative":
        raise HTTPException(409, detail={
            "error_code": "would_go_negative", "balance": int(result.get("balance") or 0),
            "message": "Không trừ được: số lượt còn lại ít hơn số muốn trừ."})
    if status == "not_usable":
        raise _error(409, "not_usable", "Quyền học đã hết hạn, bị thu hồi hoặc đã đóng sổ lượt.")
    if status == "adjusted":
        return {"status": status, "balance": int(result.get("balance_after") or 0)}
    if status == "replay":
        # The RPC replays on the key alone (any entitlement, any delta): only a
        # true repeat of this adjustment may answer "replay".
        prior = _execute(supabase_admin.table("credit_ledger").select("id, entitlement_id, delta")
                         .eq("id", result.get("ledger_id"))).data or []
        if not prior or str(prior[0].get("entitlement_id")).lower() != body.entitlement_id.lower() \
                or int(prior[0].get("delta") or 0) != body.delta:
            raise _request_key_conflict()
        entitlement = _entitlement_or_404(body.entitlement_id)
        return {"status": status, "balance": _entitlement_balance(entitlement)}
    raise RuntimeError(f"adjust answered {status}")


@router.post("/entitlements", responses=staff_guard.STEP_UP_RESPONSES)
async def post_entitlement(body: GrantEntitlement, authorization: Optional[str] = Header(None)):
    admin = await require_admin(authorization)
    step_up_credits = CREDIT_STEP_UP_THRESHOLD + 1 if body.credits is None else body.credits
    if step_up_credits > CREDIT_STEP_UP_THRESHOLD:
        staff_guard.require_recent_mfa(admin, authorization)
    _refuse_contact(body.reason)
    result = await _run(grant_entitlement, str(admin["id"]), body)
    logger.info("[admin-commerce] entitlement %s", result["status"])
    return result


@router.post("/entitlements/{entitlement_id}/revoke")
async def post_revoke(body: RevokeEntitlement, entitlement_id: str = Path(pattern=_UUID),
                      authorization: Optional[str] = Header(None)):
    admin = await require_admin(authorization)
    _refuse_contact(body.reason)
    return await _run(revoke_entitlement, str(admin["id"]), entitlement_id, body.reason)


@router.post("/entitlements/{entitlement_id}/extend")
async def post_extend(body: ExtendEntitlement, entitlement_id: str = Path(pattern=_UUID),
                      authorization: Optional[str] = Header(None)):
    admin = await require_admin(authorization)
    _refuse_contact(body.reason)
    return await _run(extend_entitlement, str(admin["id"]), entitlement_id, body.days, body.reason)


@router.post("/credits/adjust", responses=staff_guard.STEP_UP_RESPONSES)
async def post_adjust(body: AdjustCredits, authorization: Optional[str] = Header(None)):
    admin = await require_admin(authorization)
    step_up_credits = abs(body.delta)
    if step_up_credits > CREDIT_STEP_UP_THRESHOLD:
        staff_guard.require_recent_mfa(admin, authorization)
    _refuse_contact(body.reason)
    result = await _run(adjust_credits, str(admin["id"]), body)
    logger.info("[admin-commerce] credits %s", result["status"])
    return result


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


# ── Convert a legacy-code class to credit metering (plan 5.18, G04-T15) ──────

_CONVERT_MESSAGES = {
    "cohort_not_found": "Không tìm thấy lớp.",
    "cohort_archived": "Lớp đã lưu trữ, không chuyển được.",
    "cohort_has_no_course": "Lớp chưa gắn khoá học, chưa chuyển sang tính lượt được.",
    "no_class_product": "Khoá của lớp chưa có sản phẩm loại lớp. Tạo sản phẩm ở trang Khoá học trước.",
    "product_ambiguous": "Khoá của lớp có nhiều sản phẩm loại lớp: chọn một sản phẩm.",
    "product_invalid": "Sản phẩm này không phải sản phẩm lớp của khoá, hoặc đã lưu trữ.",
    "request_key_conflict": "Mã yêu cầu này đã dùng cho một lần chuyển lớp khác. Tải lại trang rồi làm lại.",
}


class ConvertClass(BaseModel):
    model_config = {"extra": "forbid"}
    cohort_id: str = Field(pattern=_UUID)
    credits_per_member: int = Field(ge=0, le=100_000)
    request_key: UUID
    product_id: Optional[str] = Field(default=None, pattern=_UUID)


async def _convert_call(fn, *args, **kwargs):
    try:
        return await asyncio.to_thread(fn, *args, **kwargs)
    except credits.ConvertClassRefused as exc:
        raise _error(exc.status_code, exc.error_code, _CONVERT_MESSAGES[exc.error_code]) from None
    except Exception as exc:  # noqa: BLE001
        logger.warning("[credits] convert_class %s failed: %s", getattr(fn, "__name__", "call"), type(exc).__name__)
        raise _error(503, "credits_unavailable", "Chưa xử lý được việc chuyển lớp. Vui lòng thử lại.") from None


@router.get("/credits/convert-class/pending")
async def convert_class_pending(authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    return {"items": await _convert_call(credits.list_classes_pending_conversion)}


@router.get("/credits/convert-class/preview")
async def convert_class_preview(cohort_id: str = Query(pattern=_UUID), authorization: Optional[str] = Header(None)):
    await require_admin(authorization)
    return await _convert_call(credits.convert_class_preview, cohort_id)


@router.post("/credits/convert-class", responses=staff_guard.STEP_UP_RESPONSES)
async def convert_class(body: ConvertClass, authorization: Optional[str] = Header(None)):
    admin = await require_admin(authorization)
    # Q13 amendment (Andy, 23/11 11:39Z): every conversion is a bulk grant, so
    # every call needs step-up, zero credits included.
    staff_guard.require_recent_mfa(admin, authorization)
    return await _convert_call(
        credits.convert_class, admin_id=str(admin["id"]), cohort_id=body.cohort_id,
        credits_per_member=body.credits_per_member, request_key=str(body.request_key), product_id=body.product_id)
