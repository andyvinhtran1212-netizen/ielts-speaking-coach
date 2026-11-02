"""ADMINAAL2-0032 lot 03 (T003) — the one staff decision point.

``routers.admin.require_admin`` / ``require_instructor`` are thin wrappers over
``resolve_staff``, so the ~360 call sites and the soft ``_is_admin`` helpers
(health, Reading and Listening review) all go through this module. Every
request re-reads the database; nothing is cached across requests.

Admin = token accepted by Supabase Auth + ``users.role = 'admin'`` +
``users.is_active`` + a satisfied second factor. Instructor = token +
``role ∈ {instructor, admin}`` + ``is_active``, with the admin rule applied
when the caller's role is admin (FR-005).

The second factor (research.md §9.1, §9.6) is satisfied only when ALL hold:

  * the ``aal`` claim of the token GoTrue just accepted is ``aal2``. The
    payload is read WITHOUT a second signature check, and only after
    ``get_supabase_user`` accepted that exact token; its ``sub`` must equal
    the accepted user's id. A payload that cannot be decoded, has no ``aal``
    or names another subject counts as ``aal1``;
  * the GoTrue user object lists at least one ``verified`` TOTP factor. An
    AAL2 token keeps ``aal2`` for up to an hour after its factor is deleted,
    so the claim alone is not enough. A missing ``factors`` key means none;
  * the ``amr`` ``totp`` entry is at most ``ADMIN_AAL2_MAX_AGE_HOURS`` old
    (default 12, Amendment 1 FR-012). Refresh does not renew that timestamp;
    a missing entry counts as expired, and one more than
    ``_CLOCK_SKEW_SECONDS`` in the future is invalid. Only finite numeric
    timestamps count (Amendment 2): ``NaN`` and ``±inf`` are dropped before
    the latest one is taken.

``ADMIN_AAL2_ENFORCE`` (default false) decides what an unsatisfied admin gets:
403 ``mfa_required`` when true, otherwise the old behaviour plus exactly one
``admin_aal2_would_block`` warning per request (FR-003). A role, ``is_active``
or assurance lookup failure is a 503 and never grants.

Step-up (Amendment 1, FR-020): :func:`require_recent_mfa` runs after that
guard on the privilege-changing routes and asks for a TOTP entered within
``ADMIN_STEP_UP_MINUTES`` (default 15). ``ADMIN_STEP_UP_ENFORCE`` (default
false) decides between 403 ``step_up_required`` and one
``admin_step_up_would_block`` warning per request. Amendment 2 (FR-020a) adds
a 24-hour cool-off: a verified TOTP factor of the accepted Auth user whose
``created_at`` or ``updated_at`` is less than 24 hours old refuses step-up
with ``reason="new_factor_cooloff"``, however fresh the TOTP.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import math
import time
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Awaitable, Callable, Literal, Optional

from fastapi import HTTPException
from pydantic import BaseModel

from config import settings
from services import activation_gate

logger = logging.getLogger(__name__)

AAL1 = "aal1"
AAL2 = "aal2"
# GoTrue stamps amr with its own clock; tolerate this much skew before a
# future timestamp is treated as invalid.
_CLOCK_SKEW_SECONDS = 300

MFA_REQUIRED_MESSAGE = "Cần xác thực 2 bước để dùng quyền admin."
LOOKUP_FAILED_DETAIL = "Không kiểm tra được quyền truy cập. Vui lòng thử lại."
WOULD_BLOCK_EVENT = "admin_aal2_would_block"
STEP_UP_REQUIRED_MESSAGE = "Thao tác này cần nhập lại mã xác thực 2 bước."
STEP_UP_WOULD_BLOCK_EVENT = "admin_step_up_would_block"
# Amendment 2 (FR-020a): a new or changed verified TOTP factor must age this
# long before it can back a step-up. No owner bypass.
FACTOR_COOLOFF_SECONDS = 24 * 60 * 60
STEP_UP_COOLOFF_REASON = "new_factor_cooloff"
STEP_UP_COOLOFF_MESSAGE = (
    "Mã xác thực 2 bước vừa được thêm hoặc thay đổi. "
    "Cần chờ đủ 24 giờ kể từ lúc đó mới làm được thao tác này."
)

ADMIN_ROLE_DENIED = "Bạn không có quyền truy cập trang này"
INSTRUCTOR_ROLE_DENIED = "Bạn không có quyền truy cập trang giảng viên"

# (METHOD, route template) that an admin may call from an AAL1 session (FR-004).
# ``allow_aal1=True`` is honoured ONLY on these routes; the inventory test in
# tests/test_staff_guard_inventory.py fails if any other route admits AAL1.
AAL1_ALLOWED_ADMIN_ROUTES: frozenset[tuple[str, str]] = frozenset({
    ("GET", "/admin/mfa/status"),
})

NextStep = Literal["none", "enroll", "challenge"]


# ── Per-request context ──────────────────────────────────────────────────────
# Set by the per-request middleware in main.py. Holds the ASGI scope (FastAPI
# writes the matched route into it, giving the route template) and the user
# ids already reported as would-block in THIS request. Outside a request
# (direct unit calls) there is no route and nothing is de-duplicated.
_request: ContextVar[Optional[dict]] = ContextVar("staff_guard_request", default=None)


def begin_request(scope: dict) -> object:
    return _request.set({"scope": scope, "would_block": set(), "step_up_would_block": set()})


def reset_request(token: object) -> None:
    _request.reset(token)


def current_route() -> tuple[str, str]:
    """(METHOD, route template) of the current request, or ("", "")."""
    ctx = _request.get()
    if not ctx:
        return "", ""
    scope = ctx["scope"]
    route = scope.get("route")
    path = getattr(route, "path", None) or scope.get("path") or ""
    return str(scope.get("method") or "").upper(), str(path)


# ── Assurance ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Assurance:
    aal: str
    verified_factor_count: int
    totp_verified_at: Optional[float]
    satisfied: bool
    reason: str          # ok | aal1 | no_verified_factor | totp_invalid | totp_expired
    next_step: NextStep


def _bearer_token(authorization: str | None) -> str:
    # Same extraction as routers.auth.get_supabase_user, so the payload read
    # here is the token GoTrue accepted.
    return (authorization or "").replace("Bearer ", "").strip()


def _token_claims(authorization: str | None, user_id: str) -> dict:
    """Claims of an ALREADY ACCEPTED token, or {} when they cannot be trusted
    as this user's (undecodable, not an object, or another ``sub``)."""
    parts = _bearer_token(authorization).split(".")
    if len(parts) != 3:
        return {}
    segment = parts[1]
    try:
        raw = base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))
        claims = json.loads(raw)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return {}
    if not isinstance(claims, dict) or str(claims.get("sub") or "") != str(user_id):
        return {}
    return claims


