"""COURSEACCESS-0055 plan 5.5 / 5.9 / 5.10 — enrollment orders.

One place that reads the enrollment settings (``enrollment_config()``, so they
can later move to the admin settings page without touching callers), mints
order codes, calls the 384 order RPCs and builds the ``Order`` shape both the
learner and the admin routes return.

Every state change goes through a SECURITY DEFINER RPC that writes the event
row and, for the four letters of 5.12, the outbox row in the same transaction.
Nothing here writes ``enrollment_orders`` directly.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Optional
from urllib.parse import quote

from postgrest.exceptions import APIError

from config import settings
from database import supabase_admin
from services import entitlements as ent
from services import runtime_flags
from services.access_code_gen import ALPHABET

logger = logging.getLogger(__name__)

ORDERS_FLAG = "enrollment_orders"
ORDER_CODE_PREFIX = "AVER-"
ORDER_CODE_LEN = 6
STATUSES = ("awaiting_transfer", "transfer_reported", "needs_info", "confirmed", "expired", "cancelled")
OPEN_STATUSES = ent.OPEN_ORDER_STATUSES
# The transfer block is shown while money may still arrive, expired included
# (a learner who paid late needs the exact memo, plan 5.9).
_TRANSFER_STATUSES = ("awaiting_transfer", "transfer_reported", "needs_info", "expired")
_CODE_ATTEMPTS = 5
RPC_TIMEOUT_SECONDS = 5.0
ORDER_COLUMNS = (
    "id, order_code, user_id, product_id, status, tuition_vnd, access_days, ai_credits, credit_valid_days, "
    "product_title, learner_note, info_kind, received_vnd, admin_message, supplement_by, pay_by, "
    "transfer_reported_at, late_transfer_reported_at, confirmed_at, cancelled_at, expired_at, reopened_at, "
    "cancelled_by, cancel_reason, entitlement_id, created_at"
)
_PRODUCT_COLUMNS = (
    "id, course_id, slug, kind, title, short_title, status, is_public, archived_at"
)


class OrdersUnavailable(Exception):
    """A read or RPC failed; the route answers 503 ``orders_unavailable``."""


# ── Configuration ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class EnrollmentConfig:
    pay_hours: int
    bank_bin: str
    bank_name: str
    account_no: str
    account_name: str
    vietqr_image_template: str
    renew_window_days: int
    reminder_hours_before: int
    reminder_min_age_hours: int
    supplement_hours: int
    carry_percent: int
    carry_window_days: int

    @property
    def missing(self) -> tuple[str, ...]:
        """Settings without which no order may be created (orders_paused)."""
        names = []
        if self.pay_hours <= 0:
            names.append("ENROLLMENT_PAY_HOURS")
        for name, value in (("ENROLL_BANK_BIN", self.bank_bin), ("ENROLL_BANK_NAME", self.bank_name),
                            ("ENROLL_BANK_ACCOUNT_NO", self.account_no),
                            ("ENROLL_BANK_ACCOUNT_NAME", self.account_name)):
            if not value:
                names.append(name)
        return tuple(names)

    @property
    def ready(self) -> bool:
        return not self.missing


def enrollment_config() -> EnrollmentConfig:
    s = settings
    return EnrollmentConfig(
        pay_hours=int(s.ENROLLMENT_PAY_HOURS or 0),
        bank_bin=(s.ENROLL_BANK_BIN or "").strip(),
        bank_name=(s.ENROLL_BANK_NAME or "").strip(),
        account_no=(s.ENROLL_BANK_ACCOUNT_NO or "").strip(),
        account_name=(s.ENROLL_BANK_ACCOUNT_NAME or "").strip(),
        vietqr_image_template=(s.ENROLL_VIETQR_IMAGE_TEMPLATE or "").strip(),
        renew_window_days=int(s.ENROLL_RENEW_WINDOW_DAYS),
        reminder_hours_before=int(s.ENROLL_PAY_REMINDER_HOURS_BEFORE),
        reminder_min_age_hours=int(s.ENROLL_PAY_REMINDER_MIN_AGE_HOURS),
        supplement_hours=int(s.ENROLL_SUPPLEMENT_HOURS),
        carry_percent=int(s.CREDIT_CARRY_PERCENT),
        carry_window_days=int(s.CREDIT_CARRY_VALID_DAYS),
    )


def orders_enabled() -> bool:
    """The ``enrollment_orders`` flag. A read error raises OrdersUnavailable:
    an outage is not the same answer as "paused"."""
    try:
        return runtime_flags.is_enabled_strict(ORDERS_FLAG, default=False)
    except runtime_flags.FlagLookupError as exc:
        raise OrdersUnavailable(ORDERS_FLAG) from exc


# ── Codes ────────────────────────────────────────────────────────────────────


def new_order_code() -> str:
    return ORDER_CODE_PREFIX + "".join(secrets.choice(ALPHABET) for _ in range(ORDER_CODE_LEN))


def normalize_order_code(raw: Optional[str]) -> Optional[str]:
    """``AVER-7K2QXM`` from what a learner or a bank statement may hold:
    lower case, spaces, or the dash dropped (``AVER7K2QXM``)."""
    if not raw:
        return None
    text = "".join(str(raw).split()).upper()
    if text.startswith("AVER") and not text.startswith(ORDER_CODE_PREFIX):
        text = ORDER_CODE_PREFIX + text[4:]
    body = text[len(ORDER_CODE_PREFIX):]
    if not text.startswith(ORDER_CODE_PREFIX) or len(body) != ORDER_CODE_LEN \
            or any(ch not in ALPHABET for ch in body):
        return None
    return text


# ── RPC ──────────────────────────────────────────────────────────────────────


def _unwrap(raw) -> dict:
    result = raw[0] if isinstance(raw, list) and len(raw) == 1 else raw
    if not isinstance(result, dict):
        raise OrdersUnavailable("unexpected_rpc_shape")
    return result


class InvalidArgument(Exception):
    """The RPC raised 22023: the request broke a rule the route did not pre-check."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def _call(name: str, params: dict):
    try:
        return supabase_admin.rpc(name, params).execute().data
    except APIError as exc:
        if str(getattr(exc, "code", "")) == "22023":
            raise InvalidArgument(str(getattr(exc, "message", "") or exc)) from exc
        logger.warning("[enroll] rpc=%s failed code=%s", name, getattr(exc, "code", None))
        raise OrdersUnavailable(name) from exc
    except Exception as exc:
        logger.warning("[enroll] rpc=%s failed: %s", name, type(exc).__name__)
        raise OrdersUnavailable(name) from exc


