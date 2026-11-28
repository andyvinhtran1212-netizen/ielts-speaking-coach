"""ACCOUNTDATA-0100 FR-003: block learner routes while an account deletion is
open.

While the caller has an ``account_deletion_requests`` row in ``pending`` or
``erasing``, ``services.activation_gate._enforce`` answers 403
``{"error_code": "account_deletion_pending"}`` on every learner route except
the ones :func:`allows` lists: the login bootstrap, the account-data routes
themselves, reading the caller's own enrollment orders, and public content.

The list lives here, in code, and ``tests/test_account_deletion_gate.py``
checks every entry against the real app (as ``test_activation_gate_inventory``
does for the activation gate).

Cost: one indexed point read per authenticated learner request
(``account_deletion_requests_one_open`` is a partial unique index on
``user_id``), remembered for the request. Before migration 500 is applied the
table does not exist; the gate then allows and logs once per process, so the
code can ship ahead of the migration.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import HTTPException

from config import settings
from database import supabase_admin
from services.db_async import aexecute

logger = logging.getLogger(__name__)

PENDING_ERROR_CODE = "account_deletion_pending"
PENDING_MESSAGE = (
    "Tài khoản của bạn đang chờ xoá. Bạn có thể huỷ yêu cầu xoá trong trang Tài khoản."
)
OPEN_STATUSES = ("pending", "erasing")

# (METHOD, route path template) → why a learner with an open deletion request
# may still call it. FR-003 names these; keep each reason to one line.
DELETION_ALLOWED_ROUTES: dict[tuple[str, str], str] = {
    ("GET", "/auth/me"): "login bootstrap; the page then shows the pending-deletion notice",
    ("GET", "/api/account/deletion-request"): "read the request and its erase date",
    ("POST", "/api/account/deletion-request"): "re-sending returns the same open request (FR-001)",
    ("POST", "/api/account/deletion-request/cancel"): "cancel within the grace period",
    ("GET", "/api/account/data-export"): "status of the caller's own export",
    ("POST", "/api/account/data-export"): "a learner may take a copy before the erase date",
    ("GET", "/api/account/data-export/{export_id}/download"): "download the caller's own export",
    ("GET", "/api/enrollment-orders/me"): "read the caller's own enrollment orders",
    ("GET", "/api/enrollment-orders/{order_code}"): "read one of the caller's own orders",
    ("POST", "/api/error-logs"): "client error reports, anonymous by design",
}

# Public content needs no login; a signed-in learner keeps reading it. Only
# routes that are ALSO exempt from the activation gate count (that list is
# the reviewed record of which routes are public).
PUBLIC_PREFIXES: tuple[str, ...] = (
    "/health", "/sitemap-", "/api/public-stats", "/api/courses",
    "/api/grammar/", "/api/vocabulary/", "/api/library/", "/api/writing/prompt-bank",
)


def _is_public(method: str, path: str) -> bool:
    from services.activation_gate import is_exempt  # local: activation_gate imports this module
    return (
        method.upper() == "GET"
        and is_exempt(method, path)
        and any(path == p or path.startswith(p) for p in PUBLIC_PREFIXES)
    )


def allows(method: str, path: str) -> bool:
    """True when ``method path`` stays open while a deletion is pending."""
    return (method.upper(), path) in DELETION_ALLOWED_ROUTES or _is_public(method, path)


def pending_error() -> HTTPException:
    return HTTPException(403, detail={"error_code": PENDING_ERROR_CODE, "message": PENDING_MESSAGE})


# ── Lookup ───────────────────────────────────────────────────────────────────

_table_missing_logged = False


def _query(user_id: str):
    return lambda db: (
        db.table("account_deletion_requests").select("status")
        .eq("user_id", str(user_id)).in_("status", list(OPEN_STATUSES)).limit(1)
    )


def _is_missing_table(exc: Exception) -> bool:
    text = str(exc)
    return "PGRST205" in text or "42P01" in text or "account_deletion_requests" in text and "does not exist" in text


def _failed(user_id: str, exc: Exception) -> bool:
    global _table_missing_logged
    if _is_missing_table(exc):
        if not _table_missing_logged:
            _table_missing_logged = True
            logger.warning("[account_deletion_gate] account_deletion_requests missing (migration 500 not applied); allowing")
        return False
    logger.warning("[account_deletion_gate] lookup failed user=%s: %s", user_id, exc)
    raise HTTPException(503, detail="Không kiểm tra được trạng thái tài khoản. Vui lòng thử lại.")


def lookup_open_request(user_id: str) -> bool:
    """True when the account has a ``pending`` or ``erasing`` request. A DB
    failure fails CLOSED (503) like the activation lookup; a missing table
    (migration 500 not applied yet) is open."""
    try:
        rows = _query(user_id)(supabase_admin).execute().data or []
    except Exception as exc:
        return _failed(user_id, exc)
    return bool(rows)


async def alookup_open_request(user_id: str) -> bool:
    if not settings.USE_ASYNC_DB:
        return await asyncio.to_thread(lookup_open_request, user_id)
    try:
        rows = (await aexecute(_query(user_id))).data or []
    except Exception as exc:
        return _failed(user_id, exc)
    return bool(rows)


async def aensure_not_pending(user_id: str, method: str, path: str,
                              memo: Optional[dict] = None) -> None:
    """Raise 403 ``account_deletion_pending`` unless ``allows(method, path)``
    or the account has no open request. ``memo`` (the activation gate's
    per-request memo) remembers the answer for the request."""
    if allows(method, path):
        return
    key = str(user_id)
    cache = memo.setdefault("deletion_open", {}) if memo is not None else {}
    if key not in cache:
        cache[key] = await alookup_open_request(key)
    if cache[key]:
        raise pending_error()