def _verified_totp_count(auth_user: dict) -> int:
    factors = auth_user.get("factors")
    if not isinstance(factors, list):
        return 0
    return sum(
        1 for f in factors
        if isinstance(f, dict)
        and f.get("status") == "verified"
        and f.get("factor_type") == "totp"
    )


def _finite_timestamp(value: Any) -> Optional[float]:
    """A numeric, non-boolean, finite ``amr`` timestamp, else None. ``NaN``
    compares false with everything and ``±inf`` is no instant, so neither may
    reach ``max`` or the age checks (Amendment 2, FR-012)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        stamp = float(value)
    except OverflowError:  # an int beyond float range is no instant either
        return None
    return stamp if math.isfinite(stamp) else None


def _totp_verified_at(claims: dict) -> Optional[float]:
    amr = claims.get("amr")
    if not isinstance(amr, list):
        return None
    stamps = [
        _finite_timestamp(entry.get("timestamp")) for entry in amr
        if isinstance(entry, dict) and entry.get("method") == "totp"
    ]
    stamps = [s for s in stamps if s is not None]
    return max(stamps) if stamps else None


def _factor_instant(value: Any) -> float:
    """UTC epoch seconds of a GoTrue factor timestamp (RFC 3339 with an
    offset). Missing, naive or malformed → ValueError: the caller fails
    closed rather than assuming the factor is old (FR-020a)."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError("factor timestamp missing")
    parsed = datetime.fromisoformat(value.strip())
    if parsed.utcoffset() is None:
        raise ValueError("factor timestamp has no UTC offset")
    return parsed.timestamp()