def rpc(name: str, params: dict) -> dict:
    return _unwrap(_call(name, params))


def rpc_count(name: str, params: dict) -> int:
    """An RPC that RETURNS integer (G05's ``fn_course_open_alerts_enqueue``)."""
    raw = _call(name, params)
    value = raw[0] if isinstance(raw, list) and len(raw) == 1 else raw
    if isinstance(value, dict) and len(value) == 1:
        value = next(iter(value.values()))
    if isinstance(value, bool) or not isinstance(value, int):
        raise OrdersUnavailable("unexpected_rpc_shape")
    return value


async def arpc(name: str, params: dict) -> dict:
    try:
        return await asyncio.wait_for(asyncio.to_thread(rpc, name, params), timeout=RPC_TIMEOUT_SECONDS)
    except asyncio.TimeoutError as exc:
        logger.warning("[enroll] rpc=%s timed out", name)
        raise OrdersUnavailable(name) from exc


def is_missing_function(exc: BaseException) -> bool:
    cause = exc.__cause__ if isinstance(exc, OrdersUnavailable) else exc
    code = str(getattr(cause, "code", "") or "").upper()
    return code in {"PGRST202", "42883"}


def create_order(user_id: str, product_id: str, request_key: str, pay_hours: int) -> dict:
    """fn_enrollment_order_create with a fresh code; a global code collision
    retries with another code (the RPC holds the user's lock, so only the
    code itself can collide)."""
    for _ in range(_CODE_ATTEMPTS):
        result = rpc("fn_enrollment_order_create", {
            "p_user_id": user_id, "p_product_id": product_id, "p_order_code": new_order_code(),
            "p_request_key": request_key, "p_pay_hours": pay_hours,
        })
        if result.get("status") != "code_collision":
            return result
    raise OrdersUnavailable("order_code_exhausted")


# ── Reads (raise on failure) ─────────────────────────────────────────────────


def fetch_product_by_slug(slug: str) -> Optional[dict]:
    res = (
        supabase_admin.table("course_products").select(_PRODUCT_COLUMNS)
        .eq("slug", slug).limit(1).execute()
    )
    rows = list(res.data or [])
    return rows[0] if rows else None


def fetch_products(product_ids: Iterable[str]) -> dict[str, dict]:
    ids = sorted({str(i) for i in product_ids if i})
    if not ids:
        return {}
    res = supabase_admin.table("course_products").select(_PRODUCT_COLUMNS).in_("id", ids).execute()
    return {str(r["id"]): r for r in (res.data or [])}


def fetch_entitlement_expiries(entitlement_ids: Iterable[str]) -> dict[str, Optional[str]]:
    ids = sorted({str(i) for i in entitlement_ids if i})
    if not ids:
        return {}
    res = supabase_admin.table("entitlements").select("id, expires_at").in_("id", ids).execute()
    return {str(r["id"]): r.get("expires_at") for r in (res.data or [])}


def fetch_order_by_request_key(user_id: str, request_key: str) -> Optional[dict]:
    """The caller's own order created with ``request_key`` (unique per user)."""
    res = (
        supabase_admin.table("enrollment_orders").select(ORDER_COLUMNS)
        .eq("user_id", user_id).eq("request_key", request_key).limit(1).execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def fetch_product_entitlements(user_id: str, product_id: str) -> list[dict]:
    res = (
        supabase_admin.table("entitlements").select("id, status, starts_at, expires_at")
        .eq("user_id", user_id).eq("product_id", product_id).execute()
    )
    return list(res.data or [])


def already_enrolled(rows: list[dict], window_days: int, now: datetime) -> bool:
    """Plan 5.9: an active entitlement of the product with more than the
    renew window left (or no end at all) refuses a new order."""
    for row in rows:
        if ent.entitlement_state(row, now) != "active":
            continue
        expires = ent.parse_ts(row.get("expires_at"))
        if expires is None or (expires - now).total_seconds() > window_days * 86400:
            return True
    return False


# ── Order shape ──────────────────────────────────────────────────────────────


def iso(value) -> Optional[str]:
    parsed = value if isinstance(value, datetime) else ent.parse_ts(value)
    if parsed is None:
        return None
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _vietqr_payload(cfg: EnrollmentConfig, amount: int, memo: str) -> Optional[str]:
    """EMVCo string from services.vietqr (G05-T11, #2486). Until that module
    lands the field is null; the PR that adds it wires nothing else.

    Only ``ValueError`` (the module's answer to a bank setting or amount it
    rejects) becomes null: the order page still shows the account and the
    memo. Any other error, a ``TypeError`` from a changed signature above all,
    is a contract bug and must surface instead of silently hiding the QR."""
    try:
        from services import vietqr  # type: ignore[attr-defined]
    except ImportError:
        return None
    try:
        return vietqr.build_payload(bank_bin=cfg.bank_bin, account_no=cfg.account_no,
                                    amount_vnd=amount, note=memo)
    except ValueError as exc:
        logger.warning("[enroll] vietqr payload rejected the transfer settings: %s", exc)
        return None


def _qr_image_url(cfg: EnrollmentConfig, amount: int, memo: str) -> Optional[str]:
    """``ENROLL_VIETQR_IMAGE_TEMPLATE`` with ``{bank_bin}``, ``{account_no}``,
    ``{account_name}``, ``{amount}`` and ``{memo}`` (URL-encoded)."""
    if not cfg.vietqr_image_template:
        return None
    try:
        return cfg.vietqr_image_template.format(
            bank_bin=quote(cfg.bank_bin, safe=""), account_no=quote(cfg.account_no, safe=""),
            account_name=quote(cfg.account_name, safe=""), amount=amount, memo=quote(memo, safe=""),
        )
    except (KeyError, IndexError, ValueError):
        logger.warning("[enroll] ENROLL_VIETQR_IMAGE_TEMPLATE has an unknown placeholder")
        return None


def build_transfer(order: dict, cfg: EnrollmentConfig) -> Optional[dict]:
    if order.get("status") not in _TRANSFER_STATUSES or not cfg.account_no:
        return None
    amount = int(order.get("tuition_vnd") or 0)
    memo = order.get("order_code")
    return {
        "bank_bin": cfg.bank_bin or None,
        "bank_name": cfg.bank_name or None,
        "account_no": cfg.account_no,
        "account_name": cfg.account_name or None,
        "amount_vnd": amount,
        "memo": memo,
        "vietqr_payload": _vietqr_payload(cfg, amount, memo),
        "qr_image_url": _qr_image_url(cfg, amount, memo),
    }


def order_view(order: dict, *, product: Optional[dict], cfg: EnrollmentConfig,
               entitlement_expires_at=None) -> dict:
    """The ``Order`` object of plan 5.9 from an ``enrollment_orders`` row."""
    status = order.get("status")
    tuition = int(order.get("tuition_vnd") or 0)
    received = order.get("received_vnd")
    overpaid = received - tuition if isinstance(received, int) and received > tuition else None
    cancel_reason = cancel_note = None
    if status == "cancelled":
        by_learner = order.get("cancelled_by") is not None and \
            str(order.get("cancelled_by")) == str(order.get("user_id"))
        cancel_reason = "learner" if by_learner else "admin"
        cancel_note = None if by_learner else order.get("cancel_reason")
    product = product or {}
    confirmed = status == "confirmed"
    return {
        "order_code": order.get("order_code"),
        "status": status,
        "product": {
            "slug": product.get("slug"),
            # The title captured on the order wins: a later rename does not
            # change what the learner signed up for.
            "title": order.get("product_title") or product.get("title"),
            "short_title": product.get("short_title"),
        },
        "tuition_vnd": tuition,
        "access_days": order.get("access_days"),
        "ai_credits": order.get("ai_credits"),
        "credit_valid_days": order.get("credit_valid_days"),
        "pay_by": iso(order.get("pay_by")),
        "created_at": iso(order.get("created_at")),
        "transfer_reported_at": iso(order.get("transfer_reported_at")),
        "late_transfer_reported_at": iso(order.get("late_transfer_reported_at")),
        "confirmed_at": iso(order.get("confirmed_at")),
        "reopened_at": iso(order.get("reopened_at")),
        "info_kind": order.get("info_kind"),
        "received_vnd": received,
        "overpaid_vnd": overpaid,
        "admin_message": order.get("admin_message"),
        "supplement_by": iso(order.get("supplement_by")),
        "cancel_reason": cancel_reason,
        "cancel_note": cancel_note,
        "cancelled_at": iso(order.get("cancelled_at")),
        "entitlement_expires_at": iso(entitlement_expires_at) if confirmed else None,
        # Credits added at confirmation (the RPC grants exactly ai_credits);
        # carried credits are read at /api/me/courses.
        "credits_granted": int(order.get("ai_credits") or 0) if confirmed else None,
        "transfer": build_transfer(order, cfg),
    }


def order_views(orders: list[dict], cfg: Optional[EnrollmentConfig] = None) -> list[dict]:
    """Order objects for many rows with two batched reads."""
    cfg = cfg or enrollment_config()
    products = fetch_products(o.get("product_id") for o in orders)
    expiries = fetch_entitlement_expiries(o.get("entitlement_id") for o in orders
                                          if o.get("status") == "confirmed")
    return [
        order_view(o, product=products.get(str(o.get("product_id"))), cfg=cfg,
                   entitlement_expires_at=expiries.get(str(o.get("entitlement_id"))))
        for o in orders
    ]


def _cursor_ts(cursor: Optional[str]) -> Optional[str]:
    if cursor is None:
        return None
    parsed = ent.parse_ts(cursor)
    if parsed is None:
        raise ValueError("invalid cursor")
    return parsed.astimezone(timezone.utc).isoformat()


def page(rows: list[dict], limit: int) -> tuple[list[dict], Optional[str]]:
    """``limit + 1`` rows newest first → the page and the next cursor."""
    shown = rows[:limit]
    next_cursor = iso(shown[-1].get("created_at")) if len(rows) > limit and shown else None
    return shown, next_cursor


def apply_cursor(query: Any, cursor: Optional[str]) -> Any:
    ts = _cursor_ts(cursor)
    return query.lt("created_at", ts) if ts else query