def _recent_factor_change(auth_user: dict, now: float) -> bool:
    """FR-020a: does ANY verified TOTP factor of the accepted Auth user have a
    ``created_at`` or ``updated_at`` less than 24 hours before ``now``? A
    future timestamp is not 24 hours old. Every such factor is parsed, so one
    unusable timestamp raises even when another factor is already recent."""
    factors = auth_user.get("factors")
    if not isinstance(factors, list):
        return False
    recent = False
    for factor in factors:
        if not (isinstance(factor, dict)
                and factor.get("status") == "verified"
                and factor.get("factor_type") == "totp"):
            continue
        for key in ("created_at", "updated_at"):
            if now - _factor_instant(factor.get(key)) < FACTOR_COOLOFF_SECONDS:
                recent = True
    return recent


def aal2_max_age_seconds() -> int:
    """FR-012 window. ``config`` already maps an invalid value to 12 h; a
    value set around it (tests, a bad patch) falls back the same way, so no
    value can widen or disable the check."""
    hours = settings.ADMIN_AAL2_MAX_AGE_HOURS
    if isinstance(hours, bool) or not isinstance(hours, int) or not 1 <= hours <= 12:
        hours = 12
    return hours * 60 * 60


def step_up_max_age_seconds() -> int:
    """FR-020 window, with the same fallback (15 min)."""
    minutes = settings.ADMIN_STEP_UP_MINUTES
    if isinstance(minutes, bool) or not isinstance(minutes, int) or not 1 <= minutes <= 15:
        minutes = 15
    return minutes * 60


def evaluate_admin_assurance(
    auth_user: dict, authorization: str | None, *, now: float | None = None,
) -> Assurance:
    """Pure read of the second-factor state for an accepted token."""
    claims = _token_claims(authorization, str(auth_user.get("id") or ""))
    aal = AAL2 if claims.get("aal") == AAL2 else AAL1
    verified = _verified_totp_count(auth_user)
    totp_at = _totp_verified_at(claims)
    now = time.time() if now is None else now

    if aal != AAL2:
        reason = "aal1"
    elif verified < 1:
        reason = "no_verified_factor"
    elif totp_at is None:
        reason = "totp_expired"  # a missing amr entry counts as expired (FR-012)
    elif totp_at > now + _CLOCK_SKEW_SECONDS:
        reason = "totp_invalid"
    elif now - totp_at > aal2_max_age_seconds():
        reason = "totp_expired"
    else:
        reason = "ok"

    satisfied = reason == "ok"
    next_step: NextStep = "none" if satisfied else ("enroll" if verified < 1 else "challenge")
    return Assurance(aal, verified, totp_at, satisfied, reason, next_step)


def enforcement_enabled() -> bool:
    return settings.ADMIN_AAL2_ENFORCE is True


def mfa_required_exception(next_step: NextStep) -> HTTPException:
    return HTTPException(
        status_code=403,
        detail={"code": "mfa_required", "next_step": next_step, "message": MFA_REQUIRED_MESSAGE},
    )


def _log_would_block(user_id: str, assurance: Assurance) -> None:
    ctx = _request.get()
    if ctx is not None:
        if user_id in ctx["would_block"]:
            return
        ctx["would_block"].add(user_id)
    method, route = current_route()
    # UUID, method, route template and the assurance verdict only — never the
    # email, token or request body (FR-003).
    fields = {
        "event": WOULD_BLOCK_EVENT,
        "user_id": user_id,
        "method": method or None,
        "route": route or None,
        "aal": assurance.aal,
        "next_step": assurance.next_step,
        "reason": assurance.reason,
    }
    logger.warning("%s %s", WOULD_BLOCK_EVENT, json.dumps(fields, sort_keys=True))


def _aal1_allowed_here(allow_aal1: bool) -> bool:
    if not allow_aal1:
        return False
    if current_route() in AAL1_ALLOWED_ADMIN_ROUTES:
        return True
    logger.error("[staff_guard] allow_aal1 ignored outside AAL1_ALLOWED_ADMIN_ROUTES: %s", current_route())
    return False


def apply_admin_assurance(auth_user: dict, authorization: str | None, *, allow_aal1: bool = False) -> None:
    """Raise 403 ``mfa_required`` (enforced) or log one would-block warning
    (report-only) for an admin whose second factor is not satisfied."""
    if _aal1_allowed_here(allow_aal1):
        return
    enforce = enforcement_enabled()
    user_id = str(auth_user.get("id") or "")
    try:
        assurance = evaluate_admin_assurance(auth_user, authorization)
    except Exception as exc:  # defensive: the reads are pure, but never grant on a bug
        logger.error("[staff_guard] assurance check failed user=%s: %r", user_id, exc)
        if enforce:
            raise HTTPException(503, LOOKUP_FAILED_DETAIL)
        return
    if assurance.satisfied:
        return
    if enforce:
        raise mfa_required_exception(assurance.next_step)
    _log_would_block(user_id, assurance)


# ── Step-up (Amendment 1, FR-020) ────────────────────────────────────────────

class MfaRequiredDetail(BaseModel):
    code: Literal["mfa_required"]
    next_step: NextStep
    message: str


class StepUpRequiredDetail(BaseModel):
    code: Literal["step_up_required"]
    next_step: Literal["challenge"]
    max_age_seconds: int
    message: str
    # Amendment 2 (FR-020a), only on a cool-off refusal: a fresh TOTP cannot
    # clear it, so the client shows the wait instead of a challenge.
    reason: Optional[Literal["new_factor_cooloff"]] = None


class StaffForbiddenResponse(BaseModel):
    # A role or inactive denial is a plain Vietnamese string.
    detail: StepUpRequiredDetail | MfaRequiredDetail | str


# OpenAPI ``responses=`` for every route that calls require_recent_mfa.
STEP_UP_RESPONSES: dict = {
    403: {
        "model": StaffForbiddenResponse,
        "description": "Not an active admin, `mfa_required` (FR-012), or "
                       "`step_up_required` under ADMIN_STEP_UP_ENFORCE (FR-020; "
                       "`reason: new_factor_cooloff` for a factor under 24 hours old)",
    },
}


def step_up_enforcement_enabled() -> bool:
    return settings.ADMIN_STEP_UP_ENFORCE is True


def step_up_required_exception(*, cooloff: bool = False) -> HTTPException:
    # ``next_step`` and ``max_age_seconds`` (the 15-minute window, not the
    # 24-hour cool-off) stay on a cool-off refusal for wire compatibility.
    detail = {
        "code": "step_up_required",
        "next_step": "challenge",
        "max_age_seconds": step_up_max_age_seconds(),
        "message": STEP_UP_COOLOFF_MESSAGE if cooloff else STEP_UP_REQUIRED_MESSAGE,
    }
    if cooloff:
        detail["reason"] = STEP_UP_COOLOFF_REASON
    return HTTPException(status_code=403, detail=detail)


def _log_step_up_would_block(user_id: str, assurance: Assurance, now: float, *, cooloff: bool) -> None:
    ctx = _request.get()
    if ctx is not None:
        if user_id in ctx["step_up_would_block"]:
            return
        ctx["step_up_would_block"].add(user_id)
    method, route = current_route()
    age = None if assurance.totp_verified_at is None else int(now - assurance.totp_verified_at)
    fields = {
        "event": STEP_UP_WOULD_BLOCK_EVENT,
        "user_id": user_id,
        "method": method or None,
        "route": route or None,
        "aal": assurance.aal,
        "reason": STEP_UP_COOLOFF_REASON if cooloff
                  else (assurance.reason if assurance.reason != "ok" else "totp_stale"),
        "totp_age_seconds": age,
        "max_age_seconds": step_up_max_age_seconds(),
    }
    logger.warning("%s %s", STEP_UP_WOULD_BLOCK_EVENT, json.dumps(fields, sort_keys=True))


def require_recent_mfa(auth_user: dict, authorization: str | None) -> None:
    """Step-up for privilege-changing routes (FR-020). Call it right after the
    route's ``require_admin`` (the FR-001 guard), before any database read or
    write, audit or outbox row. Passes only when the accepted token's
    assurance holds AND its ``amr`` totp entry is at most
    ``ADMIN_STEP_UP_MINUTES`` old AND no verified TOTP factor in the accepted
    ``auth_user["factors"]`` was created or updated in the last 24 hours
    (FR-020a; the cool-off reason wins when both fail). Otherwise 403
    ``step_up_required`` under ``ADMIN_STEP_UP_ENFORCE``, or exactly one
    would-block warning per request. Unusable factor timestamps are a lookup
    failure (503 under enforcement), never an old factor.

    The inventory test (tests/test_staff_guard_inventory.py) pins every route
    that calls this."""
    enforce = step_up_enforcement_enabled()
    user_id = str(auth_user.get("id") or "") if isinstance(auth_user, dict) else ""
    now = time.time()
    try:
        assurance = evaluate_admin_assurance(auth_user, authorization, now=now)
        cooloff = _recent_factor_change(auth_user, now)
        fresh = assurance.satisfied and now - assurance.totp_verified_at <= step_up_max_age_seconds()
    except Exception as exc:  # malformed factor metadata or a bug: never grant
        logger.error("[staff_guard] step-up check failed user=%s: %r", user_id, exc)
        if enforce:
            raise HTTPException(503, LOOKUP_FAILED_DETAIL)
        return
    if fresh and not cooloff:
        return
    if enforce:
        raise step_up_required_exception(cooloff=cooloff)
    _log_step_up_would_block(user_id, assurance, now, cooloff=cooloff)


# ── Role ─────────────────────────────────────────────────────────────────────

def lookup_role(db: Any, user_id: str) -> Optional[str]:
    """``users.role`` for ``user_id`` (None when no row). A read failure is a
    503 — it denies and never grants (FR-001)."""
    try:
        rows = db.table("users").select("role").eq("id", user_id).limit(1).execute().data or []
    except Exception as exc:
        logger.warning("[staff_guard] role lookup failed user=%s: %r", user_id, exc)
        raise HTTPException(503, LOOKUP_FAILED_DETAIL)
    return rows[0].get("role") if rows else None


async def alookup_role(read_role: Callable[[str], Awaitable[Any]], user_id: str) -> Optional[str]:
    """:func:`lookup_role` over the caller's awaitable read — ``routers.admin``
    passes its async-DB facade read (ASYNCAUTH-0036), so this module never
    picks a client. Same None-when-no-row result and 503 fail-closed contract."""
    try:
        rows = (await read_role(user_id)).data or []
    except Exception as exc:
        logger.warning("[staff_guard] role lookup failed user=%s: %r", user_id, exc)
        raise HTTPException(503, LOOKUP_FAILED_DETAIL)
    return rows[0].get("role") if rows else None


async def resolve_staff(
    authorization: str | None,
    *,
    need: Literal["admin", "instructor"],
    get_user: Callable[[str | None], Awaitable[dict]],
    db: Any,
    allow_aal1: bool = False,
    read_role: Optional[Callable[[str], Awaitable[Any]]] = None,
) -> dict:
    """Verify the bearer, then the role, ``is_active`` and (for an admin) the
    second factor. Returns the GoTrue user dict unchanged.

    ``get_user`` and ``db`` are injected by ``routers.admin`` from its module
    globals so the established test seams keep working. ``read_role`` (when
    given) replaces the sync role read on ``db`` — routers.admin passes its
    async-DB facade read (ASYNCAUTH-0036); with USE_ASYNC_DB off that read is
    the same sync query on the same client.
    """
    auth_user = await get_user(authorization)
    user_id = auth_user["id"]
    role = lookup_role(db, user_id) if read_role is None else await alookup_role(read_role, user_id)

    if need == "admin":
        if role != "admin":
            raise HTTPException(403, ADMIN_ROLE_DENIED)
    elif role not in ("instructor", "admin"):
        raise HTTPException(403, INSTRUCTOR_ROLE_DENIED)

    # Q-13 — a staff role does not replace activation: the learner gate skips
    # staff paths, so this guard owns the users.is_active check for them.
    # The async twin (ASYNCAUTH-0036) is the sync read when USE_ASYNC_DB is off.
    await activation_gate.aensure_account_active(user_id)

    if role == "admin":
        apply_admin_assurance(auth_user, authorization, allow_aal1=allow_aal1)
    return auth_user


def holds_admin_privilege(auth_user: dict, authorization: str | None, *, db: Any) -> bool:
    """Soft admin check for a caller ``get_supabase_user`` already verified
    with ``authorization``. Never raises: any denial or lookup failure is
    False, so the caller is treated as a learner (FR-002, Q7)."""
    try:
        user_id = auth_user["id"]
        if lookup_role(db, user_id) != "admin":
            return False
        if not activation_gate.account_is_active(user_id):
            return False
        apply_admin_assurance(auth_user, authorization)
        return True
    except Exception:
        return False
